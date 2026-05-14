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
import { ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY } from './config.js';

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
    initialized: false,
    drawTool: null, // 'line' | 'rectangle' | 'circle' | null
    drawColor: '#ef4444',
    drawState: null, // état temporaire pendant un tracé en cours
    drawPreviewLayerIds: ['plan-draw-preview-fill', 'plan-draw-preview-line'],
    history: [],     // pile d'états {shapes} avant chaque modif
    redoStack: [],   // états annulés réutilisables via redo
    is3D: false,     // mode relief 3D actif

    init() {
        if (this.initialized) return;
        const mapEl = document.getElementById('plan_map');
        if (!mapEl) return;

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

        this.map.on('moveend', () => this._saveView());
        this.map.on('pitchend', () => this._saveView());
        this.map.on('rotateend', () => this._saveView());

        // Restaurer le relief 3D si la vue sauvegardée était inclinée
        if (savedView.is3D) {
            this.map.on('load', () => this._enable3D(false));
        }
        this.map.on('click', (e) => this._onMapClick(e));

        // Drag-to-draw (mousedown / move / up) — souris ET tactile
        this.map.on('mousedown', (e) => this._handleDrawDown(e));
        this.map.on('mousemove', (e) => this._handleDrawMove(e));
        this.map.on('mouseup',   (e) => this._handleDrawUp(e));
        this.map.on('touchstart',(e) => this._handleDrawDown(e));
        this.map.on('touchmove', (e) => this._handleDrawMove(e));
        this.map.on('touchend',  (e) => this._handleDrawUp(e));

        this._bindUi();

        this.map.on('load', () => {
            this._initDrawingLayers();
            this._bindDrawUi();
            this._renderShapes();
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
        if (pingBtn) pingBtn.onclick = () => this._openPingModal();

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
            resultsBox.innerHTML = list.map((item, i) => `
                <div class="plan-search-result" data-idx="${i}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-glass);">
                    ${item.display_name}
                </div>
            `).join('');
            resultsBox.querySelectorAll('.plan-search-result').forEach(div => {
                div.onclick = () => {
                    const item = list[parseInt(div.dataset.idx, 10)];
                    this.map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 17, speed: 1.4 });
                    resultsBox.innerHTML = '';
                };
                div.onmouseover = () => { div.style.background = 'rgba(59, 130, 246, 0.15)'; };
                div.onmouseout = () => { div.style.background = ''; };
            });
        } catch (e) {
            console.error('[PlanMap] Nominatim échec:', e);
            resultsBox.innerHTML = '<em style="color: var(--danger-red);">Erreur réseau. Vérifie ta connexion.</em>';
        }
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
        this._renderPingEntities();
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

    _armFreePinPlacement() {
        const label = document.getElementById('free_pin_label').value.trim();
        const color = document.getElementById('free_pin_color').value;
        let kind = document.getElementById('free_pin_kind').value;
        const isVehicle = document.getElementById('free_pin_is_vehicle')?.checked;
        if (isVehicle) kind = 'Vehicule';
        if (!label) return alert('Libellé requis');
        this.pendingEntityPin = null;
        this.pendingFreePin = { label, color, kind };
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
            const { label, color, kind } = this.pendingFreePin;
            this._addPin({
                id: 'free_' + Date.now(),
                label, color, kind,
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
            const isVehicle = (pin.kind === 'Vehicule' || pin.entityRef?.kind === 'vehicle');

            // --- 1) MARKER PIN ou ICÔNE (selon type) ---
            const pinWrap = document.createElement('div');
            let pinSvg = null;
            let labelOffset; // décalage du label sous l'élément

            if (isVehicle) {
                // Pin véhicule = Material icon, pas de pin teardrop
                pinWrap.style.cssText = `width: 36px; height: 36px; cursor: grab; display: flex; align-items: center; justify-content: center;`;
                pinWrap.innerHTML = `
                    <span class="material-symbols-outlined" style="
                        font-size: 36px;
                        color: ${color};
                        text-shadow:
                            0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff,
                            0 2px 4px rgba(0,0,0,0.6);
                        line-height: 1;
                        font-variation-settings: 'FILL' 1;
                    ">directions_car</span>
                `;
                labelOffset = [0, 22]; // sous l'icône
            } else {
                // Pin classique : SVG teardrop, tailles +20% (22→26, 30→36)
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

            const popupHtml = `
                <div style="font-family: var(--font-ui); font-size: 1.05em; min-width: 160px;">
                    <div style="font-weight: bold; color: ${color}; margin-bottom: 4px;">${label}</div>
                    <div style="font-size: 0.85em; color: #666; margin-bottom: 8px;">${kind}</div>
                    <button type="button" class="plan-pin-delete" data-id="${pin.id}" style="background: rgba(239,68,68,0.15); border: 1px solid #ef4444; color: #ef4444; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">
                        Supprimer
                    </button>
                </div>
            `;
            const popup = new maplibregl.Popup({ offset: 22, closeButton: false }).setHTML(popupHtml);
            // Véhicule = ancre au centre (icône directement sur le point) ; pin teardrop = bottom (pointe)
            const pinMarker = new maplibregl.Marker({ element: pinWrap, anchor: isVehicle ? 'center' : 'bottom', draggable: true })
                .setLngLat([pin.lng, pin.lat])
                .setPopup(popup)
                .addTo(this.map);

            // --- 2) MARKER LABEL séparé, ancré au même lng/lat (label +20% : 11→13) ---
            const labelEl = document.createElement('div');
            labelEl.textContent = label;
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

            // --- Drag : déplace les deux markers ensemble ---
            pinMarker.on('dragstart', () => {
                pinWrap.style.cursor = 'grabbing';
                pinWrap.style.opacity = '0.85';
                labelEl.style.opacity = '0.5';
            });
            pinMarker.on('drag', () => {
                // Sync du label pendant le drag
                labelMarker.setLngLat(pinMarker.getLngLat());
            });
            pinMarker.on('dragend', () => {
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
            });

            popup.on('open', () => {
                const btn = document.querySelector(`.plan-pin-delete[data-id="${pin.id}"]`);
                if (btn) btn.onclick = () => {
                    this._removePin(pin.id);
                    popup.remove();
                };
            });

            this.markers.set(pin.id, { pin: pinMarker, label: labelMarker });
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
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.18
            }
        });
        this.map.addLayer({
            id: 'plan-shapes-line',
            type: 'line',
            source: 'plan-shapes-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 3,
                'line-opacity': 0.9
            }
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

        // Clic suppression d'un dessin existant
        this.map.on('click', 'plan-shapes-fill', (e) => this._onShapeClick(e));
        this.map.on('click', 'plan-shapes-line', (e) => this._onShapeClick(e));
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
        // Style des boutons
        document.querySelectorAll('.plan-draw-btn').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff') : 'var(--text-main)';
        });
        // Curseur + désactive le pan de la carte tant qu'un outil est actif
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
        document.querySelectorAll('.plan-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        // Re-style du bouton actif si un outil est sélectionné
        if (this.drawTool) this._setTool(this.drawTool);
    },

    /** Drag-to-draw : démarrage */
    _handleDrawDown(e) {
        if (!this.drawTool) return;
        // Bloquer le pan/zoom natif
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        if (e.preventDefault) e.preventDefault();
        const lngLat = [e.lngLat.lng, e.lngLat.lat];
        this.drawState = { start: lngLat, current: lngLat };
    },

    /** Drag-to-draw : déplacement (live preview) */
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

    /** Drag-to-draw : relâchement → commit (si le drag a été significatif) */
    _handleDrawUp(e) {
        if (!this.drawTool || !this.drawState) return;
        const end = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : this.drawState.current;
        const start = this.drawState.start;
        // Distance pixel pour filtrer les "clics" non-drag
        const p1 = this.map.project({ lng: start[0], lat: start[1] });
        const p2 = this.map.project({ lng: end[0], lat: end[1] });
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (distPx < 4) {
            // Clic trop court, on annule la preview
            this.drawState = null;
            this._clearPreview();
            return;
        }

        if (this.drawTool === 'line') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'line',
                color: this.drawColor,
                coords: [start, end]
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
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // L'outil reste actif pour enchaîner les tracés ; Échap pour quitter
    },

    _renderPreview(feature) {
        const src = this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    _clearPreview() {
        const src = this.map && this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
    },

    _renderShapes() {
        const src = this.map && this.map.getSource('plan-shapes-src');
        if (!src) return;
        const list = this._loadShapes();
        const features = list.map(s => {
            if (s.type === 'line') {
                return { type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color, shapeId: s.id } };
            }
            // rectangle / circle : polygones
            return { type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [s.coords] }, properties: { color: s.color, shapeId: s.id } };
        });
        src.setData({ type: 'FeatureCollection', features });
    },

    _onShapeClick(e) {
        if (this.drawTool) return; // si on est en train de dessiner, ne pas supprimer
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        if (!confirm('Supprimer ce dessin ?')) return;
        this._pushHistory();
        const list = this._loadShapes().filter(s => s.id !== id);
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _loadShapes() {
        try { return JSON.parse(localStorage.getItem(SHAPES_KEY)) || []; }
        catch (e) { return []; }
    },

    _saveShapes(list) {
        localStorage.setItem(SHAPES_KEY, JSON.stringify(list));
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
