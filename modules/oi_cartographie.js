/**
 * oi_cartographie.js — Cartographie de préparation mission (MapLibre) pour le Générateur d'OI.
 * Chargé par : 4.html
 * Fonctions principales : OICarto (objet : init, gestion des pins, shapes, historique undo/redo)
 */
// ==================== oi_cartographie.js ====================
// Cartographie de préparation mission pour le Générateur d'OI (4.html).
//
// Portage du système MapLibre de pctac2 vers 4.html (style script global,
// pas de module ES).
//  - Lot A1 : socle — satellite ESRI, relief 3D + bâtiments OSM,
//    recherche adresse/GPS (Nominatim), plein écran.
//  - Lot A2 : pins (membres PATRACDVR + pins OI dédiés) avec drag,
//    dessins (trait/rectangle/cercle) avec undo/redo.
//  - Lot A3 (à venir) : export de la capture vers les champs photos de l'OI.
//
// Persistance : Store.state.formData.cartography → la carte fait partie
// intégrante de la session OI (export/import JSON inclus).

// Style satellite ESRI World Imagery + DEM AWS (relief 3D) + tuiles
// vectorielles OpenFreeMap (uniquement la couche "building" pour l'extrusion).
// Tout sans clé API, sans tracking.
const OI_CARTO_RASTER_STYLE = {
    version: 8,
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri'
        },
        'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: 'Elevation © AWS Terrain Tiles'
        },
        openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '© OpenFreeMap © OpenStreetMap'
        }
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }]
};

// Définitions des pins : icône Material + couleur + libellé générique.
//  - member        : membre PATRACDVR (libellé = trigramme · fonction)
//  - cyno          : équipe cynophile (membre de fonction "Cyno" ou pin générique)
//  - rame_vl       : véhicule de la force (générique ou véhicule du PATRACDVR)
//  - vl_target     : véhicule adverse (générique ou véhicule saisi côté Adversaire)
//  - rassemblement : point de rassemblement
const OI_PIN_DEFS = {
    member:        { icon: 'local_police',   color: '#3b82f6', label: 'Membre' },
    cyno:          { icon: 'pets',           color: '#3b82f6', label: 'Cyno' },
    rame_vl:       { icon: 'directions_car', color: '#3b82f6', label: 'Rame VL' },
    vl_target:     { icon: 'directions_car', color: '#ef4444', label: 'VL Target' },
    rassemblement: { icon: 'groups',         color: '#22c55e', label: 'Rassemblement' }
};
const OI_PIN_FALLBACK = { icon: 'place', color: '#a1a1aa', label: 'Point' };

// Mapping fonction OI → icône Material (placement automatique des membres).
// La cellule "India *" bascule aussi sur l'icône pion d'échecs si la fonction
// n'a pas de mapping plus spécifique.
const OI_FONCTION_ICONS = {
    'chef de dispo': 'stars',
    'chef dispo':    'stars',
    'chef inter':    'support_agent',
    'effrac':        'hardware',
    'inter':         'chess',
    'india':         'chess',
    'chef oscar':    'eye_tracking',
    'ao':            'visibility',
    'conducteur':    'search_hands_free',
    'de':            'saved_search',
    'cyno':          'pets'
};

function oiNormalize(s) {
    return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Icône Material auto pour un membre, d'après sa fonction puis sa cellule. */
function oiIconForMember(fonction, cellule) {
    const f = oiNormalize(fonction);
    if (OI_FONCTION_ICONS[f]) return OI_FONCTION_ICONS[f];
    if (oiNormalize(cellule).startsWith('india')) return 'chess';
    return OI_PIN_DEFS.member.icon; // défaut : gendarme
}

// Catalogue d'icônes pour la sélection libre (roue → Icône).
const OI_ICON_CATALOG = [
    { id: 'stars', label: 'Chef dispo' }, { id: 'support_agent', label: 'Chef inter' },
    { id: 'hardware', label: 'Effrac' }, { id: 'chess', label: 'Inter / India' },
    { id: 'eye_tracking', label: 'Chef Oscar' }, { id: 'visibility', label: 'AO' },
    { id: 'search_hands_free', label: 'Conducteur' }, { id: 'saved_search', label: 'DE' },
    { id: 'pets', label: 'Cyno' }, { id: 'local_police', label: 'Membre' },
    { id: 'military_tech', label: 'Gendarmerie' }, { id: 'shield_person', label: 'Inter armé' },
    { id: 'record_voice_over', label: 'Négociateur' }, { id: 'medical_services', label: 'Médecin' },
    { id: 'local_fire_department', label: 'Pompier' }, { id: 'directions_car', label: 'Véhicule' },
    { id: 'local_shipping', label: 'Camion' }, { id: 'two_wheeler', label: 'Moto' },
    { id: 'groups', label: 'Rassemblement' }, { id: 'person_alert', label: 'Adversaire' },
    { id: 'person_off', label: 'Otage' }, { id: 'target', label: 'Objectif' },
    { id: 'home', label: 'Domicile' }, { id: 'door_front', label: 'Accès' },
    { id: 'flag', label: 'Repère' }, { id: 'dvr', label: 'PC op' },
    { id: 'crisis_alert', label: 'Menace' }, { id: 'videocam', label: 'Caméra' }
];

/**
 * Roue contextuelle (radial menu) — portée depuis pctac2 (wheel.js) en script
 * global. Ouvre un menu radial à un point lng/lat ; suit la carte ; se ferme
 * sur clic extérieur / Échap / bouton central / choix d'une option.
 */
class OIWheel {
    constructor(opts) {
        this.map = opts.map;
        this.lngLat = opts.lngLat;
        this.title = opts.title;
        this.centerIcon = opts.centerIcon || 'close';
        this.options = opts.options || [];
        this.radius = opts.radius || 80;
        this.onClose = opts.onClose;
        this.element = null;
        this._onMove = () => this._position();
        this._onOutside = this._onOutside.bind(this);
        this._onKey = (ev) => { if (ev.key === 'Escape') this.destroy(); };
        this._destroyed = false;
        this._mountedAt = 0;
    }
    open() {
        if (this.element) return;
        this.element = this._buildElement();
        const parent = this.map ? this.map.getContainer() : document.body;
        parent.appendChild(this.element);
        this._position();
        if (this.map) { this.map.on('move', this._onMove); this.map.on('zoom', this._onMove); }
        this._mountedAt = Date.now();
        document.addEventListener('pointerdown', this._onOutside, { capture: true });
        document.addEventListener('touchstart', this._onOutside, { capture: true, passive: true });
        document.addEventListener('keydown', this._onKey);
        requestAnimationFrame(() => { if (this.element) this.element.classList.add('open'); });
    }
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.element) { try { this.element.remove(); } catch (_) {} this.element = null; }
        if (this.map) {
            try { this.map.off('move', this._onMove); } catch (_) {}
            try { this.map.off('zoom', this._onMove); } catch (_) {}
        }
        document.removeEventListener('pointerdown', this._onOutside, { capture: true });
        document.removeEventListener('touchstart', this._onOutside, { capture: true });
        document.removeEventListener('keydown', this._onKey);
        if (this.onClose) { try { this.onClose(); } catch (_) {} }
    }
    _onOutside(ev) {
        if (!this.element) return;
        if (Date.now() - this._mountedAt < 120) return;
        if (!this.element.contains(ev.target)) this.destroy();
    }
    _position() {
        if (!this.element || !this.map) return;
        if (!this.lngLat) {
            const r = this.map.getContainer().getBoundingClientRect();
            this.element.style.left = `${r.width / 2}px`;
            this.element.style.top = `${r.height / 2}px`;
            return;
        }
        const p = this.map.project(this.lngLat);
        this.element.style.left = `${p.x}px`;
        this.element.style.top = `${p.y}px`;
    }
    _buildElement() {
        const n = this.options.length;
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024);
        const radius = vw < 480 ? Math.min(this.radius, 88) : Math.max(this.radius, 98);
        const arcSpan = n <= 2 ? Math.PI : 2 * Math.PI;
        const arcStart = n <= 2 ? -Math.PI / 2 - arcSpan / 2 : -Math.PI / 2;
        const btnSize = vw < 480 ? 52 : 58;
        const wrap = document.createElement('div');
        wrap.className = 'oi-wheel';
        wrap.style.cssText = `position:absolute; width:${radius * 2 + btnSize + 36}px; height:${radius * 2 + btnSize + 36}px;
            transform:translate(-50%,-50%) scale(0.85); opacity:0;
            transition:transform 160ms cubic-bezier(.34,1.56,.64,1), opacity 140ms ease-out; z-index:60; pointer-events:none;`;
        const bg = document.createElement('div');
        bg.style.cssText = `position:absolute; inset:0; border-radius:50%;
            background:radial-gradient(circle at center, rgba(20,24,32,0.55) 0%, rgba(20,24,32,0.10) 70%, transparent 100%); pointer-events:none;`;
        wrap.appendChild(bg);
        const center = document.createElement('button');
        center.type = 'button';
        center.className = 'oi-wheel-center';
        center.title = 'Fermer';
        center.style.cssText = `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
            width:54px; height:54px; border-radius:50%; background:rgba(20,24,32,0.95);
            border:2px solid rgba(255,255,255,0.35); color:#fff; cursor:pointer;
            display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
            pointer-events:auto; box-shadow:0 4px 16px rgba(0,0,0,0.55); touch-action:none; font-family:var(--font-ui,sans-serif);`;
        center.innerHTML = `<span class="material-symbols-outlined" style="font-size:22px; line-height:1;">${this.centerIcon}</span>
            <span style="font-size:9px; font-weight:700; letter-spacing:0.5px; opacity:0.85;">FERMER</span>`;
        center.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        center.onclick = (ev) => { ev.stopPropagation(); this.destroy(); };
        wrap.appendChild(center);
        if (this.title) {
            const t = document.createElement('div');
            t.style.cssText = `position:absolute; left:50%; bottom:-28px; transform:translateX(-50%);
                background:rgba(20,24,32,0.92); color:#fff; padding:3px 10px; border-radius:12px;
                font-family:var(--font-ui,sans-serif); font-size:0.78em; font-weight:600; white-space:nowrap;
                pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,0.4);`;
            t.textContent = this.title;
            wrap.appendChild(t);
        }
        this.options.forEach((opt, i) => {
            const angle = arcStart + (n === 1 ? 0 : (i / Math.max(1, n - (arcSpan >= 2 * Math.PI ? 0 : 1))) * arcSpan);
            const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
            const b = document.createElement('button');
            b.type = 'button';
            b.title = opt.label;
            const bg2 = opt.bg || 'rgba(20,24,32,0.92)';
            const col = opt.color || '#fff';
            const border = opt.color || (opt.bg ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)');
            b.style.cssText = `position:absolute; left:50%; top:50%;
                transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
                width:${btnSize}px; height:${btnSize}px; border-radius:50%; background:${bg2};
                border:2px solid ${border}; color:${col}; cursor:pointer; display:flex; align-items:center; justify-content:center;
                pointer-events:auto; box-shadow:0 3px 12px rgba(0,0,0,0.55); touch-action:none; padding:0;`;
            b.innerHTML = `<span class="material-symbols-outlined" style="font-size:${btnSize >= 56 ? 26 : 22}px; line-height:1;">${opt.icon}</span>`;
            const labelBelow = y > -radius * 0.3;
            const labelOffset = labelBelow ? (btnSize / 2 + 6) : -(btnSize / 2 + 16);
            const tip = document.createElement('span');
            tip.textContent = opt.label;
            tip.style.cssText = `position:absolute; top:calc(50% + ${labelOffset}px); left:50%; transform:translateX(-50%);
                background:rgba(0,0,0,0.85); color:#fff; font-family:var(--font-ui,sans-serif); font-size:0.7em; font-weight:700;
                letter-spacing:0.3px; padding:2px 7px; border-radius:8px; white-space:nowrap; pointer-events:none;
                box-shadow:0 1px 4px rgba(0,0,0,0.5); max-width:110px; overflow:hidden; text-overflow:ellipsis;`;
            b.appendChild(tip);
            b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            b.onclick = (ev) => {
                ev.stopPropagation();
                if (opt.action) { try { opt.action(this); } catch (e) { console.error('[OIWheel] action:', e); } }
                if (!opt.keepOpen) this.destroy();
            };
            wrap.appendChild(b);
        });
        return wrap;
    }
}

