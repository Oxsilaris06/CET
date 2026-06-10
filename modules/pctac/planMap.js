/**
 * Vue Plan tactique — MapLibre + Nominatim (OSM).
 *
 * Pourquoi : le PC TAC est souvent déporté du lieu réel, donc la géoloc du
 * navigateur n'a aucun intérêt. On utilise une recherche d'adresse pure
 * (Nominatim, gratuit, sans clé API) pour centrer la carte sur l'objectif.
 *
 * Pins :
 *  - liés à une entité (Adversaire/Otage/Ami) → couleur OTAN automatique
 *  - libres (catégorie OTAN choisie : hostile / civil / ami / neutre / inconnu)
 *
 * Persistance : pcTacPlanPins (localStorage), petit volume, pas besoin d'IDB.
 */

import { Storage } from './storage.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PIN_ICONS, suggestPinIcons } from './config.js';
import { Wheel } from './wheel.js';

const PINS_KEY = 'pcTacPlanPins';
const VIEW_KEY = 'pcTacPlanView';
const SHAPES_KEY = 'pcTacPlanShapes';

// Code couleur — strictement aligné sur la légende affichée
// (--danger-red, --civil-yellow, --inter-blue, --ao-green dans pctac2.html)
const ENTITY_COLORS = {
    adv: '#ef4444',    // Adv  / rouge
    host: '#eab308',   // Otage / jaune
    friend: '#3b82f6'  // Inter / bleu
};

// Style satellite ESRI World Imagery + modèle d'élévation (DEM) AWS Open Data
// Tout sans clé API, sans tracking. Le DEM ne sert qu'au relief 3D (setTerrain).
const RASTER_STYLE = {
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
        // Tuiles vectorielles OpenFreeMap — sans clé API. On n'en exploite que
        // la couche "building" pour l'extrusion 3D ; le reste n'est pas rendu.
        openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '© OpenFreeMap © OpenStreetMap'
        }
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }]
};