if (typeof document !== 'undefined' && !document.getElementById('oi-wheel-style')) {
    const s = document.createElement('style');
    s.id = 'oi-wheel-style';
    s.textContent = `
        .oi-wheel.open { opacity:1 !important; transform:translate(-50%,-50%) scale(1) !important; }
        .oi-wheel button:active { filter:brightness(0.82); box-shadow:0 1px 4px rgba(0,0,0,0.75) inset, 0 1px 5px rgba(0,0,0,0.45); }
        .oi-wheel-center:active { transform:translate(-50%,-50%) scale(0.94) !important; }
        .oi-carto-inline-panel { position:absolute; z-index:62; transform:translate(-50%,-100%);
            background:rgba(20,24,32,0.97); border:1px solid rgba(255,255,255,0.18); border-radius:12px;
            padding:10px; box-shadow:0 8px 28px rgba(0,0,0,0.6); pointer-events:auto;
            font-family:var(--font-ui,sans-serif); color:#fff; max-width:min(92vw,340px); }
        .oi-carto-member-placed { opacity:0.5; filter:grayscale(0.7); }
        .oi-carto-fn-group-title { font-size:0.72em; text-transform:uppercase; letter-spacing:0.5px;
            color:var(--text-muted,#9aa4b2); margin:8px 0 4px; font-weight:700; }
    `;
    document.head.appendChild(s);
}