export const PlanMap = {
    map: null,
    markers: new Map(), // id -> { pin: Marker, label: Marker }
    pendingFreePin: null, // { label, color, kind } en attente d'un clic carte
    searchMarker: null,  // pointeur précis sur l'adresse cherchée
    initialized: false,
    drawTool: null, // 'line' | 'rectangle' | 'circle' | null
    drawColor: '#ef4444',
    drawState: null, // état temporaire pendant un tracé en cours
    drawPreviewLayerIds: ['plan-draw-preview-fill', 'plan-draw-preview-line'],
    history: [],     // pile d'états {shapes} avant chaque modif
    redoStack: [],   // états annulés réutilisables via redo
    is3D: false,     // mode relief 3D actif
    _selectedShapeId: null,  // forme actuellement sélectionnée (handles visibles)
    _handleMarkers: [],      // poignées HTML rendues pour la forme sélectionnée
    _textMarkers: [],        // labels HTML pour annotations texte
    _diameterMarkers: [],    // labels HTML pour diamètres de cercle
    _toolbarMarker: null,    // barre flottante (HTML marker) attachée à la forme
    _contextPopup: null,     // popup maplibre actuel (legacy, conservé pour compat)
    _gesture: null,          // état du geste en cours (tap/drag/resize/pinch)
    _diameterGlobal: true,   // toggle global : afficher diamètres (défaut ON)
    _drawingDiameterMarker: null,  // label live pendant le tracé d'un cercle
    _locked: false,          // verrou global : fige la position des pings ET dessins

    /**
     * Enveloppe un handler d'événement : capture toute exception et la journalise,
     * pour qu'une erreur dans UN callback (drag, pointer, geste…) ne casse pas
     * silencieusement l'interaction ni n'interrompe les autres listeners MapLibre.
     */
    _safe(fn, label) {
        return (...args) => {
            try { return fn(...args); }
            catch (e) { console.error('[PlanMap] ' + (label || 'handler') + ' a échoué:', e); }
        };
    },

    init() {
        if (this.initialized) return;
        const mapEl = document.getElementById('plan_map');
        if (!mapEl) return;

        // Garde : si la lib MapLibre n'a pas chargé (CDN bloqué / hors-ligne),
        // on n'essaie pas d'instancier la carte (sinon ReferenceError opaque).
        if (typeof maplibregl === 'undefined') {
            console.error('[PlanMap] MapLibre indisponible (CDN ?).');
            mapEl.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; padding:24px; text-align:center; color:var(--text-muted,#9aa4b2); font-family:var(--font-ui,sans-serif);">'
                + 'Carte indisponible : la librairie cartographique n\'a pas pu être chargée (réseau ?).<br>Reconnecte-toi puis recharge la page.</div>';
            return;
        }

        // Restaure l'état de verrouillage (position des pings/dessins figée).
        try { this._locked = localStorage.getItem('pcTacPlanLocked') === '1'; } catch (_) { this._locked = false; }

        const savedView = this._loadView();
        this.map = new maplibregl.Map({
            container: 'plan_map',
            style: RASTER_STYLE,
            center: savedView.center,
            zoom: savedView.zoom,
            pitch: savedView.pitch || 0,
            bearing: savedView.bearing || 0,
            preserveDrawingBuffer: true // requis pour la capture screenshot
        });
        // NavigationControl avec boussole + bouton pitch visualisé
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

        this.map.on('moveend', this._safe(() => this._saveView(), 'moveend'));
        this.map.on('pitchend', this._safe(() => this._saveView(), 'pitchend'));
        this.map.on('rotateend', this._safe(() => this._saveView(), 'rotateend'));

        // Restaurer le relief 3D si la vue sauvegardée était inclinée
        if (savedView.is3D) {
            this.map.on('load', this._safe(() => this._enable3D(false), 'load:3D'));
        }
        this.map.on('click', this._safe((e) => this._onMapClick(e), 'mapClick'));

        // Drag-to-draw (mousedown / move / up) — souris ET tactile
        this.map.on('mousedown', this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('mousemove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('mouseup',   this._safe((e) => this._handleDrawUp(e), 'drawUp'));
        this.map.on('touchstart',this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('touchmove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('touchend',  this._safe((e) => this._handleDrawUp(e), 'drawUp'));

        this._bindUi();

        this.map.on('load', () => {
            this._initDrawingLayers();
            this._bindDrawUi();
            this._bindTextModalOnce();
            this._renderShapes();
            this._renderShapeTexts();
        });

        this._renderPins();
        this.initialized = true;
    },

    /** Appelé à chaque switch sur la vue Plan (resize quand le conteneur devient visible) */
    refresh() {
        if (!this.initialized) {
            this.init();
            return;
        }
        // Quand la vue passe de display:none → block, maplibre a besoin d'un resize
        setTimeout(() => this.map && this.map.resize(), 50);
        this._renderPins();
    },

    _loadView() {
        try {
            const v = JSON.parse(localStorage.getItem(VIEW_KEY));
            if (v && v.center && Array.isArray(v.center)) return v;
        } catch (e) {}
        return { center: [2.3522, 48.8566], zoom: 5 }; // Paris par défaut, vue France
    },

    _saveView() {
        if (!this.map) return;
        const c = this.map.getCenter();
        localStorage.setItem(VIEW_KEY, JSON.stringify({
            center: [c.lng, c.lat],
            zoom: this.map.getZoom(),
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            is3D: this.is3D
        }));
    },

    /** Bascule 2D <-> 3D relief */
    _toggle3D() {
        if (this.is3D) this._disable3D();
        else this._enable3D(true);
    },

    /** Active le relief 3D (terrain DEM + ciel + inclinaison caméra).
     *  @param {boolean} animate - true = ease vers le pitch, false = restauration directe */
    _enable3D(animate = true) {
        if (!this.map) return;
        try {
            this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
        } catch (e) {
            console.error('[PlanMap] setTerrain échec:', e);
            alert('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.');
            return;
        }
        // Ciel atmosphérique (si supporté par la version MapLibre)
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
        } catch (e) { /* ciel optionnel, on ignore */ }

        // Afficher les bâtiments 3D
        try {
            if (this.map.getLayer('buildings-3d')) {
                this.map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
            }
        } catch (e) { /* couche absente si init échouée */ }

        this.is3D = true;
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.add('active');

        if (animate) {
            // Si la vue est à plat, on incline à 60° pour révéler le relief
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
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.remove('active');
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
        this._saveView();
    },

    _bindUi() {
        const searchInput = document.getElementById('plan_address_input');
        const searchBtn = document.getElementById('plan_search_btn');
        const searchClose = document.getElementById('plan_search_close');

        if (searchBtn) searchBtn.onclick = () => this._searchAddress();
        if (searchInput) searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._searchAddress(); }
        });
        if (searchClose) searchClose.onclick = () => this._toggleSearchPanel(false);

        // --- Toolbar unifiée : 6 FABs ---
        const btnSearch = document.getElementById('plan_btn_search');
        if (btnSearch) btnSearch.onclick = () => this._toggleSearchPanel();

        const btnFs = document.getElementById('plan_btn_fullscreen');
        if (btnFs) btnFs.onclick = () => this._toggleFullscreen();
        // Maintenir l'icône à jour quel que soit le déclencheur (FAB ou touche Échap)
        ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
            document.addEventListener(ev, () => this._updateFullscreenIcon()));

        const btn3d = document.getElementById('plan_btn_3d');
        if (btn3d) btn3d.onclick = () => this._toggle3D();

        const captureBtn = document.getElementById('plan_btn_capture');
        if (captureBtn) captureBtn.onclick = () => this._takeScreenshot();

        const pingBtn = document.getElementById('plan_btn_ping');
        if (pingBtn) pingBtn.onclick = () => {
            // Roue centrée sur la vue actuelle
            const center = this.map.getCenter();
            this._openCreatePingWheel({ lng: center.lng, lat: center.lat });
        };

        const drawBtn = document.getElementById('plan_btn_draw');
        if (drawBtn) drawBtn.onclick = () => this._toggleDrawDock();

        // --- Modale Ping hybride ---
        const pingClose = document.getElementById('pingModalCloseBtn');
        if (pingClose) pingClose.onclick = () => this._closePingModal();
        const freePinConfirm = document.getElementById('freePinConfirmBtn');
        if (freePinConfirm) freePinConfirm.onclick = () => this._armFreePinPlacement();

        // Sélecteur de couleur OTAN dans la modale
        const colorSelect = document.getElementById('free_pin_color_select');
        if (colorSelect) {
            colorSelect.querySelectorAll('.pax-select-option').forEach(btn => {
                btn.onclick = () => {
                    colorSelect.querySelectorAll('.pax-select-option').forEach(b => {
                        b.classList.remove('selected');
                        b.style.background = '';
                        b.style.color = '';
                    });
                    btn.classList.add('selected');
                    btn.style.background = btn.dataset.color;
                    btn.style.color = ['#eab308', '#22c55e', '#94a3b8'].includes(btn.dataset.color) ? '#000' : '#fff';
                    document.getElementById('free_pin_color').value = btn.dataset.color;
                    document.getElementById('free_pin_kind').value = btn.dataset.kind;
                };
            });
            // Sélection par défaut : Inter (bleu)
            const def = colorSelect.querySelector('[data-kind="Inter"]');
            if (def) def.click();
        }
    },

    /** Passe le conteneur de carte en plein écran (ou en sort) */
    _toggleFullscreen() {
        const container = document.getElementById('plan_map').parentElement;
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
        // Sortie de plein écran avec un modal déplacé → on le restaure à sa place.
        if (!active) this._restoreModalFromFullscreen();
        const btn = document.getElementById('plan_btn_fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = active ? 'fullscreen_exit' : 'fullscreen';
        }
        // La taille du conteneur a changé → MapLibre doit recalculer
        if (this.map) setTimeout(() => this.map.resize(), 60);
    },

    /** Ouvre/ferme le bandeau de recherche */
    _toggleSearchPanel(force) {
        const panel = document.getElementById('plan_search_panel');
        const fab = document.getElementById('plan_btn_search');
        if (!panel) return;
        const shouldOpen = force === undefined ? !panel.classList.contains('open') : force;
        panel.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            const input = document.getElementById('plan_address_input');
            if (input) input.focus();
        }
    },

    /** Détecte une saisie de coordonnées GPS décimales "lat, lng" (sép. , ; ou espace).
     *  Retourne {lat, lng} ou null. */
    _parseGps(str) {
        const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
        if (!m) return null;
        // Gère la virgule décimale française : on remplace seulement si pas de séparateur ambigu
        const lat = parseFloat(m[1].replace(',', '.'));
        const lng = parseFloat(m[2].replace(',', '.'));
        if (isNaN(lat) || isNaN(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng };
    },

    async _searchAddress() {
        const input = document.getElementById('plan_address_input');
        const resultsBox = document.getElementById('plan_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        // 1) Coordonnées GPS directes → on centre immédiatement
        const gps = this._parseGps(q);
        if (gps) {
            this.map.flyTo({ center: [gps.lng, gps.lat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(gps.lng, gps.lat, `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`);
            resultsBox.innerHTML = `
                <div class="plan-search-result" style="padding: 8px; border-bottom: 1px solid var(--border-glass); display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 16px; color: var(--ao-green);">my_location</span>
                    Point GPS centré : ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}
                </div>`;
            return;
        }

        // 2) Sinon, géocodage d'adresse via Nominatim
        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const list = await r.json();
            if (!list.length) {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            // Centrage + pointeur sur le 1er résultat (le plus probable)
            const first = list[0];
            const flng = parseFloat(first.lon), flat = parseFloat(first.lat);
            this.map.flyTo({ center: [flng, flat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(flng, flat, first.display_name);
            resultsBox.innerHTML = list.map((item, i) => `
                <div class="plan-search-result" data-idx="${i}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-glass);">
                    ${item.display_name}
                </div>
            `).join('');
            resultsBox.querySelectorAll('.plan-search-result').forEach(div => {
                div.onclick = () => {
                    const item = list[parseInt(div.dataset.idx, 10)];
                    const lng = parseFloat(item.lon), lat = parseFloat(item.lat);
                    this.map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.4 });
                    this._placeSearchMarker(lng, lat, item.display_name);
                    resultsBox.innerHTML = '';
                };
                div.onmouseover = () => { div.style.background = 'rgba(59, 130, 246, 0.15)'; };
                div.onmouseout = () => { div.style.background = ''; };
            });
        } catch (e) {
            console.error('[PlanMap] Nominatim échec:', e);
            resultsBox.innerHTML = '<em style="color: var(--danger-red);">Erreur réseau. Vérifie ta connexion.</em>';
            // On purge le pointeur précédent pour éviter une localisation périmée
            if (this.searchMarker) { this.searchMarker.remove(); this.searchMarker = null; }
        }
    },

    /** Pose (ou déplace) un pointeur précis sur l'adresse cherchée.
     *  Pulse animé pour attirer l'œil. Le marker reste jusqu'à la prochaine
     *  recherche ; on le retire si l'utilisateur clique dessus. */
    _placeSearchMarker(lng, lat, label) {
        if (!this.map) return;
        if (this.searchMarker) {
            this.searchMarker.remove();
            this.searchMarker = null;
        }
        const el = document.createElement('div');
        el.style.cssText = `
            position: relative; width: 32px; height: 32px; cursor: pointer;
        `;
        el.innerHTML = `
            <div style="
                position: absolute; inset: 0;
                border-radius: 50%;
                background: rgba(59,130,246,0.35);
                animation: pctacPulse 1.6s ease-out infinite;
            "></div>
            <div style="
                position: absolute; left: 50%; top: 50%;
                transform: translate(-50%, -50%);
                width: 14px; height: 14px;
                background: #3b82f6;
                border: 3px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 6px rgba(0,0,0,0.6);
            "></div>
        `;
        // Injecte le keyframe une seule fois
        if (!document.getElementById('pctac-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-pulse-style';
            s.textContent = `@keyframes pctacPulse {
                0% { transform: scale(0.6); opacity: 0.9; }
                100% { transform: scale(2.2); opacity: 0; }
            }`;
            document.head.appendChild(s);
        }
        const popup = label
            ? new maplibregl.Popup({ offset: 18, closeButton: true }).setHTML(
                `<div style="font-family: var(--font-ui); font-size: 0.9em; max-width: 260px;">${label}</div>`)
            : null;
        const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
        if (popup) m.setPopup(popup);
        m.addTo(this.map);
        el.onclick = (ev) => {
            ev.stopPropagation();
            if (popup) popup.addTo(this.map);
        };
        this.searchMarker = m;
    },

    /** Ouvre/ferme le dock de dessin réductible */
    _toggleDrawDock(force) {
        const dock = document.getElementById('plan_draw_dock');
        const fab = document.getElementById('plan_btn_draw');
        if (!dock) return;
        const shouldOpen = force === undefined ? !dock.classList.contains('open') : force;
        dock.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        // Fermer le dock désactive l'outil de dessin en cours
        if (!shouldOpen && this.drawTool) this._setTool(null);
    },

    _openPingModal() {
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('pingModal').style.display = 'block';
        document.getElementById('free_pin_label').value = '';
        const veh = document.getElementById('free_pin_is_vehicle');
        if (veh) veh.checked = false;
        // Réinit icône
        this._setSelectedIcon('', 'Pin par défaut');
        this._refreshIconSuggestions('');
        const cat = document.getElementById('pin_icon_catalog');
        if (cat) cat.style.display = 'none';
        this._renderPingEntities();
        this._bindIconPickerOnce();
    },

    _closePingModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('pingModal').style.display = 'none';
    },

    /** Rend la liste des entités existantes (Adv/Otage/Ami) dans la modale Ping */
    _renderPingEntities() {
        const list = document.getElementById('ping_entities_list');
        if (!list) return;

        const pins = this._loadPins();
        const placedIds = new Set(pins.filter(p => p.entityRef).map(p => `${p.entityRef.kind}:${p.entityRef.id}`));

        const adversaries = Storage.loadCollection(ADVERSARIES_KEY);
        const hostages = Storage.loadCollection(HOSTAGES_KEY);
        const friends = Storage.loadCollection(FRIENDS_KEY);

        const block = (title, items, kind, color) => {
            if (!items.length) return '';
            return `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">${title}</div>
                    ${items.map(it => {
                        const placed = placedIds.has(`${kind}:${it.id}`);
                        const label = `${it.nom || ''} ${it.prenom || ''}`.trim() || it.unite || '(sans nom)';
                        return `
                            <div class="plan-entity-item" data-kind="${kind}" data-id="${it.id}"
                                 style="display: flex; align-items: center; gap: 6px; padding: 8px 8px; border-radius: 4px; cursor: ${placed ? 'default' : 'pointer'}; background: ${placed ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)'}; border-left: 3px solid ${color}; opacity: ${placed ? 0.6 : 1};">
                                <span style="flex: 1; font-size: 0.9em;">${label}</span>
                                <span style="font-size: 0.7em; color: var(--text-muted);">${placed ? 'placé' : 'à placer'}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        };

        const html =
            block('Adversaires', adversaries, 'adv', ENTITY_COLORS.adv) +
            block('Otages', hostages, 'host', ENTITY_COLORS.host) +
            block('Amis / Unités', friends, 'friend', ENTITY_COLORS.friend);

        list.innerHTML = html || '<div style="color: var(--text-muted); font-size: 0.85em; padding: 6px;">Aucune entité créée. Ajoute des adversaires/otages/amis dans leurs onglets respectifs, ou crée un point libre ci-dessous.</div>';

        list.querySelectorAll('.plan-entity-item').forEach(el => {
            el.onclick = () => {
                const kind = el.dataset.kind;
                const id = el.dataset.id;
                if (placedIds.has(`${kind}:${id}`)) return;
                this.pendingFreePin = null;
                this.pendingEntityPin = { kind, id };
                this._closePingModal();
                this._showHint(`Clique sur la carte pour placer "${el.querySelector('span').textContent.trim()}"`);
            };
        });
    },

    /** Met à jour l'aperçu (glyphe + label) et le champ caché pour l'icône choisie. */
    _setSelectedIcon(iconId, iconLabel) {
        const hidden = document.getElementById('free_pin_icon');
        const glyph = document.getElementById('pin_icon_current_glyph');
        const label = document.getElementById('pin_icon_current_label');
        if (hidden) hidden.value = iconId || '';
        if (glyph) glyph.textContent = iconId || 'place';
        if (label) label.textContent = iconLabel || (iconId ? iconId : 'Pin par défaut');
    },

    /** Liste les icônes les plus pertinentes pour le libellé courant. */
    _refreshIconSuggestions(labelText) {
        const wrap = document.getElementById('pin_icon_suggestions_wrap');
        const box  = document.getElementById('pin_icon_suggestions');
        if (!wrap || !box) return;
        const list = suggestPinIcons(labelText, 6);
        if (!list.length) {
            wrap.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        wrap.style.display = 'block';
        box.innerHTML = list.map(ic => `
            <button type="button" class="pin-icon-suggest"
                data-id="${ic.id}" data-label="${ic.label}"
                title="${ic.label}"
                style="display: inline-flex; align-items: center; gap: 6px;
                       padding: 6px 10px; border-radius: 6px;
                       background: rgba(59,130,246,0.12);
                       border: 1px solid rgba(59,130,246,0.4);
                       color: var(--text-main); cursor: pointer; font-size: 0.85em;">
                <span class="material-symbols-outlined" style="font-size: 20px;">${ic.id}</span>
                ${ic.label}
            </button>
        `).join('');
        box.querySelectorAll('.pin-icon-suggest').forEach(btn => {
            btn.onclick = () => this._setSelectedIcon(btn.dataset.id, btn.dataset.label);
        });
    },

    /** Construit la grille complète du catalogue (groupée par catégorie). */
    _renderIconCatalog(filterText) {
        const grid = document.getElementById('pin_icon_grid');
        if (!grid) return;
        const q = (filterText || '').toLowerCase().trim();
        const filtered = PIN_ICONS.filter(ic => {
            if (!q) return true;
            const hay = (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase();
            return hay.includes(q);
        });
        // Groupage par catégorie
        const byCat = filtered.reduce((acc, ic) => {
            (acc[ic.cat] = acc[ic.cat] || []).push(ic);
            return acc;
        }, {});
        const html = Object.entries(byCat).map(([cat, items]) => `
            <div style="margin-bottom: 10px;">
                <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">${cat}</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px;">
                    ${items.map(ic => `
                        <button type="button" class="pin-icon-cell" data-id="${ic.id}" data-label="${ic.label}"
                            title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 4px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: rgba(255,255,255,0.04);
                                   border: 1px solid var(--border-glass);
                                   color: var(--text-main); cursor: pointer; font-size: 0.7em;">
                            <span class="material-symbols-outlined" style="font-size: 24px;">${ic.id}</span>
                            <span style="text-align: center; line-height: 1.1;">${ic.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('') || '<div style="color: var(--text-muted); font-size: 0.85em;">Aucune icône.</div>';
        grid.innerHTML = html;
        grid.querySelectorAll('.pin-icon-cell').forEach(btn => {
            btn.onclick = () => {
                this._setSelectedIcon(btn.dataset.id, btn.dataset.label);
                const cat = document.getElementById('pin_icon_catalog');
                if (cat) cat.style.display = 'none';
            };
        });
    },

    /** Branche les listeners du picker (une seule fois par session). */
    _bindIconPickerOnce() {
        if (this._iconPickerBound) {
            // À chaque ouverture on rafraîchit juste le catalogue (au cas où)
            this._renderIconCatalog('');
            return;
        }
        this._iconPickerBound = true;

        const labelInput = document.getElementById('free_pin_label');
        if (labelInput) {
            labelInput.addEventListener('input', (e) => this._refreshIconSuggestions(e.target.value));
        }
        const toggle = document.getElementById('pin_icon_picker_toggle');
        const catalog = document.getElementById('pin_icon_catalog');
        if (toggle && catalog) {
            toggle.onclick = () => {
                const open = catalog.style.display !== 'none';
                catalog.style.display = open ? 'none' : 'block';
                if (!open) this._renderIconCatalog(document.getElementById('pin_icon_search')?.value || '');
            };
        }
        const search = document.getElementById('pin_icon_search');
        if (search) {
            search.addEventListener('input', (e) => this._renderIconCatalog(e.target.value));
        }
        this._renderIconCatalog('');
    },

    _armFreePinPlacement() {
        const label = document.getElementById('free_pin_label').value.trim();
        const color = document.getElementById('free_pin_color').value;
        let kind = document.getElementById('free_pin_kind').value;
        const isVehicle = document.getElementById('free_pin_is_vehicle')?.checked;
        if (isVehicle) kind = 'Vehicule';
        const icon = (document.getElementById('free_pin_icon')?.value || '').trim();
        if (!label) return alert('Libellé requis');
        this.pendingEntityPin = null;
        this.pendingFreePin = { label, color, kind, icon };
        this._closePingModal();
        this._showHint(`Clique sur la carte pour placer "${label}"`);
    },

    _onMapClick(e) {
        // Pendant le drawing, les clics sont gérés par mousedown/up
        if (this.drawTool) return;
        if (this.pendingEntityPin) {
            const { kind, id } = this.pendingEntityPin;
            this._addPin({
                id: `${kind}_${id}_${Date.now()}`,
                entityRef: { kind, id },
                lng: e.lngLat.lng,
                lat: e.lngLat.lat
            });
            this.pendingEntityPin = null;
            this._hideHint();
            return;
        }
        if (this.pendingFreePin) {
            const { label, color, kind, icon } = this.pendingFreePin;
            this._addPin({
                id: 'free_' + Date.now(),
                label, color, kind, icon,
                lng: e.lngLat.lng,
                lat: e.lngLat.lat
            });
            this.pendingFreePin = null;
            this._hideHint();
        }
    },

    _addPin(pin) {
        const pins = this._loadPins();
        pins.push(pin);
        this._savePins(pins);
        this._renderPins();
    },

    _removePin(id) {
        const pins = this._loadPins().filter(p => p.id !== id);
        this._savePins(pins);
        this._renderPins();
    },

    _loadPins() {
        try { return JSON.parse(localStorage.getItem(PINS_KEY)) || []; }
        catch (e) { return []; }
    },

    _savePins(pins) {
        localStorage.setItem(PINS_KEY, JSON.stringify(pins));
    },

    _resolvePin(pin) {
        // Calcule label + couleur effectifs (entité ou libre)
        if (pin.entityRef) {
            const { kind, id } = pin.entityRef;
            const map = { adv: ADVERSARIES_KEY, host: HOSTAGES_KEY, friend: FRIENDS_KEY };
            const item = Storage.loadCollection(map[kind]).find(i => i.id === id);
            const label = item ? (`${item.nom || ''} ${item.prenom || ''}`.trim() || item.unite || '(sans nom)') : '[supprimé]';
            return { label, color: ENTITY_COLORS[kind], kind };
        }
        return { label: pin.label, color: pin.color, kind: pin.kind || 'libre' };
    },

    _renderPins() {
        if (!this.map) return;
        // Purge des markers existants (pin + label séparés)
        for (const entry of this.markers.values()) {
            if (entry.pin) entry.pin.remove();
            if (entry.label) entry.label.remove();
        }
        this.markers.clear();

        const pins = this._loadPins();
        for (const pin of pins) {
            const { label, color, kind } = this._resolvePin(pin);
            const isVehicle = (pin.kind === 'Vehicule');
            // Icône personnalisée choisie depuis le catalogue (prioritaire sur véhicule)
            const customIcon = pin.icon && pin.icon.trim();

            // --- 1) MARKER PIN ou ICÔNE (selon type) ---
            const pinWrap = document.createElement('div');
            let pinSvg = null;
            let labelOffset; // décalage du label sous l'élément

            if (customIcon || isVehicle) {
                // Icône Material : custom > véhicule par défaut
                const glyph = customIcon || 'directions_car';
                pinWrap.style.cssText = `width: 38px; height: 38px; cursor: grab; display: flex; align-items: center; justify-content: center;`;
                pinWrap.innerHTML = `
                    <span class="material-symbols-outlined" style="
                        font-size: 36px;
                        color: ${color};
                        text-shadow:
                            0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff,
                            0 2px 4px rgba(0,0,0,0.6);
                        line-height: 1;
                        font-variation-settings: 'FILL' 1;
                    ">${glyph}</span>
                `;
                labelOffset = [0, 22]; // sous l'icône
            } else {
                // Pin classique : SVG teardrop
                pinWrap.style.cssText = `width: 26px; height: 36px; cursor: grab;`;
                pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                pinSvg.setAttribute('width', '26');
                pinSvg.setAttribute('height', '36');
                pinSvg.setAttribute('viewBox', '0 0 22 30');
                pinSvg.style.cssText = `display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));`;
                pinSvg.innerHTML = `
                    <path d="M11,0 C5,0 0,5 0,11 C0,18 11,30 11,30 C11,30 22,18 22,11 C22,5 17,0 11,0 Z"
                          fill="${color}" stroke="#fff" stroke-width="2"/>
                    <circle cx="11" cy="11" r="4" fill="#fff"/>
                `;
                pinWrap.appendChild(pinSvg);
                labelOffset = [0, 5];
            }

            // Tap sur le pin → roue d'options (au lieu de popup texte). Drag = move natif.
            const pinMarker = new maplibregl.Marker({ element: pinWrap, anchor: (customIcon || isVehicle) ? 'center' : 'bottom', draggable: !this._locked })
                .setLngLat([pin.lng, pin.lat])
                .addTo(this.map);
            // Détecte tap (simple/double) vs drag.
            //  - Drag         → déplace le ping (drag natif maplibre).
            //  - Double tap   → ouvre la roue d'options.
            //  - Simple tap   → rien (laisse le drag déplacer ; cohérent avec "un touch déplace").
            let pdStart = null;
            let originalLngLat = null;

            const onDown = (clientX, clientY, isTouch) => {
                pdStart = { x: clientX, y: clientY, t: Date.now(), isTouch };
                originalLngLat = pinMarker.getLngLat();
            };

            const onMove = () => { /* le drag natif maplibre gère le déplacement */ };

            const onUp = (clientX, clientY, ev) => {
                if (!pdStart) return;
                const dx = clientX - pdStart.x, dy = clientY - pdStart.y;
                const moved = Math.hypot(dx, dy);
                const dt = Date.now() - pdStart.t;

                // Seuil de mouvement plus généreux sur mobile touch (20px) que sur souris (6px)
                const threshold = pdStart.isTouch ? 20 : 6;
                const maxTime = pdStart.isTouch ? 350 : 500;

                const isTap = moved < threshold && dt < maxTime;
                pdStart = null;

                if (!isTap) return; // un drag : déplacement natif, rien à faire ici

                // C'est un tap : on stoppe la propagation pour ne pas déclencher le drag natif
                ev.stopPropagation();
                ev.preventDefault();

                // Si un mini-drag a eu lieu (quelques pixels), on réinitialise la position d'origine
                if (originalLngLat) {
                    pinMarker.setLngLat(originalLngLat);
                    labelMarker.setLngLat(originalLngLat);
                    const dm = this._pinDiameterLabels && this._pinDiameterLabels[pin.id];
                    if (dm) dm.setLngLat(originalLngLat);
                    updateLiveCircle(originalLngLat);
                }

                // Détection double-tap / double-clic → roue d'options
                const now = Date.now();
                const prev = this._lastPinTap;
                if (prev && prev.id === pin.id && (now - prev.t) < 350) {
                    this._lastPinTap = null;
                    this._openPingOptionsWheel(pin.id);
                } else {
                    this._lastPinTap = { id: pin.id, t: now };
                }
            };

            // Enregistrement des écouteurs en phase CAPTURE pour intercepter avant MapLibre
            pinWrap.addEventListener('pointerdown', this._safe((ev) => {
                onDown(ev.clientX, ev.clientY, ev.pointerType === 'touch');
            }, 'pin:pointerdown'), { capture: true });

            pinWrap.addEventListener('pointermove', this._safe((ev) => {
                onMove(ev.clientX, ev.clientY);
            }, 'pin:pointermove'), { capture: true });

            pinWrap.addEventListener('pointerup', this._safe((ev) => {
                onUp(ev.clientX, ev.clientY, ev);
            }, 'pin:pointerup'), { capture: true });

            pinWrap.addEventListener('pointercancel', this._safe(() => {
                pdStart = null;
            }, 'pin:pointercancel'), { capture: true });

            // --- 2) MARKER LABEL séparé, ancré au même lng/lat (label +20% : 11→13) ---
            // Si l'utilisateur a saisi un texte custom (pin.text), on l'affiche À LA PLACE
            // du label kind ("Adv"/"Otage"/…) pour éviter une duplication visuelle.
            const labelEl = document.createElement('div');
            const displayLabel = pin.text && pin.text.trim() ? pin.text : label;
            labelEl.textContent = displayLabel;
            labelEl.style.cssText = `
                padding: 3px 8px;
                background: rgba(0,0,0,0.78);
                color: #fff;
                font-family: var(--font-ui);
                font-size: 13px;
                line-height: 1.2;
                border-left: 4px solid ${color};
                border-radius: 3px;
                white-space: nowrap;
                box-shadow: 0 1px 3px rgba(0,0,0,0.6);
                pointer-events: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                letter-spacing: 0.3px;
            `;
            const labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                .setLngLat([pin.lng, pin.lat])
                .addTo(this.map);

            // --- Drag : déplace pin + label + cercle de diamètre ensemble ---
            const hasDiameter = pin.diameterM && pin.diameterM > 0;
            const updateLiveCircle = (ll) => {
                if (!hasDiameter) return;
                const src = this.map.getSource && this.map.getSource('plan-pin-circles-src');
                if (!src || !this._pinCircleFeatures) return;
                const center = [ll.lng, ll.lat];
                const radiusM = pin.diameterM / 2;
                const edge = [center[0], center[1] + radiusM / 111320];
                const coords = this._circlePolygon(center, edge);
                const idx = this._pinCircleFeatures.findIndex(f =>
                    f.properties && f.properties._pinId === pin.id
                );
                if (idx === -1) return;
                this._pinCircleFeatures[idx] = {
                    ...this._pinCircleFeatures[idx],
                    geometry: { type: 'Polygon', coordinates: [coords] }
                };
                src.setData({ type: 'FeatureCollection', features: this._pinCircleFeatures });
            };
            pinMarker.on('dragstart', this._safe(() => {
                pinWrap.style.cursor = 'grabbing';
                pinWrap.style.opacity = '0.85';
                labelEl.style.opacity = '0.5';
            }, 'pin:dragstart'));
            pinMarker.on('drag', this._safe(() => {
                // Le libellé + le cercle suivent le pin en temps réel.
                const ll = pinMarker.getLngLat();
                labelMarker.setLngLat(ll);
                updateLiveCircle(ll);
                const dm = this._pinDiameterLabels && this._pinDiameterLabels[pin.id];
                if (dm) dm.setLngLat(ll);
            }, 'pin:drag'));
            pinMarker.on('dragend', this._safe(() => {
                pinWrap.style.cursor = 'grab';
                pinWrap.style.opacity = '1';
                labelEl.style.opacity = '1';
                const ll = pinMarker.getLngLat();
                labelMarker.setLngLat(ll);
                const allPins = this._loadPins();
                const target = allPins.find(p => p.id === pin.id);
                if (target) {
                    target.lng = ll.lng;
                    target.lat = ll.lat;
                    this._savePins(allPins);
                }
                // Re-render complet pour réindexer les features du cercle proprement
                this._renderPinDecorations();
            }, 'pin:dragend'));

            this.markers.set(pin.id, { pin: pinMarker, label: labelMarker });
        }
        // Re-render des cercles de diamètre & texte des pings
        this._renderPinDecorations();
    },

    // ============================================================
    // ============  PINGS : décorations (diamètre + texte) =======
    // ============================================================
    _renderPinDecorations() {
        if (this._pinDecoMarkers) this._pinDecoMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._pinDecoMarkers = [];
        if (this._pinDiameterSrc) {
            try { this.map.getSource('plan-pin-circles-src').setData({ type: 'FeatureCollection', features: [] }); } catch (_) {}
        }
        if (!this.map) return;

        // Cercles géodésiques pour les pings avec diameterM
        // On garde une copie locale `_pinCircleFeatures` pour pouvoir mettre à jour
        // une feature individuelle live pendant le drag (par _pinId dans properties).
        // `pin.showDiameter === false` permet de masquer le cercle sans perdre la valeur.
        const circleFeatures = [];
        for (const pin of this._loadPins()) {
            if (pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false) {
                const center = [pin.lng, pin.lat];
                const radiusM = pin.diameterM / 2;
                const deltaLat = radiusM / 111320;
                const edge = [center[0], center[1] + deltaLat];
                const coords = this._circlePolygon(center, edge);
                circleFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [coords] },
                    properties: { color: pin.color || '#3b82f6', _pinId: pin.id }
                });
            }
        }
        this._pinCircleFeatures = circleFeatures;
        // Labels textuels du diamètre pour chaque ping concerné
        this._pinDiameterLabels = {};
        if (this._diameterGlobal) {
            for (const pin of this._loadPins()) {
                if (!(pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false)) continue;
                const div = document.createElement('div');
                div.className = 'plan-diameter-label';
                div.textContent = `⌀ ${this._formatDistance(pin.diameterM)}`;
                div.style.cssText = `
                    background: rgba(20,24,32,0.85);
                    color: #fff;
                    padding: 3px 9px;
                    border-radius: 10px;
                    border: 1px solid ${pin.color || '#3b82f6'};
                    font-family: var(--font-data, ui-monospace, monospace);
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    pointer-events: none;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                `;
                const m = new maplibregl.Marker({ element: div, anchor: 'top', offset: [0, 56] })
                    .setLngLat([pin.lng, pin.lat]).addTo(this.map);
                this._pinDecoMarkers.push(m);
                this._pinDiameterLabels[pin.id] = m;
            }
        }
        // Source/layer pour les cercles de ping
        if (!this._pinDiameterSrc && this.map.getSource && circleFeatures.length) {
            try {
                this.map.addSource('plan-pin-circles-src', {
                    type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures }
                });
                this.map.addLayer({
                    id: 'plan-pin-circles-fill',
                    type: 'fill',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'fill-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'fill-opacity': 0.10
                    }
                });
                this.map.addLayer({
                    id: 'plan-pin-circles-line',
                    type: 'line',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'line-width': 2,
                        'line-dasharray': [3, 3],
                        'line-opacity': 0.8
                    }
                });
                this._pinDiameterSrc = true;
            } catch (e) {
                console.error('[PlanMap] couche cercles ping échec:', e);
            }
        } else if (this._pinDiameterSrc) {
            try { this.map.getSource('plan-pin-circles-src').setData({ type: 'FeatureCollection', features: circleFeatures }); } catch (_) {}
        }
    },

    // ============================================================
    // ===================  DESSINS (shapes)  =====================
    // ============================================================

    _initDrawingLayers() {
        // --- Bâtiments 3D (extrusion OpenStreetMap via OpenFreeMap) ---
        // Masqués par défaut, activés avec le mode 3D. Ajoutés en premier
        // pour rester sous les dessins/annotations.
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
                    // hauteur réelle si connue, sinon fallback 6 m
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                    'fill-extrusion-opacity': 0.85
                }
            });
        } catch (e) {
            console.error('[PlanMap] couche bâtiments 3D échec:', e);
        }

        // Source "committed" (dessins persistés)
        this.map.addSource('plan-shapes-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        this.map.addLayer({
            id: 'plan-shapes-fill',
            type: 'fill',
            source: 'plan-shapes-src',
            // Polygones (rect/circle) mais pas les "hit zones" des annotations texte
            filter: ['all',
                ['==', ['geometry-type'], 'Polygon'],
                ['!=', ['get', 'isText'], true]
            ],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.18
            }
        });
        this.map.addLayer({
            id: 'plan-shapes-line-hit',
            type: 'line',
            source: 'plan-shapes-src',
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': '#000',
                'line-width': 28,
                'line-opacity': 0
            }
        });
        this.map.addLayer({
            id: 'plan-shapes-line',
            type: 'line',
            source: 'plan-shapes-src',
            // Lignes uniquement (pas les zones hit-test des textes)
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                // Épaisseur pilotée par la donnée (réglable via la roue : Épaisseur -/+)
                'line-width': ['coalesce', ['get', 'strokeWidth'], 3],
                'line-opacity': 0.9
            }
        });
        // Hit-test invisible pour les annotations texte libres
        this.map.addLayer({
            id: 'plan-shapes-text-hit',
            type: 'fill',
            source: 'plan-shapes-src',
            filter: ['==', ['get', 'isText'], true],
            paint: { 'fill-color': '#000', 'fill-opacity': 0 }
        });

        // Source "preview" (dessin en cours)
        this.map.addSource('plan-draw-preview-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        this.map.addLayer({
            id: 'plan-draw-preview-fill',
            type: 'fill',
            source: 'plan-draw-preview-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.12
            }
        });
        this.map.addLayer({
            id: 'plan-draw-preview-line',
            type: 'line',
            source: 'plan-draw-preview-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.9
            }
        });

        // Gestes sur formes : pointerdown unifié → décide tap (menu) vs drag (déplacement)
        //  - Tap court & immobile → menu contextuel (Déplacer/Redim/Texte/Suppr)
        //  - Drag (mouvement > 6px) → déplacement direct, mobile + PC
        //  - Sans hit sur une forme → la carte panote normalement (maplibre natif)
        const layers = ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'];
        layers.forEach(layerId => {
            this.map.on('mousedown',  layerId, this._safe((e) => this._shapePointerDown(e), 'shapeDown'));
            this.map.on('touchstart', layerId, this._safe((e) => this._shapePointerDown(e), 'shapeDown'));
            // Curseur indicatif au survol
            this.map.on('mouseenter', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) this.map.getCanvas().style.cursor = 'grab';
            });
            this.map.on('mouseleave', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) this.map.getCanvas().style.cursor = '';
            });
        });

        // Re-render des textes quand le zoom/move change (les bornes pixel évoluent)
        let textsTick = null;
        const scheduleTexts = () => {
            if (textsTick) return;
            textsTick = requestAnimationFrame(() => {
                textsTick = null;
                this._renderShapeTexts();
                this._renderDiameters();
            });
        };
        this.map.on('zoom', scheduleTexts);
        this.map.on('move', scheduleTexts);

        // Tap court sur zone vide → désélectionne uniquement.
        // Pour créer un ping : long-press (500 ms) ou FAB add_location.
        this.map.on('click', (e) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._wheelJustClosed && Date.now() - this._wheelJustClosed < 250) return;
            const hits = this.map.queryRenderedFeatures(e.point, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit']
            });
            if (hits.length) return;
            if (this._selectedShapeId) this._deselectShape();
        });

        // Long-press sur zone vide → ouvre la roue de création de ping (Google Maps style).
        this._wireLongPressForPing();
        // Échap → désélectionne
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._selectedShapeId && !this.moveState && !this._gesture) {
                this._deselectShape();
            }
        });
    },

    _bindDrawUi() {
        document.querySelectorAll('.plan-draw-btn').forEach(btn => {
            btn.onclick = () => this._setTool(btn.dataset.tool);
        });
        document.querySelectorAll('.plan-draw-color').forEach(btn => {
            btn.onclick = () => this._setDrawColor(btn.dataset.color);
        });
        const clearBtn = document.getElementById('plan_draw_clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!confirm('Effacer tous les dessins ?')) return;
            this._pushHistory();
            this._saveShapes([]);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        };

        const undoBtn = document.getElementById('plan_draw_undo');
        if (undoBtn) undoBtn.onclick = () => this._undo();
        const redoBtn = document.getElementById('plan_draw_redo');
        if (redoBtn) redoBtn.onclick = () => this._redo();
        this._refreshUndoRedoButtons();

        const diamBtn = document.getElementById('plan_draw_diameter_toggle');
        if (diamBtn) diamBtn.onclick = () => this._toggleGlobalDiameter();

        const lockBtn = document.getElementById('plan_draw_lock');
        if (lockBtn) lockBtn.onclick = () => this._toggleLock();
        this._updateLockButton();

        // Raccordement des boutons de précision tactique (mobile)
        const pStart = document.getElementById('plan_draw_precision_start');
        const pConfirm = document.getElementById('plan_draw_precision_confirm');
        const pCancel = document.getElementById('plan_draw_precision_cancel');

        if (pStart) {
            pStart.onclick = () => {
                if (!this.drawTool) return;
                const center = this.map.getCenter();
                const lngLat = [center.lng, center.lat];

                if (this.drawTool === 'text') {
                    this._addFreeText(center);
                    this._setTool(null);
                    return;
                }

                this.drawState = { start: lngLat, current: lngLat };

                // Afficher Valider / Annuler
                pStart.style.display = 'none';
                if (pConfirm) pConfirm.style.display = 'flex';
                if (pCancel) pCancel.style.display = 'flex';

                // Générer un premier aperçu
                this._handleDrawMove({ lngLat: center });
            };
        }

        if (pConfirm) {
            pConfirm.onclick = () => {
                if (!this.drawTool || !this.drawState) return;
                const center = this.map.getCenter();
                this._handleDrawUp({ lngLat: center });

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                pConfirm.style.display = 'none';
                if (pCancel) pCancel.style.display = 'none';
            };
        }

        if (pCancel) {
            pCancel.onclick = () => {
                this.drawState = null;
                this._clearPreview();
                this._clearLiveDiameter();

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                if (pConfirm) pConfirm.style.display = 'none';
                pCancel.style.display = 'none';
            };
        }

        // Mettre à jour l'aperçu à chaque mouvement de la carte en mode précision
        if (this.map) {
            this.map.on('move', () => {
                if (this.drawPrecisionMode && this.drawState) {
                    const center = this.map.getCenter();
                    this._handleDrawMove({ lngLat: center });
                }
            });
        }

        // Échap = quitte l'outil ; Ctrl+Z / Ctrl+Y raccourcis (uniquement sur la vue Plan)
        document.addEventListener('keydown', (e) => {
            const planView = document.getElementById('view-plan');
            if (!planView || !planView.classList.contains('active')) return;
            if (e.key === 'Escape' && this.drawTool) this._setTool(null);
            else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }
        });
    },

    _pushHistory() {
        // Snapshot avant modification — appelé par toute opération qui change les shapes
        this.history.push(JSON.stringify(this._loadShapes()));
        if (this.history.length > 50) this.history.shift();
        this.redoStack = []; // toute nouvelle action invalide le redo
    },

    _undo() {
        if (!this.history.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.redoStack.push(current);
        const prev = this.history.pop();
        try { localStorage.setItem(SHAPES_KEY, prev); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _redo() {
        if (!this.redoStack.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.history.push(current);
        const next = this.redoStack.pop();
        try { localStorage.setItem(SHAPES_KEY, next); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _refreshUndoRedoButtons() {
        const undoBtn = document.getElementById('plan_draw_undo');
        const redoBtn = document.getElementById('plan_draw_redo');
        if (undoBtn) {
            undoBtn.style.opacity = this.history.length ? '1' : '0.35';
            undoBtn.style.cursor = this.history.length ? 'pointer' : 'not-allowed';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length ? '1' : '0.35';
            redoBtn.style.cursor = this.redoStack.length ? 'pointer' : 'not-allowed';
        }
    },

    _setTool(tool) {
        // Toggle : re-cliquer sur l'outil actif le désactive
        if (tool && this.drawTool === tool) tool = null;
        this.drawTool = tool;
        this.drawState = null;
        this._clearPreview();
        this._clearLiveDiameter();

        // Détecter si on est sur mobile/tactile pour le mode précision.
        // Exception : l'outil TRAIT se trace au doigt (cheminement libre), sans
        // réticule ni boutons Valider/Annuler → mode précision désactivé pour lui.
        const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        this.drawPrecisionMode = !!(tool && isMobile && tool !== 'line');

        // Style des boutons
        document.querySelectorAll('.plan-draw-btn').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff') : 'var(--text-main)';
        });

        // Contrôles du réticule et des boutons de précision mobile
        const crosshair = document.getElementById('plan_draw_crosshair');
        const precControls = document.getElementById('plan_draw_precision_controls');
        const viewPlan = document.getElementById('view-plan');

        if (crosshair) {
            crosshair.classList.toggle('active', !!this.drawPrecisionMode);
        }
        if (precControls) {
            precControls.style.display = this.drawPrecisionMode ? 'flex' : 'none';
            // Réinitialiser l'état visuel des boutons de visée
            const pStart = document.getElementById('plan_draw_precision_start');
            const pConfirm = document.getElementById('plan_draw_precision_confirm');
            const pCancel = document.getElementById('plan_draw_precision_cancel');
            if (pStart) pStart.style.display = 'flex';
            if (pConfirm) pConfirm.style.display = 'none';
            if (pCancel) pCancel.style.display = 'none';
        }
        if (viewPlan) {
            viewPlan.classList.toggle('drawing-active', !!this.drawPrecisionMode);
        }

        // Curseur + désactive le pan de la carte tant qu'un outil est actif (sauf en mode précision mobile)
        if (this.map) {
            this.map.getCanvas().style.cursor = tool ? 'crosshair' : '';
            if (tool && !this.drawPrecisionMode) {
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
        document.querySelectorAll('.plan-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        // Re-style du bouton actif si un outil est sélectionné
        if (this.drawTool) this._setTool(this.drawTool);
    },

    /** Drag-to-draw : démarrage */
    _handleDrawDown(e) {
        if (!this.drawTool || this.drawPrecisionMode) return;
        // Outil texte : un seul clic suffit (pas de drag)
        if (this.drawTool === 'text') {
            if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
            this._addFreeText(e.lngLat);
            // Désactive l'outil après usage pour éviter les ajouts involontaires
            this._setTool(null);
            return;
        }
        // Bloquer le pan/zoom natif
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        if (e.preventDefault) e.preventDefault();
        const lngLat = [e.lngLat.lng, e.lngLat.lat];
        // `points` sert au tracé libre (cheminement) de l'outil trait.
        this.drawState = { start: lngLat, current: lngLat, points: [lngLat] };
    },

    /** Drag-to-draw : déplacement (live preview) */
    _handleDrawMove(e) {
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les glissements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        const cursor = [e.lngLat.lng, e.lngLat.lat];
        this.drawState.current = cursor;
        if (this.drawTool === 'line') {
            // Tracé libre : on accumule les points le long du glissement (cheminement).
            const pts = this.drawState.points || (this.drawState.points = [this.drawState.start]);
            const last = pts[pts.length - 1];
            const lp = this.map.project({ lng: last[0], lat: last[1] });
            const cp = this.map.project({ lng: cursor[0], lat: cursor[1] });
            if (Math.hypot(cp.x - lp.x, cp.y - lp.y) >= 4) pts.push(cursor);
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: pts.length > 1 ? pts : [this.drawState.start, cursor] },
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
            // Label de diamètre live (si toggle global ON)
            if (this._diameterGlobal) {
                this._renderLiveDiameter(this.drawState.start, cursor);
            }
        }
    },

    /** Affiche le diamètre live pendant le tracé d'un cercle. */
    _renderLiveDiameter(center, edge) {
        const d = this._haversineMeters(center, edge) * 2;
        const label = `⌀ ${this._formatDistance(d)}`;
        if (!this._drawingDiameterMarker) {
            const div = document.createElement('div');
            div.className = 'plan-diameter-label live';
            div.style.cssText = `
                background: rgba(20,24,32,0.92);
                color: #fff;
                padding: 3px 10px;
                border-radius: 12px;
                border: 1px solid ${this.drawColor || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 13px;
                font-weight: 700;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            `;
            this._drawingDiameterMarker = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, 16]
            }).setLngLat(center).addTo(this.map);
        }
        const el = this._drawingDiameterMarker.getElement();
        if (el) el.textContent = label;
        this._drawingDiameterMarker.setLngLat(center);
    },

    _clearLiveDiameter() {
        if (this._drawingDiameterMarker) {
            try { this._drawingDiameterMarker.remove(); } catch (_) {}
            this._drawingDiameterMarker = null;
        }
    },

    /** Drag-to-draw : relâchement → commit (si le drag a été significatif) */
    _handleDrawUp(e) {
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les relâchements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        const end = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : this.drawState.current;
        const start = this.drawState.start;
        // Distance pixel pour filtrer les "clics" non-drag
        const p1 = this.map.project({ lng: start[0], lat: start[1] });
        const p2 = this.map.project({ lng: end[0], lat: end[1] });
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        // Un trait libre (cheminement) peut revenir près de son départ : on le
        // commit dès qu'il compte plusieurs points, même si start≈end en pixels.
        const freehandLine = this.drawTool === 'line' && this.drawState.points && this.drawState.points.length > 2;
        if (!this.drawPrecisionMode && distPx < 4 && !freehandLine) {
            // Clic trop court, on annule la preview
            this.drawState = null;
            this._clearPreview();
            this._clearLiveDiameter();
            return;
        }

        if (this.drawTool === 'line') {
            const pts = (this.drawState.points && this.drawState.points.length > 1)
                ? this.drawState.points.slice()
                : [start, end];
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'line',
                color: this.drawColor,
                coords: pts
            });
        } else if (this.drawTool === 'rectangle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'rectangle',
                color: this.drawColor,
                coords: this._rectPolygon(start, end)
            });
        } else if (this.drawTool === 'circle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'circle',
                color: this.drawColor,
                center: start,
                edge: end,
                coords: this._circlePolygon(start, end)
            });
        }
    },

    _finishShape(shape) {
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this.drawState = null;
        this._clearPreview();
        // Désactive l'outil de dessin et repasse en mode contrôle carte
        // (le dock reste ouvert pour permettre un nouveau tracé immédiat).
        this._setTool(null);
        // Sélectionne la forme fraîchement créée → handles + toolbar immédiats
        this._selectShape(shape.id);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _renderPreview(feature) {
        const src = this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    _clearPreview() {
        const src = this.map && this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        this._clearLiveDiameter();
    },

    _renderShapes() {
        const src = this.map && this.map.getSource('plan-shapes-src');
        if (!src) return;
        const list = this._loadShapes();
        const features = [];
        for (const s of list) {
            if (s.type === 'line') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'rectangle' || s.type === 'circle') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [s.coords] }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'text') {
                // Petite zone "hit" invisible autour du point pour rendre le clic possible.
                // Carré de ~14 px à l'écran, projeté en degrés.
                const c = s.coords[0];
                if (this.map && c) {
                    const p = this.map.project({ lng: c[0], lat: c[1] });
                    const pad = 14;
                    const sw = this.map.unproject([p.x - pad, p.y + pad]);
                    const ne = this.map.unproject([p.x + pad, p.y - pad]);
                    features.push({
                        type: 'Feature', id: s.id,
                        geometry: { type: 'Polygon', coordinates: [[
                            [sw.lng, sw.lat], [ne.lng, sw.lat],
                            [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]
                        ]]},
                        properties: { color: s.color, shapeId: s.id, isText: true }
                    });
                }
            }
        }
        src.setData({ type: 'FeatureCollection', features });
        // Toujours synchroniser texte / diamètres / handles / toolbar avec les formes
        this._renderShapeTexts();
        this._renderDiameters();
        this._renderHandles();
        this._updateFloatingToolbarPos();
    },

    // ============================================================
    // ====================  DIAMÈTRES CERCLE  ===================
    // ============================================================
    /** Distance Haversine en mètres entre deux [lng,lat]. */
    _haversineMeters(a, b) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dPhi = toRad(b[1] - a[1]);
        const dLam = toRad(b[0] - a[0]);
        const phi1 = toRad(a[1]); const phi2 = toRad(b[1]);
        const h = Math.sin(dPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dLam/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    },

    _formatDistance(m) {
        if (!isFinite(m) || m <= 0) return '';
        if (m < 1) return `${(m * 100).toFixed(0)} cm`;
        if (m < 1000) return `${Math.round(m)} m`;
        if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
        return `${(m / 1000).toFixed(1)} km`;
    },

    _circleDiameter(s) {
        const c = s.center || s.coords[0];
        const e = s.edge   || (s.coords && s.coords[Math.floor(s.coords.length / 4)]);
        if (!c || !e) return 0;
        return this._haversineMeters(c, e) * 2;
    },

    _renderDiameters() {
        if (this._diameterMarkers) this._diameterMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._diameterMarkers = [];
        if (!this.map) return;
        if (!this._diameterGlobal) return;
        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'circle') continue;
            if (s.showDiameter === false) continue;
            const d = this._circleDiameter(s);
            if (!d) continue;
            const c = s.center || s.coords[0];
            const label = `⌀ ${this._formatDistance(d)}`;
            const div = document.createElement('div');
            div.className = 'plan-diameter-label';
            div.textContent = label;
            div.style.cssText = `
                background: rgba(20,24,32,0.85);
                color: #fff;
                padding: 3px 9px;
                border-radius: 10px;
                border: 1px solid ${s.color || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            `;

            // Position : strictement SOUS le texte de la forme (s'il y en a), sinon centré.
            // On mesure dynamiquement la hauteur du marker texte associé pour éviter
            // tout chevauchement quelle que soit la taille du texte ou du diamètre.
            let offsetY = 14;
            const txtMarker = this._textMarkersById && this._textMarkersById[s.id];
            if (txtMarker) {
                const txtEl = txtMarker.getElement();
                if (txtEl) {
                    // hauteur réelle du bloc texte (avec wrap éventuel + padding)
                    const txtH = txtEl.offsetHeight || txtEl.getBoundingClientRect().height || 18;
                    // Le texte est centré sur le centre du cercle ; sa moitié de hauteur
                    // est sous l'ancrage. On positionne le diamètre encore en-dessous
                    // avec un padding visuel de 6 px.
                    offsetY = Math.round(txtH / 2 + 6 + 9); // + demi-hauteur diamètre (~9)
                }
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, offsetY] })
                .setLngLat([c[0], c[1]]).addTo(this.map);
            this._diameterMarkers.push(m);
        }
    },

    /** Verrouille / déverrouille la position des pings ET des dessins. */
    _toggleLock() {
        this._locked = !this._locked;
        try { localStorage.setItem('pcTacPlanLocked', this._locked ? '1' : '0'); } catch (_) {}
        this._updateLockButton();
        // En verrouillant, on retire les poignées de la forme sélectionnée.
        if (this._locked) this._clearHandles();
        else this._renderHandles();
        // Recrée les pings pour appliquer le nouveau draggable.
        this._renderPins();
        this._showHint(this._locked
            ? 'Positions verrouillées : pings et dessins figés'
            : 'Positions déverrouillées : déplacement réactivé');
        setTimeout(() => this._hideHint(), 1600);
    },

    _updateLockButton() {
        const btn = document.getElementById('plan_draw_lock');
        if (!btn) return;
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = this._locked ? 'lock' : 'lock_open';
        btn.style.color = this._locked ? '#eab308' : 'var(--text-main)';
        btn.title = this._locked
            ? 'Positions verrouillées (cliquer pour déverrouiller)'
            : 'Verrouiller la position des pings/dessins';
        btn.classList.toggle('active', this._locked);
    },

    /** Toggle global ON/OFF (depuis la toolbar dessin). */
    _toggleGlobalDiameter() {
        this._diameterGlobal = !this._diameterGlobal;
        const btn = document.getElementById('plan_draw_diameter_toggle');
        if (btn) {
            btn.style.color = this._diameterGlobal ? '#22c55e' : 'var(--text-muted)';
            btn.title = this._diameterGlobal ? 'Diamètres affichés (cliquer pour masquer)' : 'Diamètres masqués (cliquer pour afficher)';
        }
        this._renderDiameters();
        if (this._activeWheel && this._selectedShapeId) {
            this._openShapeWheel(this._selectedShapeId, this._activeWheel.lngLat);
        }
    },

    // ============================================================
    // ===========  GESTES UNIFIÉS (drag / tap / pan)  ============
    // ============================================================
    //
    // Trois interactions possibles sur la carte :
    //   1. tap court & immobile sur une forme        → menu contextuel
    //   2. drag (>6 px) commençant sur une forme    → déplacement de la forme
    //   3. drag depuis une zone vide                → pan de la carte (natif)
    //
    // Implémentation : pointerdown sur les couches `plan-shapes-*` désactive
    // le pan tant que le geste est en cours, écoute mousemove/touchmove pour
    // déterminer s'il s'agit d'un drag, et au pointerup soit applique le drag
    // (déjà rendu live), soit ouvre le menu contextuel.

    _shapePointerDown(e) {
        if (this.drawTool) return;          // outil de dessin actif : on ignore
        if (this.moveState) return;         // déjà une transformation en cours
        if (this._gesture) return;          // déjà un geste en cours
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        // Empêche maplibre de démarrer le pan natif sur cette pression
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
        this._startShapeGesture(id, e.lngLat, e.originalEvent);
    },

    /**
     * Machine d'états du geste sur une forme.
     * @param {string} shapeId
     * @param {{lng:number,lat:number}} startLngLat
     * @param {Event|null} originalEvent
     */
    _startShapeGesture(shapeId, startLngLat, originalEvent) {
        if (originalEvent && originalEvent.preventDefault) originalEvent.preventDefault();

        const DRAG_PX = 6;
        const startTime = Date.now();
        const startPt  = this.map.project(startLngLat);

        // Désactive le pan le temps du geste (réactivé au pointerup)
        try { this.map.dragPan.disable(); } catch (e) {}
        this.map.getCanvas().style.cursor = 'grabbing';

        const state = { shapeId, startLngLat, isDrag: false, original: null };
        this._gesture = state;

        // Convertit un événement DOM (clientX/Y) en lngLat carte
        const clientToLngLat = (clientX, clientY) => {
            const rect = this.map.getCanvas().getBoundingClientRect();
            return this.map.unproject([clientX - rect.left, clientY - rect.top]);
        };

        // Récupère lngLat depuis un événement maplibre OU DOM
        const extractLngLat = (ev) => {
            if (ev && ev.lngLat) return ev.lngLat;
            if (ev && ev.touches && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if (ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };

        const onMove = this._safe((ev) => {
            if (this._gesture !== state) return;
            const cur = extractLngLat(ev);
            if (!cur) return;
            // Détection drag : seuil franchi ? (jamais en mode verrouillé → position figée)
            if (!state.isDrag && !this._locked) {
                const p = this.map.project(cur);
                if (Math.hypot(p.x - startPt.x, p.y - startPt.y) > DRAG_PX) {
                    // Bascule en mode drag : snapshot + history
                    const list = this._loadShapes();
                    const shape = list.find(s => s.id === shapeId);
                    if (!shape) return;
                    state.original = JSON.parse(JSON.stringify(shape));
                    this._pushHistory();
                    state.isDrag = true;
                }
            }
            // Drag actif : translation = curseur - point de départ
            if (state.isDrag && state.original) {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                const list = this._loadShapes();
                const target = list.find(s => s.id === shapeId);
                if (!target) return;
                target.coords = state.original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (state.original.center) target.center = [state.original.center[0] + dLng, state.original.center[1] + dLat];
                if (state.original.edge)   target.edge   = [state.original.edge[0]   + dLng, state.original.edge[1]   + dLat];
                this._saveShapes(list);
                this._renderShapes();
            }
        }, 'shapeGesture:move');

        const onUp = this._safe((ev) => {
            if (this._gesture !== state) return;
            // Cleanup listeners
            try { this.map.off('mousemove', onMove); } catch (e) {}
            try { this.map.off('touchmove', onMove); } catch (e) {}
            try { this.map.off('mouseup', onUp); } catch (e) {}
            try { this.map.off('touchend', onUp); } catch (e) {}
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
            try { this.map.dragPan.enable(); } catch (e) {}
            this.map.getCanvas().style.cursor = '';
            this._gesture = null;

            if (state.isDrag) {
                this._refreshUndoRedoButtons();
                // Garde la forme sélectionnée pour l'édition immédiate après drag
                this._selectShape(shapeId);
            } else {
                // Pas de drag → un tap. Simple tap = sélection (poignées, déplaçable).
                // Double tap / double-clic = ouverture de la roue d'options.
                // On neutralise le zoom double-clic natif de MapLibre le temps de la fenêtre.
                this._suppressDblZoom();
                const now = Date.now();
                const prev = this._lastShapeTap;
                if (prev && prev.id === shapeId && (now - prev.t) < 350) {
                    this._lastShapeTap = null;
                    this._openShapeContextMenu(shapeId, startLngLat);
                } else {
                    this._lastShapeTap = { id: shapeId, t: now };
                    this._selectShape(shapeId);
                }
            }
        }, 'shapeGesture:up');

        // Listeners sur maplibre (couvre les events sur le canvas)
        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        this.map.on('mouseup',   onUp);
        this.map.on('touchend',  onUp);
        // ET sur le document (couvre les events qui sortent du canvas, p.ex. drag rapide)
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup',   onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    },

    /** Neutralise temporairement le zoom double-clic natif (fenêtre double-tap). */
    _suppressDblZoom() {
        if (!this.map || !this.map.doubleClickZoom) return;
        try { this.map.doubleClickZoom.disable(); } catch (_) {}
        if (this._dblZoomTimer) clearTimeout(this._dblZoomTimer);
        this._dblZoomTimer = setTimeout(() => {
            this._dblZoomTimer = null;
            // Ne pas réactiver si un outil de dessin l'a volontairement désactivé.
            if (!this.drawTool || this.drawPrecisionMode) {
                try { this.map.doubleClickZoom.enable(); } catch (_) {}
            }
        }, 450);
    },

    /**
     * Sélectionne une forme + ouvre la roue contextuelle (style Canva).
     */
    _openShapeContextMenu(shapeId, lngLat) {
        if (this.drawTool || this.moveState) return;
        this._selectShape(shapeId);
        // Ouvre la roue à proximité du tap (ou au centroïde si non fourni)
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;
        const anchor = lngLat || this._shapeAnchor(s);
        if (anchor) this._openShapeWheel(shapeId, anchor);
    },

    _selectShape(shapeId) {
        if (this._selectedShapeId === shapeId) {
            this._renderHandles();
            return;
        }
        this._selectedShapeId = shapeId;
        this._renderHandles();
        this._attachPinchListeners();
        // La barre flottante est remplacée par la roue éphémère (_openShapeWheel).
    },

    _deselectShape() {
        if (!this._selectedShapeId) return;
        this._selectedShapeId = null;
        this._clearHandles();
        this._clearFloatingToolbar();
        this._detachPinchListeners();
        this._closeWheel();
    },

    /**
     * Quand une forme est sélectionnée, 2 doigts sur la carte = pinch-resize
     * (style Canva). On désactive le pinch-zoom natif maplibre pendant le geste.
     * Hors sélection, le pinch-zoom maplibre fonctionne normalement.
     */
    _attachPinchListeners() {
        if (this._pinchListener) return;
        const onTouchStart = this._safe((e) => {
            if (!this._selectedShapeId || this.drawTool || this.moveState || this._gesture) return;
            if (this._locked) return; // verrouillé : pas de redimensionnement au pinch
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length === 2) {
                oe.preventDefault();
                this._startPinchGesture();
            }
        }, 'pinch:touchstart');
        this.map.on('touchstart', onTouchStart);
        this._pinchListener = onTouchStart;
    },

    _detachPinchListeners() {
        if (!this._pinchListener) return;
        try { this.map.off('touchstart', this._pinchListener); } catch (_) {}
        this._pinchListener = null;
    },

    _shapeCentroid(s) {
        if (s.type === 'line') {
            const a = s.coords[0], b = s.coords[s.coords.length - 1];
            return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        }
        if (s.type === 'rectangle') {
            const lngs = s.coords.map(c => c[0]);
            const lats = s.coords.map(c => c[1]);
            return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
        }
        if (s.type === 'circle') return (s.center || s.coords[0]).slice();
        if (s.type === 'text')   return s.coords[0].slice();
        return [0, 0];
    },

    _startPinchGesture() {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === this._selectedShapeId);
        if (!shape) return;
        try { this.map.touchZoomRotate.disable(); } catch (_) {}
        try { this.map.dragPan.disable(); } catch (_) {}
        this._gesture = { type: 'pinch' };
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        const center = this._shapeCentroid(shape);
        let initDist = null;

        const getDist = (touches) =>
            Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

        const onMove = this._safe((e) => {
            const oe = e.originalEvent || e;
            if (!oe.touches || oe.touches.length < 2) return;
            oe.preventDefault();
            const dist = getDist(oe.touches);
            if (initDist === null) { initDist = dist; return; }
            if (initDist < 1) return;
            const scale = Math.max(0.1, Math.min(20, dist / initDist));
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shape.id);
            if (!t) return;
            const scalePt = ([x, y]) => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale];
            if (t.type === 'circle') {
                t.center = original.center ? original.center.slice() : center.slice();
                t.edge = scalePt(original.edge || original.coords[0]);
                t.coords = this._circlePolygon(t.center, t.edge);
            } else {
                t.coords = original.coords.map(scalePt);
                if (original.center) t.center = scalePt(original.center);
                if (original.edge)   t.edge   = scalePt(original.edge);
            }
            if (t.type === 'text') {
                t.fontSize = Math.max(9, Math.min(72, Math.round((original.fontSize || 13) * scale)));
            }
            this._saveShapes(list2);
            this._renderShapes();
        }, 'pinch:move');

        const onEnd = this._safe((e) => {
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length >= 2) return;
            try { this.map.off('touchmove', onMove); } catch (_) {}
            try { this.map.off('touchend', onEnd); } catch (_) {}
            try { this.map.off('touchcancel', onEnd); } catch (_) {}
            try { this.map.touchZoomRotate.enable(); } catch (_) {}
            try { this.map.dragPan.enable(); } catch (_) {}
            this._gesture = null;
            this._refreshUndoRedoButtons();
        }, 'pinch:end');

        this.map.on('touchmove', onMove);
        this.map.on('touchend', onEnd);
        this.map.on('touchcancel', onEnd);
    },

    _clearHandles() {
        if (this._handleMarkers) this._handleMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._handleMarkers = [];
    },

    _clearFloatingToolbar() {
        if (this._toolbarMarker) { try { this._toolbarMarker.remove(); } catch (_) {} this._toolbarMarker = null; }
    },

    // legacy : conservé au cas où d'autres callsites l'appelleraient
    _onShapeClick(e) {
        const feat = e.features && e.features[0];
        const id = feat && feat.properties && feat.properties.shapeId;
        if (id) this._selectShape(id);
    },

    /**
     * Calcule, pour chaque type de forme, la liste des poignées à rendre.
     * Chaque poignée : { role: 'move'|'corner'|'edge'|'endpoint'|'textresize',
     *                    index, lngLat: {lng, lat}, cursor }
     */
    _shapeHandles(s) {
        const handles = [];
        if (s.type === 'line') {
            // Trait simple OU cheminement libre multi-points : poignées au 1er et au DERNIER point.
            const last = s.coords.length - 1;
            handles.push({ role: 'endpoint', index: 0, lngLat: { lng: s.coords[0][0], lat: s.coords[0][1] }, cursor: 'grab' });
            handles.push({ role: 'endpoint', index: last, lngLat: { lng: s.coords[last][0], lat: s.coords[last][1] }, cursor: 'grab' });
        } else if (s.type === 'rectangle') {
            // coords est un polygone fermé à 5 points (le 5e === le 1er)
            for (let i = 0; i < 4; i++) {
                handles.push({
                    role: 'corner', index: i,
                    lngLat: { lng: s.coords[i][0], lat: s.coords[i][1] },
                    cursor: (i === 0 || i === 2) ? 'nwse-resize' : 'nesw-resize'
                });
            }
        } else if (s.type === 'circle') {
            const c = s.center || s.coords[0];
            const e = s.edge   || s.coords[Math.floor(s.coords.length / 4)] || c;
            handles.push({ role: 'edge', index: 0, lngLat: { lng: e[0], lat: e[1] }, cursor: 'ew-resize' });
            // poignée "centre" pour visualiser, drag = move
            handles.push({ role: 'move', index: -1, lngLat: { lng: c[0], lat: c[1] }, cursor: 'move' });
        } else if (s.type === 'text') {
            // une seule poignée bottom-right pour ajuster la taille de la police
            const c = s.coords[0];
            handles.push({ role: 'textresize', index: 0, lngLat: { lng: c[0], lat: c[1] }, cursor: 'nwse-resize' });
        }
        return handles;
    },

    _renderHandles() {
        this._clearHandles();
        if (!this.map || !this._selectedShapeId) return;
        // Verrouillé : pas de poignées (ni déplacement, ni redimensionnement).
        if (this._locked) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) { this._deselectShape(); return; }
        const handles = this._shapeHandles(s);
        for (const h of handles) {
            const el = document.createElement('div');
            const isMove = h.role === 'move';
            const size = isMove ? 14 : 16;
            el.style.cssText = `
                width: ${size}px; height: ${size}px;
                background: ${isMove ? '#3b82f6' : '#ffffff'};
                border: 2px solid ${isMove ? '#ffffff' : '#3b82f6'};
                border-radius: ${h.role === 'edge' || isMove ? '50%' : '3px'};
                box-shadow: 0 1px 4px rgba(0,0,0,0.45);
                cursor: ${h.cursor};
                pointer-events: auto;
                touch-action: none;
                user-select: none;
                -webkit-user-select: none;
            `;
            // offset bottom-right pour la poignée textresize
            const markerOpts = { element: el, anchor: 'center' };
            if (h.role === 'textresize') {
                el.title = 'Glisser pour ajuster la taille du texte';
                markerOpts.offset = [60, 30];
            }
            const m = new maplibregl.Marker(markerOpts).setLngLat([h.lngLat.lng, h.lngLat.lat]).addTo(this.map);
            const shapeId = s.id;
            const role = h.role;
            const index = h.index;
            const onDown = this._safe((ev) => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                const rect = this.map.getCanvas().getBoundingClientRect();
                const cx = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left;
                const cy = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top;
                const lngLat = this.map.unproject([cx, cy]);
                this._startHandleGesture(shapeId, role, index, lngLat, ev);
            }, 'handle:down');
            el.addEventListener('pointerdown', onDown);
            el.addEventListener('touchstart', onDown, { passive: false });
            this._handleMarkers.push(m);
        }
    },

    /**
     * Geste de manipulation d'une poignée. Le pivot dépend du rôle :
     *   - endpoint (line)  : pivot = autre endpoint
     *   - corner (rect)    : pivot = coin opposé
     *   - edge (circle)    : pivot = centre, rayon redimensionné
     *   - move (circle ctr): translation de toute la forme
     *   - textresize       : ajuste shape.fontSize selon le delta px du pointeur
     */
    _startHandleGesture(shapeId, role, index, startLngLat, originalEvent) {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        const startPx = this.map.project(startLngLat);

        try { this.map.dragPan.disable(); } catch (_) {}
        this.map.getCanvas().style.cursor = 'grabbing';
        this._gesture = { type: 'handle', shapeId, role, index, original, startPx };

        const clientToLngLat = (cx, cy) => {
            const r = this.map.getCanvas().getBoundingClientRect();
            return this.map.unproject([cx - r.left, cy - r.top]);
        };
        const extract = (ev) => {
            if (ev && ev.lngLat) return ev.lngLat;
            if (ev && ev.touches && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if (ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };
        const extractPx = (ev) => {
            if (ev && ev.point) return ev.point;
            if (ev && ev.touches && ev.touches[0]) {
                const r = this.map.getCanvas().getBoundingClientRect();
                return { x: ev.touches[0].clientX - r.left, y: ev.touches[0].clientY - r.top };
            }
            if (ev && ev.clientX !== undefined) {
                const r = this.map.getCanvas().getBoundingClientRect();
                return { x: ev.clientX - r.left, y: ev.clientY - r.top };
            }
            return null;
        };

        const onMove = this._safe((ev) => {
            if (!this._gesture || this._gesture.type !== 'handle') return;
            const cur = extract(ev);
            if (!cur) return;
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shapeId);
            if (!t) return;
            const curArr = [cur.lng, cur.lat];

            if (t.type === 'line' && role === 'endpoint') {
                t.coords = original.coords.slice();
                t.coords[index] = curArr;
            } else if (t.type === 'rectangle' && role === 'corner') {
                // pivot = coin diagonalement opposé
                const opposite = original.coords[(index + 2) % 4];
                t.coords = this._rectPolygon(opposite, curArr);
            } else if (t.type === 'circle' && role === 'edge') {
                const center = (original.center || original.coords[0]).slice();
                t.center = center;
                t.edge = curArr;
                t.coords = this._circlePolygon(center, curArr);
            } else if (t.type === 'circle' && role === 'move') {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                t.coords = original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (original.center) t.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   t.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            } else if (t.type === 'text' && role === 'textresize') {
                const px = extractPx(ev);
                if (!px) return;
                const dy = px.y - startPx.y;
                // ~1px souris = ~0.4pt de police, plage 9-72
                const base = original.fontSize || 13;
                t.fontSize = Math.max(9, Math.min(72, Math.round(base + dy * 0.4)));
            }
            this._saveShapes(list2);
            this._renderShapes();
            this._renderHandles();          // suit la forme
            this._updateFloatingToolbarPos(); // suit aussi
        }, 'handle:move');

        const onUp = this._safe(() => {
            try { this.map.off('mousemove', onMove); } catch (_) {}
            try { this.map.off('touchmove', onMove); } catch (_) {}
            try { this.map.off('mouseup', onUp); } catch (_) {}
            try { this.map.off('touchend', onUp); } catch (_) {}
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
            try { this.map.dragPan.enable(); } catch (_) {}
            this.map.getCanvas().style.cursor = '';
            this._gesture = null;
            this._refreshUndoRedoButtons();
        }, 'handle:up');

        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        this.map.on('mouseup', onUp);
        this.map.on('touchend', onUp);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    },

    /** Rendu de la barre flottante d'actions (Texte / Couleur / Suppr / +/-). */
    _renderFloatingToolbar() {
        this._clearFloatingToolbar();
        if (!this.map || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        const anchor = this._shapeAnchor(s);
        if (!anchor) return;

        const el = document.createElement('div');
        el.className = 'plan-floating-toolbar';
        el.style.cssText = `
            display: flex; gap: 4px; align-items: center;
            background: rgba(20,24,32,0.95);
            backdrop-filter: blur(8px);
            color: #fff;
            padding: 4px 6px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.15);
            box-shadow: 0 6px 18px rgba(0,0,0,0.5);
            font-family: var(--font-ui, sans-serif);
            white-space: nowrap;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
        `;
        const btn = (icon, title, color) => `
            <button type="button" data-act="${icon}" title="${title}"
                style="background: transparent; border: 0; color: ${color || '#fff'};
                       padding: 6px; min-width: 34px; min-height: 34px;
                       border-radius: 6px; cursor: pointer; display: inline-flex;
                       align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">${icon}</span>
            </button>`;

        let html = '';
        html += btn('text_fields', s.text ? 'Modifier le texte' : 'Ajouter du texte', '#eab308');
        if (s.text || s.type === 'text') {
            html += btn('text_decrease', 'Réduire la taille', '#fff');
            html += btn('text_increase', 'Agrandir la taille', '#fff');
        }
        if (s.type === 'circle') {
            const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
            html += btn(diaOn ? 'straighten' : 'visibility_off', diaOn ? 'Masquer le diamètre' : 'Afficher le diamètre', diaOn ? '#22c55e' : '#94a3b8');
        }
        html += `<span style="width:1px; height: 22px; background: rgba(255,255,255,0.18); margin: 0 2px;"></span>`;
        html += btn('delete', 'Supprimer', '#ef4444');
        html += btn('close',  'Désélectionner', '#94a3b8');
        el.innerHTML = html;

        // Stoppe la propagation pour ne pas re-déclencher le geste de la forme
        const stop = (ev) => ev.stopPropagation();
        el.addEventListener('pointerdown', stop);
        el.addEventListener('mousedown',   stop);
        el.addEventListener('touchstart',  stop, { passive: false });

        el.querySelectorAll('button[data-act]').forEach(b => {
            b.onclick = (ev) => {
                ev.stopPropagation();
                const act = b.dataset.act;
                if (act === 'text_fields') this._openTextModal(s.id);
                else if (act === 'text_decrease') this._adjustFontSize(s.id, -2);
                else if (act === 'text_increase') this._adjustFontSize(s.id, +2);
                else if (act === 'straighten' || act === 'visibility_off') this._toggleShapeDiameter(s.id);
                else if (act === 'delete') {
                    this._pushHistory();
                    const list = this._loadShapes().filter(x => x.id !== s.id);
                    this._saveShapes(list);
                    this._deselectShape();
                    this._renderShapes();
                    this._refreshUndoRedoButtons();
                } else if (act === 'close') {
                    this._deselectShape();
                }
            };
        });

        this._toolbarMarker = new maplibregl.Marker({
            element: el, anchor: 'bottom', offset: [0, -28]
        }).setLngLat([anchor.lng, anchor.lat]).addTo(this.map);
    },

    /** Met à jour la position de la barre flottante (suit la forme). */
    _updateFloatingToolbarPos() {
        if (!this._toolbarMarker || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        const a = this._shapeAnchor(s);
        if (a) this._toolbarMarker.setLngLat([a.lng, a.lat]);
    },

    _adjustFontSize(shapeId, delta) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.fontSize || 13;
        s.fontSize = Math.max(9, Math.min(72, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    /** Ajuste l'épaisseur du trait d'une forme (trait / cercle / rectangle). */
    _adjustStrokeWidth(shapeId, delta) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.strokeWidth || 3;
        s.strokeWidth = Math.max(1, Math.min(24, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    _toggleShapeDiameter(shapeId) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s || s.type !== 'circle') return;
        s.showDiameter = !(s.showDiameter !== false); // toggle, défaut true
        this._saveShapes(list);
        this._renderDiameters();
        if (this._activeWheel) {
            // Si la roue est ouverte, on la rafraîchit pour l'icône à jour
            this._openShapeWheel(shapeId, this._activeWheel.lngLat);
        }
    },

    // ============================================================
    // =================  ROUES CONTEXTUELLES  ===================
    // ============================================================
    /** Ferme la roue active s'il y en a une. */
    _closeWheel() {
        if (this._activeWheel) { try { this._activeWheel.destroy(); } catch (_) {} this._activeWheel = null; }
        this._wheelJustClosed = Date.now();
    },

    /** Couleurs OTAN (référencées partout).
     *  `defaultLabel` (optionnel) force le libellé quand on pose en quick-place,
     *  même si l'icône par défaut s'appelle autrement dans PIN_ICONS. */
    _otanColors() {
        return [
            { kind: 'Adv',     color: '#ef4444', icon: 'person_alert' },
            { kind: 'Otage',   color: '#eab308', icon: 'person_off' },
            { kind: 'Inter',   color: '#3b82f6', icon: 'local_police' },
            { kind: 'Oscar',   color: '#22c55e', icon: 'military_tech', defaultLabel: 'Oscar' },
            { kind: 'Inconnu', color: '#94a3b8', icon: 'help' }
        ];
    },

    /**
     * Roue de CRÉATION d'un ping — 1 SEUL niveau, simple :
     *  - 5 segments couleur : tap = ping placé directement (icône par défaut)
     *  - 1 segment "Catalogue" : ouvre un panneau d'icônes (color + icon)
     * Après placement, ouvre la roue d'options sur le ping.
     */
    _openCreatePingWheel(lngLat) {
        this._closeWheel();
        const opts = this._otanColors().map(o => ({
            id: 'kind_' + o.kind,
            icon: o.icon,
            label: o.kind,
            color: '#fff',
            bg: o.color,
            action: () => this._quickPlacePing(lngLat, o, o.icon)
        }));
        opts.push({
            id: 'catalog',
            icon: 'apps',
            label: 'Catalogue',
            color: '#fff',
            bg: '#475569',
            action: () => this._openIconCatalogPanel(lngLat)
        });

        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: 'Nouveau ping',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Pose un ping rapide. Le label par défaut = label override OTAN s'il existe,
     *  sinon le nom de l'icône (PIN_ICONS), sinon le kind. */
    _quickPlacePing(lngLat, otan, iconId) {
        const id = `free_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const iconDef = PIN_ICONS.find(i => i.id === iconId);
        const defaultLabel = otan.defaultLabel || (iconDef ? iconDef.label : otan.kind);
        this._addPin({
            id,
            label: defaultLabel,
            color: otan.color,
            kind: otan.kind,
            icon: iconId,
            lng: lngLat.lng,
            lat: lngLat.lat
        });
        // Ouvre la roue d'édition à proximité pour ajustements rapides
        setTimeout(() => this._openPingOptionsWheel(id), 80);
    },

    /** Roue d'options pour un ping existant (texte, diamètre, icône, suppr). */
    _openPingOptionsWheel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        const lngLat = { lng: pin.lng, lat: pin.lat };
        const otanColor = pin.color || '#3b82f6';
        const hasText = !!pin.text;
        const hasDiameter = pin.diameterM > 0;

        const opts = [
            {
                id: 'text',
                icon: 'text_fields',
                label: hasText ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff',
                bg: 'rgba(234,179,8,0.95)',
                action: () => this._editPinText(pinId)
            },
            {
                id: 'diameter',
                icon: 'straighten',
                label: hasDiameter ? 'Modifier diamètre' : 'Ajouter diamètre',
                color: '#fff',
                bg: 'rgba(34,197,94,0.95)',
                action: () => this._editPinDiameter(pinId)
            },
            {
                id: 'icon',
                icon: 'palette',
                label: 'Changer icône',
                color: '#fff',
                bg: 'rgba(99,102,241,0.95)',
                action: () => this._openIconCatalogPanelForEdit(pinId)
            },
            {
                id: 'color',
                icon: 'palette',
                label: 'Couleur',
                color: '#fff',
                bg: 'rgba(168,85,247,0.95)',
                action: () => this._openPinColorPanel(pinId)
            },
            {
                id: 'delete',
                icon: 'delete',
                label: 'Supprimer',
                color: '#fff',
                bg: 'rgba(239,68,68,0.95)',
                action: () => this._removePin(pinId)
            }
        ];

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: pin.label || pin.kind || 'Ping',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    // ============================================================
    // =======  MINI-PANELS INLINE (sans prompt natif)  ===========
    // ============================================================

    /** Ferme le mini-panel actif s'il y en a un. */
    _closeInlinePanel() {
        if (this._inlinePanel) {
            try { if (this._inlinePanel.__cleanup) this._inlinePanel.__cleanup(); } catch (_) {}
            try { this._inlinePanel.remove(); } catch (_) {}
            this._inlinePanel = null;
            this._wheelJustClosed = Date.now(); // évite la réouverture par tap juste après
        }
    },

    /**
     * Crée un mini-panel flottant ancré à une position lng/lat sur la carte.
     * Le panel suit le pan/zoom. Auto-ferme sur outside tap (capture phase).
     * @returns {HTMLElement} l'élément à remplir
     */
    _openInlinePanel(lngLat, contentHtml, { onMount, anchorOffsetY = -56, centerScreen = false, onBack = null } = {}) {
        this._closeInlinePanel();
        this._closeWheel();
        const parent = this.map.getContainer();
        const el = document.createElement('div');
        el.className = 'plan-inline-panel';
        el.style.cssText = `
            position: absolute;
            transform: translate(-50%, -50%) scale(0.92);
            opacity: 0;
            transition: transform 140ms cubic-bezier(.34,1.56,.64,1), opacity 120ms ease-out;
            background: rgba(20,24,32,0.96);
            backdrop-filter: blur(10px);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 12px;
            padding: 10px 12px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.6);
            font-family: var(--font-ui, sans-serif);
            z-index: 70;
            display: flex; align-items: center; gap: 8px;
            max-width: min(94vw, 420px);
        `;
        // Bouton retour optionnel (← roue précédente) ajouté avant le contenu
        const backHtml = onBack ? `
            <button type="button" data-panel-back="1" title="Retour"
                style="min-width: 38px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
                       color: #fff; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;">
                <span class="material-symbols-outlined" style="font-size: 20px;">arrow_back</span>
            </button>
        ` : '';
        el.innerHTML = backHtml + contentHtml;
        // Empêche les events de la map sur ce panel
        el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        el.addEventListener('mousedown',   (ev) => ev.stopPropagation());
        el.addEventListener('touchstart',  (ev) => ev.stopPropagation(), { passive: true });
        if (onBack) {
            const backBtn = el.querySelector('[data-panel-back="1"]');
            if (backBtn) backBtn.onclick = (ev) => {
                ev.stopPropagation();
                this._closeInlinePanel();
                setTimeout(() => onBack(), 60);
            };
        }
        parent.appendChild(el);

        const clampToParent = () => {
            // Garantit que le panel reste entièrement visible dans la carte.
            if (!el || !el.isConnected) return;
            const r = el.getBoundingClientRect();
            const pr = parent.getBoundingClientRect();
            const pad = 8;
            let dx = 0, dy = 0;
            if (r.left   < pr.left   + pad) dx = pr.left   + pad - r.left;
            if (r.right  > pr.right  - pad) dx = pr.right  - pad - r.right;
            if (r.top    < pr.top    + pad) dy = pr.top    + pad - r.top;
            if (r.bottom > pr.bottom - pad) dy = pr.bottom - pad - r.bottom;
            if (dx || dy) {
                const left = parseFloat(el.style.left) || 0;
                const top  = parseFloat(el.style.top)  || 0;
                el.style.left = `${left + dx}px`;
                el.style.top  = `${top  + dy}px`;
            }
        };
        const reposition = () => {
            if (!lngLat || centerScreen) {
                const r = parent.getBoundingClientRect();
                el.style.left = `${r.width / 2}px`;
                el.style.top  = `${r.height / 2}px`;
            } else {
                const p = this.map.project(lngLat);
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y + anchorOffsetY}px`;
            }
            // Clamp immédiat puis encore après layout (au cas où contenu changé)
            requestAnimationFrame(clampToParent);
        };
        reposition();
        this.map.on('move', reposition);
        this.map.on('zoom', reposition);

        // Outside tap closes
        const mountedAt = Date.now();
        const onOutside = (ev) => {
            if (Date.now() - mountedAt < 120) return;
            if (!el.contains(ev.target)) {
                this._closeInlinePanel();
            }
        };
        document.addEventListener('pointerdown', onOutside, { capture: true });
        const onKey = (ev) => { if (ev.key === 'Escape') this._closeInlinePanel(); };
        document.addEventListener('keydown', onKey);

        this._inlinePanel = el;
        el.__cleanup = () => {
            try { this.map.off('move', reposition); } catch (_) {}
            try { this.map.off('zoom', reposition); } catch (_) {}
            document.removeEventListener('pointerdown', onOutside, { capture: true });
            document.removeEventListener('keydown', onKey);
        };
        // Hook personnalisé pour wiring après mount
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%, -50%) scale(1)';
            if (onMount) onMount(el);
        });
        return el;
    },

    /** Édite (ou ajoute) le texte d'un ping via un mini-panel flottant. */
    _editPinText(pinId) {
        const list = this._loadPins();
        const p = list.find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const initial = (p.text || '').replace(/"/g, '&quot;');
        const html = `
            <span class="material-symbols-outlined" style="font-size: 20px; color: #eab308;">text_fields</span>
            <input type="text" value="${initial}" placeholder="Texte du ping…" autocomplete="off"
                style="flex:1; min-width: 180px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                       border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 15px;
                       outline: none;" />
            <button type="button" data-act="save" title="Enregistrer"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: #22c55e; border: 1px solid #16a34a; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">check</span>
            </button>
            <button type="button" data-act="clear" title="Effacer"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
            </button>
        `;
        this._openInlinePanel(ll, html, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const input = root.querySelector('input');
                if (input) { input.focus(); input.select(); }
                root.querySelector('[data-act="save"]').onclick = () => {
                    const v = (root.querySelector('input').value || '').trim();
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (p2) { p2.text = v; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                root.querySelector('[data-act="clear"]').onclick = () => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (p2) { delete p2.text; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                root.querySelector('input').addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') root.querySelector('[data-act="save"]').click();
                });
            }
        });
    },

    /**
     * Mini-panel diamètre — combine MODIFIER la valeur ET TOGGLE on/off l'affichage.
     *  - Toggle visibilité : conserve la valeur, masque/affiche le cercle
     *  - Presets / custom  : changent la valeur
     *  - Bouton ✕          : retire complètement le diamètre
     */
    _editPinDiameter(pinId) {
        const list = this._loadPins();
        const p = list.find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const current = p.diameterM || 0;
        const visible = p.diameterM > 0 && p.showDiameter !== false;
        const presets = [50, 100, 250, 500, 1000];
        const preBtn = (v) => `
            <button type="button" data-preset="${v}"
                style="min-width: 56px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: ${current === v ? '#22c55e' : 'rgba(255,255,255,0.08)'};
                       border: 1px solid ${current === v ? '#16a34a' : 'rgba(255,255,255,0.18)'};
                       color: #fff; font-weight: 600; font-size: 13px; padding: 0 10px;">
                ${v < 1000 ? v + ' m' : (v/1000) + ' km'}
            </button>`;
        const toggleIcon = visible ? 'visibility' : 'visibility_off';
        const toggleColor = visible ? '#22c55e' : '#94a3b8';
        const toggleTitle = visible ? 'Cercle visible (cliquer pour masquer)' : 'Cercle masqué (cliquer pour afficher)';
        this._openInlinePanel(ll, `
            <button type="button" data-act="toggle" title="${toggleTitle}"
                style="min-width: 44px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.06); border: 1px solid ${toggleColor};
                       color: ${toggleColor}; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 22px;">${toggleIcon}</span>
            </button>
            <span class="material-symbols-outlined" style="font-size: 20px; color: #22c55e;">straighten</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                ${presets.map(preBtn).join('')}
                <input type="number" min="1" step="1" placeholder="custom (m)" value="${current && !presets.includes(current) ? current : ''}"
                    style="width: 100px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                           border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px;
                           outline: none;" />
            </div>
            <button type="button" data-act="clear" title="Retirer complètement"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">close</span>
            </button>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const setDiameter = (n) => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (!p2) return;
                    if (!isFinite(n) || n <= 0) {
                        delete p2.diameterM;
                        delete p2.showDiameter;
                    } else {
                        p2.diameterM = n;
                        p2.showDiameter = true; // forcer affichage à l'assignation d'une valeur
                    }
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                const toggleVisibility = () => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (!p2) return;
                    if (!p2.diameterM || p2.diameterM <= 0) {
                        // pas de diamètre défini → on ne peut pas toggler ; ouvre direct la saisie
                        return;
                    }
                    p2.showDiameter = !(p2.showDiameter !== false);
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                root.querySelector('[data-act="toggle"]').onclick = toggleVisibility;
                root.querySelectorAll('[data-preset]').forEach(b => {
                    b.onclick = () => setDiameter(parseFloat(b.dataset.preset));
                });
                root.querySelector('[data-act="clear"]').onclick = () => setDiameter(NaN);
                const input = root.querySelector('input[type="number"]');
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') setDiameter(parseFloat(input.value));
                });
                input.addEventListener('blur', () => {
                    const v = parseFloat(input.value);
                    if (isFinite(v) && v > 0) setDiameter(v);
                });
            }
        });
    },

    /**
     * Panneau flottant catalogue d'icônes (remplace l'ancien sous-menu wheel).
     * Recentre la carte sur lngLat pour garantir la visibilité complète du panel
     * (sinon il peut déborder hors écran sur petits viewports).
     */
    _openIconCatalogPanel(lngLat) {
        this._closeWheel();
        // Recentrage : easeTo immédiat pour que le panel apparaisse au centre visible
        try { this.map.easeTo({ center: [lngLat.lng, lngLat.lat], duration: 300 }); } catch (_) {}
        // Construction HTML
        const colorChips = this._otanColors().map(o => `
            <button type="button" class="cat-col" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 40px; min-height: 40px; border-radius: 50%;
                       background: ${o.color}; border: 3px solid ${o.color === '#94a3b8' ? '#fff' : 'transparent'};
                       cursor: pointer; flex: 0 0 auto;"></button>
        `).join('');
        const html = `
            <div style="display: flex; flex-direction: column; gap: 10px; width: min(94vw, 380px);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: #fff;">palette</span>
                    <strong style="font-size: 13px;">Couleur</strong>
                    <div style="display: flex; gap: 6px; margin-left: auto;">${colorChips}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="text" id="cat-filter" placeholder="Filtrer (police, pompier, drogue…)" autocomplete="off"
                        style="flex: 1; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
                     gap: 6px; max-height: 42vh; overflow-y: auto;"></div>
            </div>
        `;
        const el = this._openInlinePanel(lngLat, html, {
            centerScreen: true,
            onBack: () => this._openCreatePingWheel(lngLat),
            onMount: (root) => {
                let selectedColor = '#3b82f6';
                let selectedKind  = 'Inter';
                // Sélection initiale
                root.querySelectorAll('.cat-col').forEach(c => {
                    c.style.borderColor = (c.dataset.color === selectedColor) ? '#fff' : 'transparent';
                });
                root.querySelectorAll('.cat-col').forEach(c => {
                    c.onclick = () => {
                        selectedColor = c.dataset.color;
                        selectedKind  = c.dataset.kind;
                        root.querySelectorAll('.cat-col').forEach(o => o.style.borderColor = 'transparent');
                        c.style.borderColor = '#fff';
                    };
                });

                const grid = root.querySelector('#cat-grid');
                const filterInput = root.querySelector('#cat-filter');
                const renderGrid = (filter = '') => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter(ic => {
                        if (!q) return true;
                        return (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q);
                    });
                    grid.innerHTML = filtered.map(ic => `
                        <button type="button" class="cat-ic" data-id="${ic.id}" data-label="${ic.label}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 2px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.15);
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.65em; text-align: center; line-height: 1.05;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll('.cat-ic').forEach(b => {
                        b.onclick = () => {
                            const ic = { id: b.dataset.id, label: b.dataset.label };
                            const otan = { kind: selectedKind, color: selectedColor };
                            this._closeInlinePanel();
                            this._quickPlacePing(lngLat, otan, ic.id);
                        };
                    });
                };
                renderGrid('');
                filterInput.addEventListener('input', () => renderGrid(filterInput.value));
            }
        });
    },

    /** Mini-panel inline pour changer la couleur OTAN d'un ping (sans sous-wheel). */
    _openPinColorPanel(pinId) {
        const p = this._loadPins().find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const chips = this._otanColors().map(o => `
            <button type="button" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 44px; min-height: 44px; border-radius: 50%;
                       background: ${o.color}; cursor: pointer;
                       border: 3px solid ${p.color === o.color ? '#fff' : 'transparent'};
                       box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></button>
        `).join('');
        this._openInlinePanel(ll, `
            <span class="material-symbols-outlined" style="font-size: 20px;">palette</span>
            <strong style="font-size: 13px;">Couleur :</strong>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                root.querySelectorAll('button[data-color]').forEach(b => {
                    b.onclick = () => {
                        const list = this._loadPins();
                        const p2 = list.find(x => x.id === pinId);
                        if (p2) { p2.color = b.dataset.color; p2.kind = b.dataset.kind; this._savePins(list); this._renderPins(); }
                        this._closeInlinePanel();
                    };
                });
            }
        });
    },

    /** Catalogue d'icônes pour MODIFIER un ping existant (préserve la couleur). */
    _openIconCatalogPanelForEdit(pinId) {
        const p = this._loadPins().find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        try { this.map.easeTo({ center: [ll.lng, ll.lat], duration: 300 }); } catch (_) {}
        const html = `
            <div style="display: flex; flex-direction: column; gap: 10px; width: min(94vw, 380px);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: ${p.color || '#fff'};">${p.icon || 'place'}</span>
                    <strong style="font-size: 13px;">Icône actuelle</strong>
                    <input type="text" id="cat-edit-filter" placeholder="Filtrer…" autocomplete="off"
                        style="flex: 1; margin-left: auto; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-edit-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
                     gap: 6px; max-height: 42vh; overflow-y: auto;"></div>
            </div>
        `;
        this._openInlinePanel(ll, html, {
            centerScreen: true,
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const grid = root.querySelector('#cat-edit-grid');
                const fi = root.querySelector('#cat-edit-filter');
                const renderGrid = (filter = '') => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter(ic =>
                        !q || (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q)
                    );
                    grid.innerHTML = filtered.map(ic => `
                        <button type="button" class="cat-edit-ic" data-id="${ic.id}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 2px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: ${ic.id === p.icon ? p.color + '40' : 'rgba(255,255,255,0.04)'};
                                   border: 1px solid ${ic.id === p.icon ? p.color : 'rgba(255,255,255,0.15)'};
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.65em; text-align: center; line-height: 1.05;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll('.cat-edit-ic').forEach(b => {
                        b.onclick = () => {
                            const list = this._loadPins();
                            const tgt = list.find(x => x.id === pinId);
                            if (tgt) {
                                tgt.icon = b.dataset.id;
                                // Met à jour le label par défaut au nom de la nouvelle icône
                                const ic = PIN_ICONS.find(i => i.id === b.dataset.id);
                                if (ic) tgt.label = ic.label;
                                this._savePins(list);
                                this._renderPins();
                            }
                            this._closeInlinePanel();
                        };
                    });
                };
                renderGrid('');
                fi.addEventListener('input', () => renderGrid(fi.value));
            }
        });
    },

    /** Roue contextuelle pour modifier une FORME existante. */
    _openShapeWheel(shapeId, lngLat) {
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;
        const opts = [
            {
                id: 'text',
                icon: 'text_fields',
                label: s.text ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff', bg: 'rgba(234,179,8,0.95)',
                action: () => this._openTextModal(s.id)
            }
        ];
        if (s.type === 'text') {
            // Texte libre : les boutons taille agissent sur la police.
            opts.push(
                { id: 'minus', icon: 'text_decrease', label: 'Taille -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, -2), keepOpen: true },
                { id: 'plus', icon: 'text_increase', label: 'Taille +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, +2), keepOpen: true }
            );
        } else {
            // Trait / Cercle / Rectangle : les boutons taille règlent l'épaisseur du trait.
            opts.push(
                { id: 'thin', icon: 'remove', label: 'Épaisseur -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, -1), keepOpen: true },
                { id: 'thick', icon: 'add', label: 'Épaisseur +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, +1), keepOpen: true }
            );
        }
        if (s.type === 'circle') {
            const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
            opts.push({
                id: 'diameter',
                icon: diaOn ? 'visibility_off' : 'straighten',
                label: diaOn ? 'Masquer diamètre' : 'Afficher diamètre',
                color: '#fff', bg: 'rgba(34,197,94,0.95)',
                action: () => this._toggleShapeDiameter(s.id)
            });
        }
        opts.push({
            id: 'delete', icon: 'delete', label: 'Supprimer',
            color: '#fff', bg: 'rgba(239,68,68,0.95)',
            action: () => {
                this._pushHistory();
                const list = this._loadShapes().filter(x => x.id !== s.id);
                this._saveShapes(list);
                this._deselectShape();
                this._renderShapes();
                this._refreshUndoRedoButtons();
            }
        });

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: ({ line: 'Trait', rectangle: 'Rectangle', circle: 'Cercle', text: 'Texte' })[s.type] || 'Forme',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Bascule en mode déplacement : la forme suit le curseur jusqu'au prochain clic.
     *  Compatible souris ET tactile (mousemove + touchmove → click pour valider). */
    /**
     * Démarrage générique d'une transformation (déplacement / redimensionnement).
     * Au lieu d'un "clic-pour-valider" (sujet à races avec maplibre), on affiche
     * une barre flottante Valider/Annuler — déterministe, claire, mobile-friendly.
     *
     * @param {Object} opts
     *   @param {string} opts.mode      'move' | 'resize'
     *   @param {string} opts.shapeId
     *   @param {Function} opts.applyMove  (currentLngLat, original) => updatedShape
     *   @param {string} opts.cursor    valeur CSS cursor
     *   @param {string} opts.hintText  texte d'aide
     */
    _startTransform({ mode, shapeId, applyMove, cursor, hintText }) {
        // Si une transformation est déjà en cours, on l'annule proprement.
        if (this.moveState) this._cancelMoveShape();

        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;

        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        this.moveState = { shapeId, mode, original, applyMove };

        const onMove = (e) => {
            if (!this.moveState) return;
            const cur = [e.lngLat.lng, e.lngLat.lat];
            const list2 = this._loadShapes();
            const target = list2.find(s => s.id === shapeId);
            if (!target) return;
            try {
                applyMove(cur, original, target);
            } catch (err) {
                console.error('[PlanMap] applyMove échec:', err);
                return;
            }
            this._saveShapes(list2);
            this._renderShapes();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') this._cancelMoveShape();
            else if (e.key === 'Enter') this._endMoveShape();
        };

        this._moveHandlers = { onMove, onKey };
        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        document.addEventListener('keydown', onKey);
        this.map.getCanvas().style.cursor = cursor || 'move';

        this._showTransformToolbar(hintText);
    },

    /**
     * Déplacement : translation par delta du curseur depuis l'ancre (point cliqué).
     */
    _startMoveShape(shapeId, anchorLngLat) {
        this._startTransform({
            mode: 'move',
            shapeId,
            cursor: 'move',
            hintText: 'Déplacement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
            applyMove: (cur, original, target) => {
                const dLng = cur[0] - anchorLngLat[0];
                const dLat = cur[1] - anchorLngLat[1];
                target.coords = original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (original.center) target.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   target.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            }
        });
    },

    /**
     * Redimensionnement : pivot fixe (start / coin / centre selon le type),
     * point mobile = curseur. Régénère la géométrie de la forme.
     */
    _startResizeShape(shapeId) {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;
        const orig = JSON.parse(JSON.stringify(shape));
        let pivot;
        if (shape.type === 'line')           pivot = orig.coords[0].slice();
        else if (shape.type === 'rectangle') pivot = orig.coords[0].slice();
        else if (shape.type === 'circle')    pivot = (orig.center || orig.coords[0]).slice();
        else return; // pas de resize pour text

        this._startTransform({
            mode: 'resize',
            shapeId,
            cursor: 'nwse-resize',
            hintText: 'Redimensionnement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
            applyMove: (cur, original, target) => {
                if (target.type === 'line') {
                    target.coords = [pivot.slice(), cur];
                } else if (target.type === 'rectangle') {
                    target.coords = this._rectPolygon(pivot, cur);
                } else if (target.type === 'circle') {
                    target.coords = this._circlePolygon(pivot, cur);
                    target.center = pivot.slice();
                    target.edge = cur;
                }
            }
        });
    },

    _endMoveShape() {
        if (!this.moveState) return;
        this._teardownMove();
        this._refreshUndoRedoButtons();
    },

    _cancelMoveShape() {
        if (!this.moveState) return;
        // Restaure l'original
        const { shapeId, original } = this.moveState;
        const list = this._loadShapes();
        const idx = list.findIndex(s => s.id === shapeId);
        if (idx !== -1) {
            list[idx] = original;
            this._saveShapes(list);
            this._renderShapes();
        }
        // Annule le snapshot d'historique poussé au démarrage
        this.history.pop();
        this._teardownMove();
        this._refreshUndoRedoButtons();
    },

    _teardownMove() {
        if (this._moveHandlers) {
            try { this.map.off('mousemove', this._moveHandlers.onMove); } catch (e) {}
            try { this.map.off('touchmove', this._moveHandlers.onMove); } catch (e) {}
            document.removeEventListener('keydown', this._moveHandlers.onKey);
            this._moveHandlers = null;
        }
        this.moveState = null;
        if (this.map) this.map.getCanvas().style.cursor = '';
        this._hideTransformToolbar();
    },

    /** Barre flottante de validation (Valider / Annuler) pour move/resize. */
    _showTransformToolbar(message) {
        this._hideTransformToolbar();
        const parent = document.getElementById('plan_map')?.parentElement;
        if (!parent) return;
        const bar = document.createElement('div');
        bar.id = 'plan_transform_toolbar';
        bar.style.cssText = `
            position: absolute; top: 10px; left: 50%;
            transform: translateX(-50%);
            display: flex; align-items: center; gap: 10px;
            background: rgba(20,24,32,0.95);
            backdrop-filter: blur(10px);
            color: #fff;
            padding: 8px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.15);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            font-family: var(--font-ui, sans-serif);
            font-size: 0.88em;
            z-index: 50;
            max-width: calc(100% - 20px);
            flex-wrap: wrap;
            justify-content: center;
        `;
        bar.innerHTML = `
            <span style="opacity: 0.9;">${message}</span>
            <button type="button" data-act="ok" style="
                display: inline-flex; align-items: center; gap: 4px;
                background: rgba(34,197,94,0.2); border: 1px solid #22c55e;
                color: #22c55e; padding: 6px 12px; border-radius: 6px;
                cursor: pointer; font-weight: 600; min-height: 36px;">
                <span class="material-symbols-outlined" style="font-size: 18px;">check</span>Valider
            </button>
            <button type="button" data-act="cancel" style="
                display: inline-flex; align-items: center; gap: 4px;
                background: rgba(239,68,68,0.2); border: 1px solid #ef4444;
                color: #ef4444; padding: 6px 12px; border-radius: 6px;
                cursor: pointer; font-weight: 600; min-height: 36px;">
                <span class="material-symbols-outlined" style="font-size: 18px;">close</span>Annuler
            </button>
        `;
        bar.querySelector('[data-act="ok"]').onclick = (ev) => {
            ev.stopPropagation();
            this._endMoveShape();
        };
        bar.querySelector('[data-act="cancel"]').onclick = (ev) => {
            ev.stopPropagation();
            this._cancelMoveShape();
        };
        parent.appendChild(bar);
    },

    _hideTransformToolbar() {
        const bar = document.getElementById('plan_transform_toolbar');
        if (bar) bar.remove();
    },

    // ============================================================
    // ===================  ANNOTATIONS TEXTE  ====================
    // ============================================================

    /**
     * Ouvre la modale d'édition de texte pour la forme `targetId`.
     * Si `targetId` correspond à une forme `text` existante, on l'édite.
     * Sinon, on ajoute / modifie l'annotation `text` d'une forme dessinée.
     */
    _openTextModal(targetId) {
        this._bindTextModalOnce(); // défensif : assure que les listeners sont en place
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (!modal || !backdrop) return;
        const target = this._loadShapes().find(s => s.id === targetId);
        const input = document.getElementById('plan_text_input');
        const idHidden = document.getElementById('plan_text_target_id');
        const colorVal = document.getElementById('plan_text_color_val');
        const sizeVal  = document.getElementById('plan_text_size_input');
        const sizeDisp = document.getElementById('plan_text_size_val');
        const titleEl = document.getElementById('planTextModalTitle');
        if (titleEl) titleEl.textContent = target?.type === 'text' ? 'Texte libre' : 'Annoter le dessin';
        if (idHidden) idHidden.value = targetId;
        if (input) input.value = target?.text || '';
        const col = target?.textColor || target?.color || '#ffffff';
        if (colorVal) colorVal.value = col;
        const sz = Math.max(9, Math.min(72, target?.fontSize || 13));
        if (sizeVal) sizeVal.value = String(sz);
        if (sizeDisp) sizeDisp.textContent = String(sz);
        document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(b => {
            b.style.borderColor = (b.dataset.color === col) ? '#fff' : 'transparent';
        });
        // En plein écran, le modal (enfant de <body>) n'est pas rendu : seul le
        // sous-arbre de l'élément fullscreen l'est. On le déplace donc dans cet
        // élément le temps de l'édition, puis on le restaure à la fermeture.
        this._mountModalInFullscreen(modal, backdrop);
        backdrop.style.display = 'block';
        modal.style.display = 'block';
        setTimeout(() => input && input.focus(), 50);
    },

    /**
     * Si un élément est en plein écran et que le modal n'en fait pas partie,
     * on réinsère modal + backdrop dans l'élément fullscreen (sinon invisibles).
     * Mémorise l'emplacement d'origine pour pouvoir restaurer.
     */
    _mountModalInFullscreen(modal, backdrop) {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl || !modal) return;
        if (fsEl.contains(modal)) return; // déjà dedans
        this._modalReparent = {
            modal, backdrop,
            modalParent: modal.parentNode, modalNext: modal.nextSibling,
            bdParent: backdrop ? backdrop.parentNode : null, bdNext: backdrop ? backdrop.nextSibling : null
        };
        if (backdrop) fsEl.appendChild(backdrop);
        fsEl.appendChild(modal);
    },

    /** Restaure modal + backdrop à leur emplacement d'origine (post-plein écran). */
    _restoreModalFromFullscreen() {
        const r = this._modalReparent;
        if (!r) return;
        try {
            if (r.modalParent) r.modalParent.insertBefore(r.modal, r.modalNext);
            if (r.bdParent && r.backdrop) r.bdParent.insertBefore(r.backdrop, r.bdNext);
        } catch (_) {}
        this._modalReparent = null;
    },

    _hideTextModal() {
        // Si l'utilisateur ferme la modale d'un texte libre vide jamais validé,
        // on retire la forme fantôme du store (évite les invisibles persistants).
        const id = document.getElementById('plan_text_target_id')?.value;
        if (id) {
            const list = this._loadShapes();
            const idx = list.findIndex(s => s.id === id);
            if (idx !== -1 && list[idx].type === 'text' && !list[idx].text) {
                list.splice(idx, 1);
                this._saveShapes(list);
                if (this._selectedShapeId === id) this._deselectShape();
                this._renderShapes();
            }
        }
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Confirme la saisie de texte : applique sur la forme cible. */
    _confirmTextModal() {
        const id = document.getElementById('plan_text_target_id')?.value;
        const text = (document.getElementById('plan_text_input')?.value || '').trim();
        const color = document.getElementById('plan_text_color_val')?.value || '#ffffff';
        const size = parseInt(document.getElementById('plan_text_size_input')?.value, 10) || 13;
        if (!id) return this._hideTextModal();
        const list = this._loadShapes();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) return this._hideTextModal();
        this._pushHistory();
        if (list[idx].type === 'text') {
            if (!text) {
                // Suppression d'un texte libre
                list.splice(idx, 1);
                if (this._selectedShapeId === id) this._deselectShape();
            } else {
                list[idx].text = text;
                list[idx].textColor = color;
                list[idx].color = color;
                list[idx].fontSize = Math.max(9, Math.min(72, size));
            }
        } else {
            list[idx].text = text;
            list[idx].textColor = color;
            list[idx].fontSize = Math.max(9, Math.min(72, size));
        }
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // Garde la forme sélectionnée pour permettre l'édition immédiate (handles + toolbar)
        const stillExists = this._loadShapes().some(s => s.id === id);
        if (stillExists) this._selectShape(id);
        // Ferme la modale (sans retrigger le cleanup vide)
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Initialise (une seule fois) les listeners de la modale de texte. */
    _bindTextModalOnce() {
        if (this._textModalBound) return;
        this._textModalBound = true;
        const ok = document.getElementById('planTextConfirmBtn');
        const ko = document.getElementById('planTextCancelBtn');
        if (ok) ok.onclick = () => this._confirmTextModal();
        if (ko) ko.onclick = () => this._hideTextModal();
        document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(o => o.style.borderColor = 'transparent');
                b.style.borderColor = '#fff';
                document.getElementById('plan_text_color_val').value = b.dataset.color;
            };
        });
        const minusBtn = document.getElementById('plan_text_size_minus');
        const plusBtn  = document.getElementById('plan_text_size_plus');
        const sizeInput= document.getElementById('plan_text_size_input');
        const sizeDisp = document.getElementById('plan_text_size_val');
        const setSize = (n) => {
            const v = Math.max(9, Math.min(72, n));
            if (sizeInput) sizeInput.value = String(v);
            if (sizeDisp)  sizeDisp.textContent = String(v);
        };
        if (minusBtn) minusBtn.onclick = () => setSize(parseInt(sizeInput.value, 10) - 2);
        if (plusBtn)  plusBtn.onclick  = () => setSize(parseInt(sizeInput.value, 10) + 2);
        // Échap / Ctrl-Entrée dans la modale
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('planTextModal');
            if (!modal || modal.style.display !== 'block') return;
            if (e.key === 'Escape') this._hideTextModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._confirmTextModal();
        });
    },

    /** Place une nouvelle forme `text` libre à la position cliquée. */
    _addFreeText(lngLat) {
        const id = 'shape_' + Date.now();
        const list = this._loadShapes();
        this._pushHistory();
        list.push({
            id, type: 'text',
            color: this.drawColor || '#ffffff',
            textColor: this.drawColor || '#ffffff',
            coords: [[lngLat.lng, lngLat.lat]],
            text: ''
        });
        this._saveShapes(list);
        this._refreshUndoRedoButtons();
        // Ouvre immédiatement la modale pour saisir le texte
        this._openTextModal(id);
    },

    /** Point d'ancrage d'une forme pour positionner son texte. */
    _shapeAnchor(s) {
        if (s.type === 'line') {
            const a = s.coords[0], b = s.coords[s.coords.length - 1];
            return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
        }
        if (s.type === 'rectangle') {
            const lngs = s.coords.map(c => c[0]);
            const lats = s.coords.map(c => c[1]);
            return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                     lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
        }
        if (s.type === 'circle') {
            const c = s.center || s.coords[0];
            return { lng: c[0], lat: c[1] };
        }
        if (s.type === 'text') {
            const c = s.coords[0];
            return { lng: c[0], lat: c[1] };
        }
        return null;
    },

    /** Bounding-box pixels (à zoom courant) d'une forme. */
    _shapePixelBounds(s) {
        if (!this.map) return { width: 100, height: 50 };
        if (s.type === 'text') return { width: 240, height: 80 };
        const coords = s.coords || [];
        if (!coords.length) return { width: 100, height: 50 };
        const pts = coords.map(c => this.map.project({ lng: c[0], lat: c[1] }));
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return {
            width:  Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
        };
    },

    /**
     * Rendu des annotations texte des formes (HTML markers).
     *  - line  : centré sur le milieu du trait, légèrement au-dessus
     *  - rect  : centré dans le rectangle, max-width ~ largeur
     *  - circ  : centré, max-width ~ diamètre × 0.7 (carré inscrit)
     *  - text  : annotation libre, max-width fixe
     *
     * Tronqué visuellement par `overflow: hidden` + max-height pour
     * garantir qu'il ne dépasse jamais la forme.
     */
    _renderShapeTexts() {
        if (!this.map) return;
        // Purge des markers précédents
        if (this._textMarkers) this._textMarkers.forEach(m => m.remove());
        this._textMarkers = [];
        // Index par shape ID pour que les diamètres puissent se positionner sous le texte
        this._textMarkersById = {};

        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'text' && !s.text) continue;          // pas de texte = rien à afficher
            if (s.type === 'text' && !s.text) continue;          // text vide = caché
            const anchor = this._shapeAnchor(s);
            if (!anchor) continue;
            const bounds = this._shapePixelBounds(s);

            let maxW, maxH, offsetY = 0;
            if (s.type === 'line') {
                maxW = Math.max(60, bounds.width * 0.95);
                maxH = 48;
                offsetY = -18;
            } else if (s.type === 'rectangle') {
                maxW = Math.max(40, bounds.width  * 0.92);
                maxH = Math.max(20, bounds.height * 0.92);
            } else if (s.type === 'circle') {
                const d = Math.min(bounds.width, bounds.height);
                maxW = Math.max(36, d * 0.7);
                maxH = Math.max(20, d * 0.7);
            } else if (s.type === 'text') {
                maxW = 240; maxH = 120;
            }

            const div = document.createElement('div');
            div.className = 'plan-shape-text';
            div.textContent = s.text || '';
            const col = s.textColor || s.color || '#fff';
            const fontSize = Math.max(9, Math.min(72, s.fontSize || 13));
            div.style.cssText = `
                color: ${col};
                text-shadow:
                    0 0 3px rgba(0,0,0,0.95),
                    0 0 6px rgba(0,0,0,0.7),
                    0 1px 2px rgba(0,0,0,0.9);
                font-family: var(--font-ui, system-ui, sans-serif);
                font-weight: 700;
                font-size: ${fontSize}px;
                line-height: 1.18;
                text-align: center;
                max-width: ${Math.round(maxW)}px;
                max-height: ${Math.round(maxH)}px;
                white-space: pre-wrap;
                overflow: hidden;
                pointer-events: auto;          /* interactif : tap/drag */
                cursor: grab;
                padding: 1px 4px;
                box-sizing: border-box;
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                touch-action: none;
            `;
            // Délégation au state-machine gestuelle commune : tap = menu, drag = déplacer
            const shapeId = s.id;
            const onTextPointerDown = (ev) => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                // Convertit la position pointeur → lngLat carte
                const rect = this.map.getCanvas().getBoundingClientRect();
                const x = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left;
                const y = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top;
                const lngLat = this.map.unproject([x, y]);
                this._startShapeGesture(shapeId, lngLat, ev);
            };
            div.addEventListener('pointerdown', onTextPointerDown);
            // Fallback pour vieux iOS sans Pointer Events
            div.addEventListener('touchstart', onTextPointerDown, { passive: false });

            const m = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, offsetY]
            }).setLngLat([anchor.lng, anchor.lat]).addTo(this.map);
            this._textMarkers.push(m);
            this._textMarkersById[s.id] = m;
        }
    },

    /**
     * Long-press detector (Google Maps style) : 500 ms d'appui immobile sur zone
     * vide ouvre la roue de création de ping. Annulé dès qu'on bouge (pan), qu'on
     * relâche, ou qu'on touche une forme/ping.
     *
     * Implémente un feedback haptique-visuel : pulse à l'écran quand le timer
     * atteint la moitié, full quand validé.
     */
    _wireLongPressForPing() {
        const LP_DELAY = 480;     // ms
        const LP_TOLERANCE = 8;   // px de tolérance
        let lp = null; // { startPx, startLngLat, timer, ringEl }

        const cancel = () => {
            if (!lp) return;
            if (lp.timer) clearTimeout(lp.timer);
            if (lp.ringEl) { try { lp.ringEl.remove(); } catch (_) {} }
            lp = null;
        };
        const isOnFeature = (point) => {
            const hits = this.map.queryRenderedFeatures(point, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit']
            });
            return hits.length > 0;
        };
        const showRing = (clientX, clientY) => {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: fixed; left: ${clientX}px; top: ${clientY}px;
                width: 12px; height: 12px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid #3b82f6;
                box-shadow: 0 0 0 0 rgba(59,130,246,0.6);
                pointer-events: none;
                z-index: 9999;
                animation: pctacLpRing ${LP_DELAY}ms linear forwards;
            `;
            document.body.appendChild(ring);
            return ring;
        };
        // Keyframe injecté une fois
        if (!document.getElementById('pctac-lp-ring-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-lp-ring-style';
            s.textContent = `@keyframes pctacLpRing {
                0%   { width: 12px; height: 12px; opacity: 0.4; }
                100% { width: 56px; height: 56px; opacity: 0.95; box-shadow: 0 0 12px 6px rgba(59,130,246,0.45); }
            }`;
            document.head.appendChild(s);
        }

        const start = (e) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._activeWheel || this._inlinePanel) return;
            const oe = e.originalEvent;
            // Multi-touch (pinch zoom etc.) → on annule le long-press
            if (oe && oe.touches && oe.touches.length > 1) { cancel(); return; }
            if (lp) cancel(); // ne pas empiler
            // Si le pointerdown provient d'un marker DOM (pin, handle, label, toolbar…),
            // ne pas déclencher la création de ping — c'est le marker qui gère.
            if (oe && oe.target && typeof oe.target.closest === 'function' &&
                oe.target.closest('.maplibregl-marker, .plan-wheel, .plan-inline-panel')) return;
            if (isOnFeature(e.point)) return; // forme/ping → priorité au gestionnaire de forme
            const clientX = (oe && oe.touches && oe.touches[0]) ? oe.touches[0].clientX
                          : (oe && oe.clientX) || 0;
            const clientY = (oe && oe.touches && oe.touches[0]) ? oe.touches[0].clientY
                          : (oe && oe.clientY) || 0;
            const ringEl = showRing(clientX, clientY);
            lp = {
                startPx: { x: e.point.x, y: e.point.y },
                startLngLat: e.lngLat,
                ringEl,
                timer: setTimeout(() => {
                    if (!lp) return;
                    const ll = lp.startLngLat;
                    cancel();
                    this._openCreatePingWheel(ll);
                }, LP_DELAY)
            };
        };
        const move = (e) => {
            if (!lp) return;
            const dx = e.point.x - lp.startPx.x, dy = e.point.y - lp.startPx.y;
            if (Math.hypot(dx, dy) > LP_TOLERANCE) cancel();
        };

        this.map.on('mousedown', this._safe(start, 'longpress:start'));
        this.map.on('touchstart', this._safe(start, 'longpress:start'));
        this.map.on('mousemove', this._safe(move, 'longpress:move'));
        this.map.on('touchmove', this._safe(move, 'longpress:move'));
        this.map.on('mouseup', this._safe(cancel, 'longpress:cancel'));
        this.map.on('touchend', this._safe(cancel, 'longpress:cancel'));
        this.map.on('touchcancel', this._safe(cancel, 'longpress:cancel'));
        this.map.on('dragstart', this._safe(cancel, 'longpress:cancel'));
        this.map.on('movestart', this._safe(cancel, 'longpress:cancel'));
    },

    _loadShapes() {
        try { return JSON.parse(localStorage.getItem(SHAPES_KEY)) || []; }
        catch (e) { return []; }
    },

    _saveShapes(list) {
        try { localStorage.setItem(SHAPES_KEY, JSON.stringify(list)); }
        catch (e) {
            console.error('[PlanMap] save shapes échec:', e);
            if (e.name === 'QuotaExceededError') alert('Mémoire saturée : impossible de sauvegarder les dessins.');
        }
    },

    /** Rectangle aligné carte = polygone à 5 points (fermé) */
    _rectPolygon(a, b) {
        return [
            [a[0], a[1]],
            [b[0], a[1]],
            [b[0], b[1]],
            [a[0], b[1]],
            [a[0], a[1]]
        ];
    },

    /** Approximation polygonale d'un cercle géodésique (Haversine inverse).
     *  64 segments, calcul exact en mètres pour rester rond à toute latitude. */
    _circlePolygon(center, edge) {
        const R = 6371000; // rayon Terre en m
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

    /**
     * Capture haute qualité de la carte avec ses annotations.
     *
     * Approche robuste (fonctionne aussi en plein écran) :
     *  1. Base = canvas WebGL natif de MapLibre (tuiles, terrain, bâtiments,
     *     dessins) — toujours aux dimensions correctes quel que soit l'état.
     *  2. Overlay = markers DOM (pins + libellés + boussole) via html2canvas,
     *     en IGNORANT le canvas WebGL pour ne capturer que le DOM léger.
     *  3. Composition des deux dans un canvas final → PNG.
     *
     * On ne capture donc jamais le conteneur entier via html2canvas (ce qui
     * cassait en plein écran : taille écran × scale → canvas démesuré).
     */
    async _takeScreenshot() {
        if (typeof html2canvas === 'undefined') {
            alert('Librairie html2canvas indisponible (réseau ?)');
            return;
        }
        const mapContainer = document.getElementById('plan_map').parentElement;
        if (!mapContainer) return;

        // Éléments UI à masquer temporairement (on garde la boussole MapLibre)
        const toHide = [
            document.getElementById('plan_unified_toolbar'),
            document.getElementById('plan_draw_dock'),
            document.getElementById('plan_search_panel'),
            document.getElementById('plan_legend'),
            document.getElementById('plan_hint')
        ].filter(Boolean);
        const memo = toHide.map(el => el.style.display);
        toHide.forEach(el => { el.style.display = 'none'; });

        // Forcer un repaint pour que le canvas WebGL contienne la frame actuelle
        this.map.triggerRepaint();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        let outCanvas;
        try {
            const glCanvas = this.map.getCanvas();
            const w = glCanvas.width;   // dimensions pixel réelles (déjà × devicePixelRatio)
            const h = glCanvas.height;

            // Overlay DOM (markers, boussole) — html2canvas en ignorant tous les <canvas>
            const dpr = w / glCanvas.clientWidth; // ratio réel appliqué par MapLibre
            const overlay = await html2canvas(mapContainer, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: null,
                logging: false,
                scale: dpr,
                width: glCanvas.clientWidth,
                height: glCanvas.clientHeight,
                ignoreElements: (el) => el.tagName === 'CANVAS'
            });

            // Composition finale
            outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            const ctx = outCanvas.getContext('2d');
            ctx.drawImage(glCanvas, 0, 0, w, h);
            ctx.drawImage(overlay, 0, 0, w, h);
        } catch (e) {
            console.error('[PlanMap] screenshot échec:', e);
            alert('Erreur lors de la capture : ' + e.message);
            return;
        } finally {
            // Restaurer l'UI
            toHide.forEach((el, i) => { el.style.display = memo[i] || ''; });
        }

        outCanvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url;
            a.download = `pctac-plan-${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    },

    _showHint(msg) {
        let hint = document.getElementById('plan_hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'plan_hint';
            hint.style.cssText = `
                position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
                background: var(--accent-blue); color: white; padding: 8px 16px;
                border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: 0.85em;
                z-index: 11; box-shadow: 0 4px 15px rgba(59,130,246,0.4);
                cursor: pointer;
            `;
            hint.title = 'Cliquer pour annuler';
            hint.onclick = () => {
                this.pendingEntityPin = null;
                this.pendingFreePin = null;
                this._hideHint();
            };
            document.getElementById('plan_map').parentElement.appendChild(hint);
        }
        hint.textContent = msg + ' (clic ici pour annuler)';
        hint.style.display = 'block';
    },

    _hideHint() {
        const hint = document.getElementById('plan_hint');
        if (hint) hint.style.display = 'none';
    }
};

window.PlanMap = PlanMap;