const OICarto = {
    _activeWheel: null,
    _inlinePanel: null,
    map: null,
    initialized: false,
    is3D: false,
    markers: new Map(),     // id -> { pin: Marker, label: Marker }
    labelsVisible: true,    // affichage des libellés de pins (toggle anti-superposition)
    pendingPin: null,       // { kind, label } en attente d'un clic carte
    drawTool: null,         // 'line' | 'rectangle' | 'circle' | null
    drawColor: '#ef4444',
    drawState: null,        // état temporaire pendant un tracé
    history: [],            // pile JSON des shapes avant chaque modif
    redoStack: [],

    /** Enveloppe un handler : capture toute exception (log) pour qu'une erreur
     *  dans un callback carte/marqueur ne casse pas l'interaction silencieusement. */
    _safe(fn, label) {
        return (...args) => {
            try { return fn(...args); }
            catch (e) { console.error('[OICarto] ' + (label || 'handler') + ' a échoué:', e); }
        };
    },

    /** Ouvre la modale cartographie (init paresseuse de la carte au 1er appel). */
    open() {
        const modal = document.getElementById('cartographyModal');
        if (!modal) return;
        if (typeof maplibregl === 'undefined') {
            alert('Librairie cartographique indisponible (réseau ?). Réessayez en ligne.');
            return;
        }
        if (!modal.open) {
            document.body.classList.add('modal-open');
            modal.showModal();
        }
        if (!this.initialized) {
            this._init();
        } else {
            // La modale était masquée → MapLibre doit recalculer ses dimensions
            setTimeout(() => this.map && this.map.resize(), 60);
        }
    },

    close() {
        const modal = document.getElementById('cartographyModal');
        if (modal && modal.open) modal.close();
    },

    _init() {
        const mapEl = document.getElementById('oi_carto_map');
        if (!mapEl) return;

        const savedView = this._loadView();
        this.map = new maplibregl.Map({
            container: 'oi_carto_map',
            style: OI_CARTO_RASTER_STYLE,
            center: savedView.center,
            zoom: savedView.zoom,
            pitch: savedView.pitch || 0,
            bearing: savedView.bearing || 0,
            preserveDrawingBuffer: true // requis pour la future capture (Lot A3)
        });
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

        this.map.on('moveend', this._safe(() => this._saveView(), 'moveend'));
        this.map.on('pitchend', this._safe(() => this._saveView(), 'pitchend'));
        this.map.on('rotateend', this._safe(() => this._saveView(), 'rotateend'));

        this.map.on('click', this._safe((e) => this._onMapClick(e), 'mapClick'));

        // Drag-to-draw — souris ET tactile
        this.map.on('mousedown', this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('mousemove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('mouseup', this._safe((e) => this._handleDrawUp(e), 'drawUp'));
        this.map.on('touchstart', this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('touchmove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('touchend', this._safe((e) => this._handleDrawUp(e), 'drawUp'));

        this.map.on('load', this._safe(() => {
            this._initDrawingLayers();
            if (savedView.is3D) this._enable3D(false);
            this._renderShapes();
            setTimeout(() => this.map && this.map.resize(), 60);
        }, 'load'));

        this._bindUi();
        this._bindDrawUi();
        this._renderPins();
        this.initialized = true;
    },

    // ------------------------------------------------------------------
    // Persistance — Store.state.formData.cartography
    // ------------------------------------------------------------------

    _getCartoState() {
        if (typeof Store === 'undefined' || !Store.state || !Store.state.formData) return null;
        if (!Store.state.formData.cartography) {
            Store.state.formData.cartography = { view: null, pins: [], shapes: [] };
        }
        return Store.state.formData.cartography;
    },

    _loadView() {
        const carto = this._getCartoState();
        const v = carto && carto.view;
        if (v && Array.isArray(v.center)) return v;
        return { center: [2.3522, 48.8566], zoom: 5 }; // France entière par défaut
    },

    _saveView() {
        if (!this.map) return;
        const carto = this._getCartoState();
        if (!carto) return;
        const c = this.map.getCenter();
        carto.view = {
            center: [c.lng, c.lat],
            zoom: this.map.getZoom(),
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            is3D: this.is3D
        };
    },

    _loadPins() {
        const carto = this._getCartoState();
        return (carto && Array.isArray(carto.pins)) ? carto.pins : [];
    },

    _savePins(pins) {
        const carto = this._getCartoState();
        if (carto) carto.pins = pins;
    },

    _loadShapes() {
        const carto = this._getCartoState();
        return (carto && Array.isArray(carto.shapes)) ? carto.shapes : [];
    },

    _saveShapes(list) {
        const carto = this._getCartoState();
        if (carto) carto.shapes = list;
    },

    // ------------------------------------------------------------------
    // UI générale
    // ------------------------------------------------------------------

    _bindUi() {
        const btnClose = document.getElementById('oi_carto_btn_close');
        if (btnClose) btnClose.onclick = () => this.close();

        const btnSearch = document.getElementById('oi_carto_btn_search');
        if (btnSearch) btnSearch.onclick = () => this._toggleSearchPanel();

        const btnPing = document.getElementById('oi_carto_btn_ping');
        if (btnPing) btnPing.onclick = () => this._openPingModal();

        const btnDraw = document.getElementById('oi_carto_btn_draw');
        if (btnDraw) btnDraw.onclick = () => this._toggleDrawDock();

        const btnCapture = document.getElementById('oi_carto_btn_capture');
        if (btnCapture) btnCapture.onclick = () => this._openCaptureModal();

        const btnLabels = document.getElementById('oi_carto_btn_labels');
        if (btnLabels) btnLabels.onclick = () => this._toggleLabels();

        const btn3d = document.getElementById('oi_carto_btn_3d');
        if (btn3d) btn3d.onclick = () => this._toggle3D();

        const btnFs = document.getElementById('oi_carto_btn_fullscreen');
        if (btnFs) btnFs.onclick = () => this._toggleFullscreen();
        ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
            document.addEventListener(ev, () => this._updateFullscreenIcon()));

        const searchInput = document.getElementById('oi_carto_address_input');
        const searchBtn = document.getElementById('oi_carto_search_btn');
        const searchClose = document.getElementById('oi_carto_search_close');
        if (searchBtn) searchBtn.onclick = () => this._searchAddress();
        if (searchInput) searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._searchAddress(); }
        });
        if (searchClose) searchClose.onclick = () => this._toggleSearchPanel(false);

        // Modale d'ajout de point
        const pingCancel = document.getElementById('oi_carto_ping_cancel');
        if (pingCancel) pingCancel.onclick = () => this._closePingModal();
        const clearPins = document.getElementById('oi_carto_clear_pins');
        if (clearPins) clearPins.onclick = () => this._clearAllPins();

        // Modale de capture
        const capDownload = document.getElementById('oi_carto_capture_download');
        if (capDownload) capDownload.onclick = () => this._downloadCapture();
        const capExport = document.getElementById('oi_carto_capture_export');
        if (capExport) capExport.onclick = () => {
            const sel = document.getElementById('oi_carto_capture_target');
            if (sel && sel.value) this._exportToField(sel.value);
        };
        const capCancel = document.getElementById('oi_carto_capture_cancel');
        if (capCancel) capCancel.onclick = () => this._closeCaptureModal();

        // Hint : clic = annulation du placement en attente
        const hint = document.getElementById('oi_carto_hint');
        if (hint) hint.onclick = () => { this.pendingPin = null; this._hideHint(); };

        const modal = document.getElementById('cartographyModal');
        if (modal) {
            // Sauvegarde de la vue à la fermeture (croix, Échap, bouton)
            modal.addEventListener('close', () => {
                document.body.classList.remove('modal-open');
                this._closeWheel();
                this._closeInlinePanel();
                this._saveView();
            });
            // Échap : si un outil de dessin / un placement est actif, on l'annule
            // au lieu de fermer la modale.
            modal.addEventListener('cancel', (e) => {
                if (this.drawTool) { e.preventDefault(); this._setTool(null); }
                else if (this.pendingPin) { e.preventDefault(); this.pendingPin = null; this._hideHint(); }
            });
        }

        // Raccourcis undo/redo quand la modale est ouverte
        document.addEventListener('keydown', (e) => {
            const m = document.getElementById('cartographyModal');
            if (!m || !m.open) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }
        });
    },

    _toggleSearchPanel(force) {
        const panel = document.getElementById('oi_carto_search_panel');
        const fab = document.getElementById('oi_carto_btn_search');
        if (!panel) return;
        const shouldOpen = force === undefined ? !panel.classList.contains('open') : force;
        panel.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            const input = document.getElementById('oi_carto_address_input');
            if (input) input.focus();
        }
    },

    _toggleFullscreen() {
        const container = document.getElementById('oi_carto_map_wrap');
        if (!container) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl) {
            const req = container.requestFullscreen || container.webkitRequestFullscreen;
            if (req) req.call(container);
        } else {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    },

    _updateFullscreenIcon() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        const active = !!fsEl;
        const btn = document.getElementById('oi_carto_btn_fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = active ? 'fullscreen_exit' : 'fullscreen';
        }
        if (this.map) setTimeout(() => this.map.resize(), 60);
    },

    _showHint(msg) {
        const hint = document.getElementById('oi_carto_hint');
        if (!hint) return;
        hint.textContent = msg + ' (clic ici pour annuler)';
        hint.classList.add('show');
    },

    _hideHint() {
        const hint = document.getElementById('oi_carto_hint');
        if (hint) hint.classList.remove('show');
    },

    // ------------------------------------------------------------------
    // Recherche adresse / GPS (Nominatim, sans clé API)
    // ------------------------------------------------------------------

    /** Détecte des coordonnées GPS décimales "lat, lng". Retourne {lat,lng} ou null. */
    _parseGps(str) {
        const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
        if (!m) return null;
        const lat = parseFloat(m[1].replace(',', '.'));
        const lng = parseFloat(m[2].replace(',', '.'));
        if (isNaN(lat) || isNaN(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng };
    },

    async _searchAddress() {
        const input = document.getElementById('oi_carto_address_input');
        const resultsBox = document.getElementById('oi_carto_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        const gps = this._parseGps(q);
        if (gps) {
            this.map.flyTo({ center: [gps.lng, gps.lat], zoom: 17, speed: 1.4 });
            resultsBox.innerHTML = `<div class="oi-carto-search-result">Point GPS centré : ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}</div>`;
            return;
        }

        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
            if (!r.ok) {
                if (r.status === 429 || r.status === 403) throw new Error('QUOTA');
                throw new Error('HTTP ' + r.status);
            }
            const list = await r.json();
            if (!list.length) {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            const esc = (s) => (window.UIPlatform ? UIPlatform.esc(s) : s);
            resultsBox.innerHTML = list.map((item, i) =>
                `<div class="oi-carto-search-result" data-idx="${i}">${esc(item.display_name)}</div>`
            ).join('');
            resultsBox.querySelectorAll('.oi-carto-search-result').forEach(div => {
                div.onclick = () => {
                    const item = list[parseInt(div.dataset.idx, 10)];
                    this.map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 17, speed: 1.4 });
                    resultsBox.innerHTML = '';
                };
            });
        } catch (e) {
            console.error('[OICarto] Nominatim échec:', e);
            const msg = (e && e.message === 'QUOTA')
                ? 'Quota de recherche atteint. Réessayez dans un instant.'
                : 'Erreur réseau. Vérifiez la connexion.';
            resultsBox.innerHTML = `<em style="color: var(--danger-red);">${msg}</em>`;
        }
    },

    // ------------------------------------------------------------------
    // PINS — membres PATRACDVR + pins OI dédiés
    // ------------------------------------------------------------------

    _openPingModal() {
        const modal = document.getElementById('oi_carto_ping_modal');
        if (!modal) return;
        const labelInput = document.getElementById('oi_carto_pin_label');
        if (labelInput) labelInput.value = '';
        this._renderPingLists();
        if (!modal.open) modal.showModal();
    },

    _closePingModal() {
        const modal = document.getElementById('oi_carto_ping_modal');
        if (modal && modal.open) modal.close();
    },

    /** Construit toutes les sections de la modale d'ajout de point. */
    _renderPingLists() {
        // Membres PATRACDVR — même source que l'outil d'annotation photo.
        const members = Array.from(document.querySelectorAll('.patracdvr-member-btn'))
            .filter(b => b.dataset.trigramme && b.dataset.trigramme !== 'N/A');

        // 1) Membres (hors fonction Cyno) — triés par fonction, icône auto par fonction.
        const memberList = document.getElementById('oi_carto_member_list');
        if (memberList) {
            const regular = members.filter(b => b.dataset.fonction !== 'Cyno');
            this._renderMemberList(memberList, regular, 'member');
        }

        // 2) Cyno — pin générique + membres de fonction "Cyno" — icône chien
        const cynoList = document.getElementById('oi_carto_cyno_list');
        if (cynoList) {
            cynoList.innerHTML = '';
            cynoList.appendChild(this._pinButton('Cyno (générique)', OI_PIN_DEFS.cyno.color,
                () => this._armPinPlacement({ kind: 'cyno', label: this._customOr('Cyno') })));
            const cynoMembers = members.filter(b => b.dataset.fonction === 'Cyno');
            cynoMembers.forEach(b => {
                const tri = b.dataset.trigramme;
                const fonction = b.dataset.fonction || '';
                const label = this._memberLabel(b);
                const placed = this._isMemberPlaced(tri);
                cynoList.appendChild(this._memberButton({
                    text: label, color: OI_PIN_DEFS.cyno.color, placed, tri,
                    onPlace: () => this._armPinPlacement({
                        kind: 'cyno', label, memberTri: tri, fonction,
                        icon: oiIconForMember(fonction, b.dataset.cellule)
                    })
                }));
            });
        }

        // 3) Rame VL — pin générique + véhicules du PATRACDVR — icône véhicule, bleu
        const rameList = document.getElementById('oi_carto_ramevl_list');
        if (rameList) {
            rameList.innerHTML = '';
            rameList.appendChild(this._pinButton('Rame VL (générique)', OI_PIN_DEFS.rame_vl.color,
                () => this._armPinPlacement({ kind: 'rame_vl', label: this._customOr('Rame VL') })));
            this._getPatracdvrVehicles().forEach(name => {
                rameList.appendChild(this._pinButton(name, OI_PIN_DEFS.rame_vl.color,
                    () => this._armPinPlacement({ kind: 'rame_vl', label: name })));
            });
        }

        // 4) VL Target — pin générique + véhicules adverses du formulaire — icône véhicule, rouge
        const vltList = document.getElementById('oi_carto_vltarget_list');
        if (vltList) {
            vltList.innerHTML = '';
            vltList.appendChild(this._pinButton('VL Target (générique)', OI_PIN_DEFS.vl_target.color,
                () => this._armPinPlacement({ kind: 'vl_target', label: this._customOr('VL Target') })));
            this._getAdversaryVehicles().forEach(name => {
                vltList.appendChild(this._pinButton(name, OI_PIN_DEFS.vl_target.color,
                    () => this._armPinPlacement({ kind: 'vl_target', label: name })));
            });
        }

        // 5) Rassemblement — pin générique — icône rassemblement
        const rasList = document.getElementById('oi_carto_rassemblement_list');
        if (rasList) {
            rasList.innerHTML = '';
            rasList.appendChild(this._pinButton('Rassemblement', OI_PIN_DEFS.rassemblement.color,
                () => this._armPinPlacement({ kind: 'rassemblement', label: this._customOr('Rassemblement') })));
        }
    },

    /** Libellé d'un pin membre : "TRI · Fonction" (ou juste le trigramme). */
    _memberLabel(btn) {
        const tri = btn.dataset.trigramme;
        const fonc = btn.dataset.fonction;
        return (fonc && fonc !== 'Sans') ? `${tri} · ${fonc}` : tri;
    },

    /** Valeur du champ libellé personnalisé, sinon le libellé générique fourni. */
    _customOr(fallback) {
        const v = (document.getElementById('oi_carto_pin_label')?.value || '').trim();
        return v || fallback;
    },

    _emptyMsg(txt) {
        return `<p style="color:var(--text-muted); font-size:0.85em; margin:0;">${txt}</p>`;
    },

    _pinButton(text, color, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-btn';
        const darkText = ['#eab308', '#d4af37', '#22c55e', '#94a3b8', '#a1a1aa'].includes(color);
        b.style.cssText = `width:auto; padding:6px 10px; background:${color}; color:${darkText ? '#000' : '#fff'}; border:none;`;
        b.textContent = text;
        b.onclick = onClick;
        return b;
    },

    /** Un membre est-il déjà posé sur la carte ? (clé = trigramme). */
    _isMemberPlaced(tri) {
        return this._loadPins().some(p => p.memberTri && p.memberTri === tri);
    },

    /**
     * Rend la liste des membres triée par Fonction (groupes), chaque membre placé
     * étant grisé. Un clic sur un membre grisé propose : Réinitialiser / Aller à.
     */
    _renderMemberList(container, memberBtns, kind) {
        container.innerHTML = '';
        if (!memberBtns.length) {
            container.innerHTML = this._emptyMsg('Aucun membre PATRACDVR configuré.');
            return;
        }
        // Regroupement par fonction (tri alpha, "Sans" en dernier).
        const groups = {};
        memberBtns.forEach(b => {
            const fonc = (b.dataset.fonction && b.dataset.fonction !== 'Sans') ? b.dataset.fonction : 'Autres';
            (groups[fonc] = groups[fonc] || []).push(b);
        });
        const keys = Object.keys(groups).sort((a, c) => {
            if (a === 'Autres') return 1; if (c === 'Autres') return -1;
            return a.localeCompare(c, 'fr');
        });
        keys.forEach(fonc => {
            const title = document.createElement('div');
            title.className = 'oi-carto-fn-group-title';
            const ic = groups[fonc][0] ? oiIconForMember(groups[fonc][0].dataset.fonction, groups[fonc][0].dataset.cellule) : 'badge';
            title.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">${ic}</span> ${fonc}`;
            container.appendChild(title);
            const row = document.createElement('div');
            row.className = 'oi-carto-ping-list';
            groups[fonc].forEach(b => {
                const tri = b.dataset.trigramme;
                const fonction = b.dataset.fonction || '';
                const cellule = b.dataset.cellule || '';
                const label = this._memberLabel(b);
                row.appendChild(this._memberButton({
                    text: label, color: OI_PIN_DEFS.member.color, placed: this._isMemberPlaced(tri), tri,
                    onPlace: () => this._armPinPlacement({
                        kind, label, memberTri: tri, fonction,
                        icon: oiIconForMember(fonction, cellule)
                    })
                }));
            });
            container.appendChild(row);
        });
    },

    /**
     * Bouton membre. Non placé → arme le placement. Placé → grisé ; un clic
     * déplie deux actions : Réinitialiser (retire le pin) ou Aller à la position.
     */
    _memberButton({ text, color, placed, tri, onPlace }) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:inline-flex; flex-direction:column; gap:4px;';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-btn' + (placed ? ' oi-carto-member-placed' : '');
        const darkText = ['#eab308', '#d4af37', '#22c55e', '#94a3b8', '#a1a1aa'].includes(color);
        b.style.cssText = `width:auto; padding:6px 10px; background:${color}; color:${darkText ? '#000' : '#fff'}; border:none;`;
        b.textContent = placed ? `✓ ${text}` : text;
        b.title = placed ? 'Déjà placé — cliquer pour les options' : 'Cliquer puis toucher la carte pour placer';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:none; gap:6px;';
        if (placed) {
            const reset = document.createElement('button');
            reset.type = 'button'; reset.className = 'add-btn';
            reset.style.cssText = 'width:auto; padding:5px 9px; background:rgba(239,68,68,0.18); color:#fca5a5; border:1px solid #ef4444; font-size:0.8em;';
            reset.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">restart_alt</span> Réinitialiser';
            reset.onclick = (e) => { e.stopPropagation(); this._resetMember(tri); };
            const go = document.createElement('button');
            go.type = 'button'; go.className = 'add-btn';
            go.style.cssText = 'width:auto; padding:5px 9px; background:rgba(59,130,246,0.18); color:#93c5fd; border:1px solid #3b82f6; font-size:0.8em;';
            go.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">my_location</span> Aller à';
            go.onclick = (e) => { e.stopPropagation(); this._goToMember(tri); };
            actions.appendChild(reset);
            actions.appendChild(go);
            b.onclick = () => { actions.style.display = actions.style.display === 'flex' ? 'none' : 'flex'; };
        } else {
            b.onclick = onPlace;
        }
        wrap.appendChild(b);
        wrap.appendChild(actions);
        return wrap;
    },

    /** Retire de la carte le(s) pin(s) d'un membre puis rafraîchit la modale. */
    _resetMember(tri) {
        const pins = this._loadPins().filter(p => !(p.memberTri && p.memberTri === tri));
        this._savePins(pins);
        this._renderPins();
        this._renderPingLists();
    },

    /** Centre la carte sur le pin du membre (ferme la modale d'ajout). */
    _goToMember(tri) {
        const pin = this._loadPins().find(p => p.memberTri && p.memberTri === tri);
        if (!pin) return;
        this._closePingModal();
        if (this.map) this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 17), speed: 1.4 });
    },

    /** Véhicules créés dans le PATRACDVR (lignes .patracdvr-vehicle-row). */
    _getPatracdvrVehicles() {
        return Array.from(document.querySelectorAll('#patracdvr_container .patracdvr-vehicle-row'))
            .map(r => r.dataset.vehicleName)
            .filter(Boolean);
    },

    /** Véhicules adverses saisis dans le formulaire (champ Véhicules de chaque Adversaire). */
    _getAdversaryVehicles() {
        const vals = [];
        document.querySelectorAll('[id^="vehicules_"] .dynamic-input').forEach(inp => {
            const v = (inp.value || '').trim();
            if (v) vals.push(v);
        });
        return Array.from(new Set(vals));
    },

    _armPinPlacement(pending) {
        if (this.drawTool) this._setTool(null);
        this.pendingPin = pending;
        this._closePingModal();
        this._showHint(`Cliquez sur la carte pour placer « ${pending.label} »`);
    },

    _onMapClick(e) {
        // Un clic sur le fond ferme tout panneau flottant d'édition de pin.
        this._closeInlinePanel();
        if (this.drawTool) return; // pendant un dessin, les clics sont gérés ailleurs
        if (!this.pendingPin) return;
        const p = this.pendingPin;
        this._addPin({
            id: 'pin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            kind: p.kind,
            label: p.label,
            // Métadonnées membre + icône auto/personnalisée (placement OI).
            memberTri: p.memberTri || null,
            fonction: p.fonction || null,
            icon: p.icon || null,
            color: p.color || null,
            lng: e.lngLat.lng,
            lat: e.lngLat.lat
        });
        this.pendingPin = null;
        this._hideHint();
        // Rafraîchit la modale d'ajout si encore ouverte (état "placé").
        this._renderPingLists();
    },

    _addPin(pin) {
        const pins = this._loadPins().slice();
        pins.push(pin);
        this._savePins(pins);
        this._renderPins();
    },

    _removePin(id) {
        const pins = this._loadPins().filter(p => p.id !== id);
        this._savePins(pins);
        this._renderPins();
    },

    _clearAllPins() {
        if (!this._loadPins().length) {
            alert('Aucun pin à supprimer.');
            return;
        }
        if (!confirm('Supprimer tous les pins de la carte ?')) return;
        this._savePins([]);
        this._renderPins();
        this._closePingModal();
    },

    _renderPins() {
        if (!this.map) return;
        for (const entry of this.markers.values()) {
            if (entry.pin) entry.pin.remove();
            if (entry.label) entry.label.remove();
        }
        this.markers.clear();

        for (const pin of this._loadPins()) {
            const def = OI_PIN_DEFS[pin.kind] || OI_PIN_FALLBACK;
            const color = pin.color || def.color;          // couleur personnalisée prioritaire
            const icon = pin.icon || def.icon;              // icône auto/personnalisée prioritaire
            const labelOffset = [0, 22];

            // --- 1) Marqueur = icône Material colorée, halo blanc, ancrée au centre ---
            const pinWrap = document.createElement('div');
            pinWrap.style.cssText = 'width:38px; height:38px; cursor:grab; display:flex; align-items:center; justify-content:center;';
            pinWrap.innerHTML = `
                <span class="material-symbols-outlined" style="
                    font-size: 38px; color: ${color}; line-height: 1;
                    text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 2px 4px rgba(0,0,0,0.6);
                    font-variation-settings: 'FILL' 1;">${icon}</span>`;

            const pinMarker = new maplibregl.Marker({ element: pinWrap, anchor: 'center', draggable: true })
                .setLngLat([pin.lng, pin.lat])
                .addTo(this.map);

            // --- 2) Marqueur libellé : trigramme + intitulé SOUS l'icône ---
            // Pour un membre : trigramme (gras) sur la 1re ligne, intitulé (fonction
            // ou texte personnalisé) sur la 2e. Sinon, libellé simple.
            const labelEl = document.createElement('div');
            labelEl.style.cssText = `
                padding: 3px 8px; background: rgba(0,0,0,0.82); color: #fff;
                font-size: 13px; font-weight: 500; line-height: 1.2; border-left: 4px solid ${color};
                border-radius: 3px; white-space: nowrap; text-align: center;
                box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 1px 4px rgba(0,0,0,0.75);
                pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.9); letter-spacing: 0.3px;`;
            if (pin.memberTri) {
                const sub = pin.text || (pin.fonction && pin.fonction !== 'Sans' ? pin.fonction : '');
                labelEl.innerHTML = `<div style="font-weight:700; font-size:13px;">${this._esc(pin.memberTri)}</div>` +
                    (sub ? `<div style="font-size:11px; opacity:0.85;">${this._esc(sub)}</div>` : '');
            } else {
                labelEl.textContent = pin.text || pin.label;
            }
            if (!this.labelsVisible) labelEl.style.display = 'none';
            const labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                .setLngLat([pin.lng, pin.lat])
                .addTo(this.map);

            pinWrap.addEventListener('mouseenter', () => { pinWrap.style.zIndex = '1000'; labelEl.style.zIndex = '1000'; });
            pinWrap.addEventListener('mouseleave', () => { pinWrap.style.zIndex = ''; labelEl.style.zIndex = ''; });

            // --- Drag : pin + libellé se déplacent ensemble ---
            let lastDragEnd = 0;
            pinMarker.on('dragstart', this._safe(() => {
                pinWrap.style.cursor = 'grabbing';
                pinWrap.style.opacity = '0.85';
                labelEl.style.opacity = '0.5';
            }, 'pin:dragstart'));
            pinMarker.on('drag', this._safe(() => labelMarker.setLngLat(pinMarker.getLngLat()), 'pin:drag'));
            pinMarker.on('dragend', this._safe(() => {
                pinWrap.style.cursor = 'grab';
                pinWrap.style.opacity = '1';
                labelEl.style.opacity = '1';
                lastDragEnd = Date.now();
                const ll = pinMarker.getLngLat();
                labelMarker.setLngLat(ll);
                const allPins = this._loadPins().slice();
                const target = allPins.find(p => p.id === pin.id);
                if (target) { target.lng = ll.lng; target.lat = ll.lat; this._savePins(allPins); }
            }, 'pin:dragend'));

            // --- Tap (sans drag) → roue d'options portée (Icône / Couleur / Renommer / Aller à / Supprimer) ---
            pinWrap.addEventListener('click', this._safe((ev) => {
                if (Date.now() - lastDragEnd < 300) return; // clic qui suit un drag : ignoré
                ev.stopPropagation();
                this._openPinWheel(pin.id);
            }, 'pin:click'));

            this.markers.set(pin.id, { pin: pinMarker, label: labelMarker });
        }
    },

    _esc(s) {
        return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    },

    // ------------------------------------------------------------------
    // Roue d'options d'un pin (système porté de pctac2)
    // ------------------------------------------------------------------

    _closeWheel() {
        if (this._activeWheel) { try { this._activeWheel.destroy(); } catch (_) {} this._activeWheel = null; }
    },

    _closeInlinePanel() {
        if (this._inlinePanel) { try { this._inlinePanel.remove(); } catch (_) {} this._inlinePanel = null; }
        if (this._inlinePanelMove && this.map) {
            try { this.map.off('move', this._inlinePanelMove); this.map.off('zoom', this._inlinePanelMove); } catch (_) {}
            this._inlinePanelMove = null;
        }
    },

    _openPinWheel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        this._closeWheel();
        this._closeInlinePanel();
        const ll = { lng: pin.lng, lat: pin.lat };
        const opts = [
            { id: 'icon', icon: 'category', label: 'Icône', bg: 'rgba(59,130,246,0.95)', action: () => this._openPinIconPanel(pinId) },
            { id: 'color', icon: 'palette', label: 'Couleur', bg: 'rgba(168,85,247,0.95)', action: () => this._openPinColorPanel(pinId) },
            { id: 'rename', icon: 'edit', label: 'Renommer', bg: 'rgba(234,179,8,0.95)', color: '#000', action: () => this._openPinRenamePanel(pinId) },
            { id: 'goto', icon: 'my_location', label: 'Centrer', bg: 'rgba(34,197,94,0.95)', color: '#000', action: () => this.map && this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 17), speed: 1.2 }) },
            { id: 'delete', icon: 'delete', label: 'Supprimer', bg: 'rgba(239,68,68,0.95)', action: () => { this._removePin(pinId); this._renderPingLists(); } }
        ];
        this._activeWheel = new OIWheel({
            map: this.map, lngLat: ll,
            title: pin.memberTri ? `${pin.memberTri}${pin.fonction && pin.fonction !== 'Sans' ? ' · ' + pin.fonction : ''}` : (pin.text || pin.label),
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Panneau flottant ancré au pin (suit la carte). */
    _openInlinePanel(lngLat, innerHtml, onMount) {
        this._closeInlinePanel();
        const panel = document.createElement('div');
        panel.className = 'oi-carto-inline-panel';
        panel.innerHTML = innerHtml;
        panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        panel.addEventListener('click', (e) => e.stopPropagation());
        const parent = this.map.getContainer();
        parent.appendChild(panel);
        const place = () => {
            const p = this.map.project(lngLat);
            panel.style.left = `${p.x}px`;
            panel.style.top = `${p.y - 26}px`;
        };
        place();
        this._inlinePanelMove = place;
        this.map.on('move', place); this.map.on('zoom', place);
        this._inlinePanel = panel;
        if (onMount) onMount(panel);
        return panel;
    },

    _openPinIconPanel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        const cells = OI_ICON_CATALOG.map(ic => `
            <button type="button" class="oi-ic" data-id="${ic.id}" title="${this._esc(ic.label)}"
                style="display:flex; flex-direction:column; align-items:center; gap:2px; padding:7px 4px; border-radius:8px; cursor:pointer;
                       background:${(pin.icon || '') === ic.id ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.05)'};
                       border:1px solid ${(pin.icon || '') === ic.id ? '#3b82f6' : 'rgba(255,255,255,0.12)'}; color:#fff;">
                <span class="material-symbols-outlined" style="font-size:22px;">${ic.id}</span>
                <span style="font-size:0.6em; text-align:center; line-height:1.05;">${this._esc(ic.label)}</span>
            </button>`).join('');
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#60a5fa;">category</span>
                <strong style="font-size:13px;">Choisir une icône</strong>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; max-height:230px; overflow-y:auto;">${cells}</div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            panel.querySelectorAll('.oi-ic').forEach(b => {
                b.onclick = () => {
                    const list = this._loadPins();
                    const t = list.find(p => p.id === pinId);
                    if (t) { t.icon = b.dataset.id; this._savePins(list); this._renderPins(); }
                    this._closeInlinePanel();
                };
            });
        });
    },

    _openPinColorPanel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        const colors = ['#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ffffff'];
        const chips = colors.map(c => `
            <button type="button" class="oi-col" data-c="${c}"
                style="width:30px; height:30px; border-radius:50%; cursor:pointer; background:${c};
                       border:2px solid ${(pin.color || '') === c ? '#fff' : 'rgba(255,255,255,0.25)'};"></button>`).join('');
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#c084fc;">palette</span>
                <strong style="font-size:13px;">Couleur du pin</strong>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; max-width:240px;">${chips}</div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            panel.querySelectorAll('.oi-col').forEach(b => {
                b.onclick = () => {
                    const list = this._loadPins();
                    const t = list.find(p => p.id === pinId);
                    if (t) { t.color = b.dataset.c; this._savePins(list); this._renderPins(); }
                    this._closeInlinePanel();
                };
            });
        });
    },

    _openPinRenamePanel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        const current = pin.text || (pin.memberTri ? (pin.fonction || '') : pin.label);
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#fcd34d;">edit</span>
                <strong style="font-size:13px;">${pin.memberTri ? 'Intitulé du membre' : 'Renommer le point'}</strong>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" id="oi_pin_rename_input" value="${this._esc(current)}"
                    style="flex:1; min-width:170px; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.2);
                           border-radius:8px; padding:7px 10px; font-size:14px; outline:none;">
                <button type="button" id="oi_pin_rename_ok"
                    style="background:#22c55e; border:none; color:#000; border-radius:8px; width:38px; height:38px; cursor:pointer;">
                    <span class="material-symbols-outlined" style="font-size:20px;">check</span>
                </button>
            </div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            const input = panel.querySelector('#oi_pin_rename_input');
            const apply = () => {
                const list = this._loadPins();
                const t = list.find(p => p.id === pinId);
                if (t) {
                    const v = (input.value || '').trim();
                    t.text = v;
                    if (!t.memberTri) t.label = v || t.label;
                    this._savePins(list); this._renderPins();
                }
                this._closeInlinePanel();
            };
            panel.querySelector('#oi_pin_rename_ok').onclick = apply;
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
            setTimeout(() => input.focus(), 40);
        });
    },

    /** Affiche / masque tous les libellés de pins (anti-superposition). */
    _toggleLabels() {
        this.labelsVisible = !this.labelsVisible;
        const fab = document.getElementById('oi_carto_btn_labels');
        if (fab) {
            fab.classList.toggle('active', !this.labelsVisible);
            const icon = fab.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = this.labelsVisible ? 'label' : 'label_off';
        }
        for (const entry of this.markers.values()) {
            if (entry.label) entry.label.getElement().style.display = this.labelsVisible ? '' : 'none';
        }
    },

    // ------------------------------------------------------------------
    // CAPTURE — téléchargement ou export vers un champ photo de l'OI
    // ------------------------------------------------------------------

    _openCaptureModal() {
        const modal = document.getElementById('oi_carto_capture_modal');
        if (!modal) return;
        const sel = document.getElementById('oi_carto_capture_target');
        if (sel) {
            const targets = this._getPhotoTargets();
            sel.innerHTML = targets.length
                ? targets.map(t => `<option value="${t.id}">${t.label}</option>`).join('')
                : '<option value="">Aucun champ photo disponible</option>';
        }
        if (!modal.open) modal.showModal();
    },

    _closeCaptureModal() {
        const modal = document.getElementById('oi_carto_capture_modal');
        if (modal && modal.open) modal.close();
    },

    /** Liste des conteneurs photo de l'OI ciblables par l'export.
     *  2 champs statiques (Transport) + champs par bloc dynamique (MOICP / ZMSPCP /
     *  Effraction), chacun étiqueté avec le titre éditable de son bloc. */
    _getPhotoTargets() {
        const targets = [
            { id: 'photo_container_transport_pr_preview_container', label: 'Transport PSIG → PR' },
            { id: 'photo_container_transport_domicile_preview_container', label: 'Transport PR → Domicile / LE' }
        ];
        const titleOf = (block, fallback) =>
            (block.querySelector('.block-title-input')?.value || fallback).trim();
        document.querySelectorAll('.moicp-block').forEach(b => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'MOICP');
            targets.push({ id: `photo_itin_ext_${bid}`, label: `Cheminement extérieur — ${t}` });
            targets.push({ id: `photo_itin_int_${bid}`, label: `Cheminement intérieur — ${t}` });
        });
        document.querySelectorAll('.zmspcp-block').forEach(b => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'ZMSPCP');
            targets.push({ id: `photo_bapteme_${bid}`, label: `Baptême terrain — ${t}` });
            targets.push({ id: `photo_empl_ao_${bid}`, label: `Emplacement AO — ${t}` });
        });
        document.querySelectorAll('.effraction-block').forEach(b => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'Effraction');
            targets.push({ id: `photo_effrac_${bid}`, label: `Photo effraction — ${t}` });
        });
        return targets.filter(t => document.getElementById(t.id));
    },

    /** Capture composite : canvas WebGL MapLibre + overlay DOM (UI flottante exclue).
     *  Fonctionne aussi en plein écran — on ne passe jamais html2canvas sur tout
     *  le conteneur (ce qui produirait un canvas démesuré). */
    async _captureCanvas() {
        if (typeof html2canvas === 'undefined') {
            alert('Librairie html2canvas indisponible (réseau ?).');
            return null;
        }
        const mapContainer = document.getElementById('oi_carto_map_wrap');
        if (!mapContainer || !this.map) return null;

        const toHide = [
            document.querySelector('.oi-carto-toolbar'),
            document.getElementById('oi_carto_draw_dock'),
            document.getElementById('oi_carto_search_panel'),
            document.getElementById('oi_carto_hint')
        ].filter(Boolean);
        const memo = toHide.map(el => el.style.display);
        toHide.forEach(el => { el.style.display = 'none'; });

        this.map.triggerRepaint();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        let outCanvas = null;
        try {
            const glCanvas = this.map.getCanvas();
            const w = glCanvas.width;
            const h = glCanvas.height;
            const dpr = w / glCanvas.clientWidth;
            const overlay = await html2canvas(mapContainer, {
                useCORS: true, allowTaint: false, backgroundColor: null, logging: false,
                scale: dpr, width: glCanvas.clientWidth, height: glCanvas.clientHeight,
                ignoreElements: (el) => el.tagName === 'CANVAS'
            });
            outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            const ctx = outCanvas.getContext('2d');
            ctx.drawImage(glCanvas, 0, 0, w, h);
            ctx.drawImage(overlay, 0, 0, w, h);
        } catch (e) {
            console.error('[OICarto] capture échec:', e);
            alert('Erreur lors de la capture : ' + e.message);
            outCanvas = null;
        } finally {
            toHide.forEach((el, i) => { el.style.display = memo[i] || ''; });
        }
        return outCanvas;
    },

    async _downloadCapture() {
        const canvas = await this._captureCanvas();
        if (!canvas) return;
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url;
            a.download = `carte-oi-${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    },

    /** Capture la carte et l'injecte dans un conteneur photo via le pipeline OI
     *  existant (handleFileChange → compression + IndexedDB + dynamic_photos). */
    async _exportToField(containerId) {
        if (!containerId) return;
        if (typeof handleFileChange !== 'function') {
            alert('Pipeline photo indisponible.');
            return;
        }
        const canvas = await this._captureCanvas();
        if (!canvas) return;
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
        if (!blob) { alert('Capture échouée.'); return; }

        // On réutilise handleFileChange via un <input> détaché alimenté par DataTransfer.
        try {
            const file = new File([blob], `carte_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const fakeInput = document.createElement('input');
            fakeInput.type = 'file';
            fakeInput.files = dt.files;
            await handleFileChange(fakeInput, containerId, false);
            this._closeCaptureModal();
            if (typeof toast === 'function') toast('Capture de carte ajoutée au champ photo.');
            else alert('Capture de carte ajoutée au champ photo.');
        } catch (e) {
            console.error('[OICarto] export champ photo échec:', e);
            alert('Export impossible : ' + e.message);
        }
    },

    // ------------------------------------------------------------------
    // DESSINS (shapes) — trait / rectangle / cercle, undo/redo
    // ------------------------------------------------------------------

    _initDrawingLayers() {
        // Bâtiments 3D (extrusion OSM via OpenFreeMap), masqués hors mode 3D.
        try {
            this.map.addLayer({
                id: 'buildings-3d',
                type: 'fill-extrusion',
                source: 'openfreemap',
                'source-layer': 'building',
                minzoom: 13,
                layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': '#c2cad2',
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                    'fill-extrusion-opacity': 0.85
                }
            });
        } catch (e) {
            console.error('[OICarto] couche bâtiments 3D échec:', e);
        }

        // Source "committed" (dessins persistés)
        this.map.addSource('oi-carto-shapes-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({
            id: 'oi-carto-shapes-fill', type: 'fill', source: 'oi-carto-shapes-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: { 'fill-color': ['coalesce', ['get', 'color'], '#ef4444'], 'fill-opacity': 0.18 }
        });
        this.map.addLayer({
            id: 'oi-carto-shapes-line', type: 'line', source: 'oi-carto-shapes-src',
            paint: { 'line-color': ['coalesce', ['get', 'color'], '#ef4444'], 'line-width': 3, 'line-opacity': 0.9 }
        });

        // Source "preview" (dessin en cours)
        this.map.addSource('oi-carto-preview-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({
            id: 'oi-carto-preview-fill', type: 'fill', source: 'oi-carto-preview-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: { 'fill-color': ['coalesce', ['get', 'color'], '#ef4444'], 'fill-opacity': 0.12 }
        });
        this.map.addLayer({
            id: 'oi-carto-preview-line', type: 'line', source: 'oi-carto-preview-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9
            }
        });

        this.map.on('click', 'oi-carto-shapes-fill', (e) => this._onShapeClick(e));
        this.map.on('click', 'oi-carto-shapes-line', (e) => this._onShapeClick(e));
    },

    _bindDrawUi() {
        document.querySelectorAll('.oi-carto-draw-btn[data-tool]').forEach(btn => {
            btn.onclick = () => this._setTool(btn.dataset.tool);
        });
        document.querySelectorAll('.oi-carto-draw-color').forEach(btn => {
            btn.onclick = () => this._setDrawColor(btn.dataset.color);
        });
        const clearBtn = document.getElementById('oi_carto_draw_clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!this._loadShapes().length) return;
            if (!confirm('Effacer tous les dessins ?')) return;
            this._pushHistory();
            this._saveShapes([]);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        };
        const undoBtn = document.getElementById('oi_carto_draw_undo');
        if (undoBtn) undoBtn.onclick = () => this._undo();
        const redoBtn = document.getElementById('oi_carto_draw_redo');
        if (redoBtn) redoBtn.onclick = () => this._redo();
        this._setDrawColor(this.drawColor);
        this._refreshUndoRedoButtons();
    },

    _toggleDrawDock(force) {
        const dock = document.getElementById('oi_carto_draw_dock');
        const fab = document.getElementById('oi_carto_btn_draw');
        if (!dock) return;
        const shouldOpen = force === undefined ? !dock.classList.contains('open') : force;
        dock.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (!shouldOpen && this.drawTool) this._setTool(null);
    },

    _setTool(tool) {
        if (tool && this.drawTool === tool) tool = null; // toggle
        this.drawTool = tool;
        this.drawState = null;
        this._clearPreview();
        if (tool) { this.pendingPin = null; this._hideHint(); }

        document.querySelectorAll('.oi-carto-draw-btn[data-tool]').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active
                ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff')
                : 'var(--text-primary)';
        });

        if (this.map) {
            this.map.getCanvas().style.cursor = tool ? 'crosshair' : '';
            if (tool) {
                this.map.dragPan.disable();
                this.map.doubleClickZoom.disable();
                this.map.boxZoom.disable();
            } else {
                this.map.dragPan.enable();
                this.map.doubleClickZoom.enable();
                this.map.boxZoom.enable();
            }
        }
    },

    _setDrawColor(color) {
        this.drawColor = color;
        document.querySelectorAll('.oi-carto-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        if (this.drawTool) this._setTool(this.drawTool);
    },

    _handleDrawDown(e) {
        if (!this.drawTool) return;
        if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
        if (e.preventDefault) e.preventDefault();
        const lngLat = [e.lngLat.lng, e.lngLat.lat];
        this.drawState = { start: lngLat, current: lngLat };
    },

    _handleDrawMove(e) {
        if (!this.drawTool || !this.drawState) return;
        const cursor = [e.lngLat.lng, e.lngLat.lat];
        this.drawState.current = cursor;
        if (this.drawTool === 'line') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [this.drawState.start, cursor] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'rectangle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(this.drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'circle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._circlePolygon(this.drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
        }
    },

    _handleDrawUp(e) {
        if (!this.drawTool || !this.drawState) return;
        const end = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : this.drawState.current;
        const start = this.drawState.start;
        const p1 = this.map.project({ lng: start[0], lat: start[1] });
        const p2 = this.map.project({ lng: end[0], lat: end[1] });
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 4) {
            this.drawState = null;
            this._clearPreview();
            return;
        }
        if (this.drawTool === 'line') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'line', color: this.drawColor, coords: [start, end] });
        } else if (this.drawTool === 'rectangle') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'rectangle', color: this.drawColor, coords: this._rectPolygon(start, end) });
        } else if (this.drawTool === 'circle') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'circle', color: this.drawColor, center: start, edge: end, coords: this._circlePolygon(start, end) });
        }
    },

    _finishShape(shape) {
        this._pushHistory();
        const list = this._loadShapes().slice();
        list.push(shape);
        this._saveShapes(list);
        this.drawState = null;
        this._clearPreview();
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // L'outil reste actif pour enchaîner ; Échap pour quitter.
    },

    _renderPreview(feature) {
        const src = this.map && this.map.getSource('oi-carto-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    _clearPreview() {
        const src = this.map && this.map.getSource('oi-carto-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
    },

    _renderShapes() {
        const src = this.map && this.map.getSource('oi-carto-shapes-src');
        if (!src) return;
        const features = this._loadShapes().map(s => {
            if (s.type === 'line') {
                return { type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color, shapeId: s.id } };
            }
            return { type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [s.coords] }, properties: { color: s.color, shapeId: s.id } };
        });
        src.setData({ type: 'FeatureCollection', features });
    },

    _onShapeClick(e) {
        if (this.drawTool) return;
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        if (!confirm('Supprimer ce dessin ?')) return;
        this._pushHistory();
        this._saveShapes(this._loadShapes().filter(s => s.id !== id));
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _pushHistory() {
        this.history.push(JSON.stringify(this._loadShapes()));
        if (this.history.length > 50) this.history.shift();
        this.redoStack = [];
    },

    _undo() {
        if (!this.history.length) return;
        this.redoStack.push(JSON.stringify(this._loadShapes()));
        try { this._saveShapes(JSON.parse(this.history.pop())); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _redo() {
        if (!this.redoStack.length) return;
        this.history.push(JSON.stringify(this._loadShapes()));
        try { this._saveShapes(JSON.parse(this.redoStack.pop())); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _refreshUndoRedoButtons() {
        const undoBtn = document.getElementById('oi_carto_draw_undo');
        const redoBtn = document.getElementById('oi_carto_draw_redo');
        if (undoBtn) {
            undoBtn.style.opacity = this.history.length ? '1' : '0.35';
            undoBtn.style.cursor = this.history.length ? 'pointer' : 'not-allowed';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length ? '1' : '0.35';
            redoBtn.style.cursor = this.redoStack.length ? 'pointer' : 'not-allowed';
        }
    },

    /** Rectangle aligné carte = polygone fermé à 5 points. */
    _rectPolygon(a, b) {
        return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
    },

    /** Approximation polygonale d'un cercle géodésique (64 segments). */
    _circlePolygon(center, edge) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const [lng1, lat1] = center;
        const [lng2, lat2] = edge;
        const phi1 = toRad(lat1), phi2 = toRad(lat2);
        const dPhi = toRad(lat2 - lat1);
        const dLambda = toRad(lng2 - lng1);
        const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
        const radiusMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const N = 64;
        const coords = [];
        for (let i = 0; i <= N; i++) {
            const brg = (2 * Math.PI * i) / N;
            const sinPhi = Math.sin(phi1) * Math.cos(radiusMeters / R) +
                Math.cos(phi1) * Math.sin(radiusMeters / R) * Math.cos(brg);
            const phi = Math.asin(sinPhi);
            const lambda = toRad(lng1) + Math.atan2(
                Math.sin(brg) * Math.sin(radiusMeters / R) * Math.cos(phi1),
                Math.cos(radiusMeters / R) - Math.sin(phi1) * sinPhi
            );
            coords.push([toDeg(lambda), toDeg(phi)]);
        }
        return coords;
    },

    // ------------------------------------------------------------------
    // Relief 3D + bâtiments
    // ------------------------------------------------------------------

    _toggle3D() {
        if (this.is3D) this._disable3D();
        else this._enable3D(true);
    },

    _enable3D(animate = true) {
        if (!this.map) return;
        try {
            this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
        } catch (e) {
            console.error('[OICarto] setTerrain échec:', e);
            alert('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.');
            return;
        }
        try {
            if (typeof this.map.setSky === 'function') {
                this.map.setSky({
                    'sky-color': '#7ab8e6',
                    'sky-horizon-blend': 0.6,
                    'horizon-color': '#dfeefc',
                    'horizon-fog-blend': 0.6,
                    'fog-color': '#cfd8e0',
                    'fog-ground-blend': 0.4
                });
            }
        } catch (e) { /* ciel optionnel */ }
        try {
            if (this.map.getLayer('buildings-3d')) {
                this.map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
            }
        } catch (e) { /* couche absente si init échouée */ }

        this.is3D = true;
        const fab = document.getElementById('oi_carto_btn_3d');
        if (fab) fab.classList.add('active');

        if (animate) {
            const targetPitch = this.map.getPitch() < 20 ? 60 : this.map.getPitch();
            this.map.easeTo({ pitch: targetPitch, duration: 900 });
        }
        this._saveView();
    },

    _disable3D() {
        if (!this.map) return;
        try { this.map.setTerrain(null); } catch (e) {}
        try { if (typeof this.map.setSky === 'function') this.map.setSky(null); } catch (e) {}
        try {
            if (this.map.getLayer('buildings-3d')) {
                this.map.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
        } catch (e) {}
        this.is3D = false;
        const fab = document.getElementById('oi_carto_btn_3d');
        if (fab) fab.classList.remove('active');
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
        this._saveView();
    }
};

window.OICarto = OICarto;

(function () {
    function bindDockButton() {
        const btn = document.getElementById('cartographyBtn');
        if (btn) btn.addEventListener('click', () => OICarto.open());
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindDockButton);
    } else {
        bindDockButton();
    }
})();
