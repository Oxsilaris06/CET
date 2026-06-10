import { PDF_PAX_COLORS, FREE_MODE_COLORS, LONG_PRESS_DELAY, PHOTO_CATEGORIES } from './config.js';
import { Storage } from './storage.js';
import { ImageStore } from './imageStore.js';
import { LogManager } from './logManager.js';

// Échappement HTML de toute valeur utilisateur injectée en innerHTML
// (noms, titres de photo éditables, etc.) — anti-corruption d'affichage et anti-XSS.
const esc = (v) => (window.UIPlatform
    ? window.UIPlatform.esc(v)
    : String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

/**
 * Gestionnaire de l'interface utilisateur PC TAC
 */

export const UI = {
    // Éléments du DOM (mis à jour à l'initialisation)
    elements: {},

    /**
     * Initialise les références aux éléments du DOM
     */
    initElements() {
        this.elements = {
            logTableBody: document.querySelector('#logTable tbody'),
            logForm: document.getElementById('log-form'),
            heureInput: document.getElementById('heure_input'),
            paxInput: document.getElementById('pax_input'),
            paxModeInput: document.getElementById('pax_mode_input'),
            paxCustomColorInput: document.getElementById('pax_custom_color_input'),
            freePaxInput: document.getElementById('free_pax_input'),
            lieuInput: document.getElementById('lieu_input'),
            remarquesInput: document.getElementById('remarques_input'),
            paxSelectContainer: document.getElementById('pax_select_container'),
            suggestionsBox: document.getElementById('pax_suggestions'),
            freeColorPalette: document.getElementById('free_color_palette'),
            darkModeIcon: document.getElementById('darkModeIcon'),
            fullscreenIcon: document.getElementById('fullscreenIcon'),
            dockMenu: document.getElementById('dockMenu'),
            dockToggleIcon: document.querySelector('#dockToggleBtn .material-symbols-outlined'),
            jsonImportInput: document.getElementById('jsonImportInput'),
            adversaryForm: document.getElementById('adversary-form'),
            hostageForm: document.getElementById('hostage-form'),
            friendForm: document.getElementById('friend-form'),
            photoForm: document.getElementById('photo-form'),
            createPaxModal: document.getElementById('createPaxModal'),
            newPaxColorPalette: document.getElementById('new_pax_color_palette')
        };
        this.bindModalBackdrop();
    },

    /**
     * Ferme toute modale active au clic sur le fond assombri (m5).
     * Les modales (.modal) et le fond (#modalBackdrop) sont des éléments frères :
     * un clic sur le fond est donc toujours un clic « hors modale ».
     */
    bindModalBackdrop() {
        const backdrop = document.getElementById('modalBackdrop');
        if (!backdrop || backdrop.dataset.bound) return;
        backdrop.dataset.bound = '1';
        backdrop.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
            backdrop.style.display = 'none';
        });
    },

    /**
     * Calcule le contraste pour la couleur du texte (Noir ou Blanc)
     */
    getContrastYIQ(hexcolor) {
        if (!hexcolor || hexcolor === 'undefined') return '#ffffff';
        const r = parseInt(hexcolor.slice(1, 3), 16);
        const g = parseInt(hexcolor.slice(3, 5), 16);
        const b = parseInt(hexcolor.slice(5, 7), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    },

    /**
     * Met à jour l'heure dans l'input
     */
    updateTimeInput(force = false) {
        if (window.isTimeInputManuallyChanged && !force) return;
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        if (this.elements.heureInput) this.elements.heureInput.value = time;
    },

    /**
     * Change la vue principale via les onglets
     */
    switchMainView(viewId) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewId);
        });
        document.querySelectorAll('.tab-content-view').forEach(view => {
            view.classList.toggle('active', view.id === viewId);
        });
        if (viewId === 'view-adversaires') this.renderAdversaries();
        if (viewId === 'view-otages') this.renderHostages();
        if (viewId === 'view-amis') this.renderFriends();
        if (viewId === 'view-photos') {
            const lastFilter = localStorage.getItem('lastPhotoFilter') || 'all';
            this.renderPhotos(lastFilter);
        }
        if (viewId === 'view-plan' && window.PlanMap) {
            window.PlanMap.refresh();
        }
        localStorage.setItem('lastView', viewId);
    },

    /**
     * Change le mode de sélection du Pax
     */
    setPaxMode(mode) {
        if (!this.elements.paxModeInput) return;
        this.elements.paxModeInput.value = mode;
        const isStandard = mode === 'standard';
        document.querySelectorAll('.mode-toggle-btn').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        const standardWrapper = document.getElementById('pax_select_wrapper_standard');
        const freeWrapper = document.getElementById('pax_select_wrapper_free');
        if (standardWrapper) standardWrapper.style.display = isStandard ? 'block' : 'none';
        if (freeWrapper) freeWrapper.style.display = isStandard ? 'none' : 'block';
    },

    /**
     * Initialise les couleurs et modes Pax
     */
    initPaxModeAndColors() {
        this.initColorPalettes();
        if (this.elements.paxSelectContainer) {
            // On attache les événements aux boutons statiques
            this.elements.paxSelectContainer.querySelectorAll('.pax-select-option:not(.custom):not(#openCreatePaxBtn)').forEach(btn => {
                const key = btn.dataset.pax;
                if (!key) return;
                
                btn.onclick = () => {
                    if (this.elements.paxInput) this.elements.paxInput.value = key;
                    if (this.elements.paxInput) this.elements.paxInput.dataset.lastSelected = key;
                    if (this.elements.paxInput) this.elements.paxInput.dataset.customColor = '';
                    if (this.elements.paxModeInput) this.elements.paxModeInput.value = 'standard';
                    
                    // Désélectionner TOUS les boutons (natifs et customs)
                    this.elements.paxSelectContainer.querySelectorAll('.pax-select-option').forEach(b => {
                        b.classList.remove('selected');
                        // Réinitialiser les styles inline des boutons custom
                        if (b.classList.contains('custom')) {
                            b.style.background = '';
                            b.style.color = '';
                        }
                    });
                    btn.classList.add('selected');
                };
                
                if (this.elements.paxInput && this.elements.paxInput.value === key) btn.classList.add('selected');
            });
        }
        this.renderCustomPaxOptions();

        const openCreatePaxBtn = document.getElementById('openCreatePaxBtn');
        if (openCreatePaxBtn) {
            openCreatePaxBtn.onclick = () => this.showCreatePaxModal();
        }

        this.initColorPalettes();
    },

    /**
     * Supprime un intervenant personnalisé
     */
    deleteCustomPax(id) {
        if (!confirm("Supprimer cet intervenant ?")) return;
        const list = Storage.loadCollection("pcTacCustomPax");
        const newList = list.filter(p => p.id !== id);
        Storage.saveCollection("pcTacCustomPax", newList);
        this.initPaxModeAndColors();
    },

    /**
     * Affiche le tableau des logs
     */
    renderLogTable(logData) {
        if (!this.elements.logTableBody) return;
        this.elements.logTableBody.innerHTML = '';
        logData.forEach(entry => {
            let paxColor, paxText, paxFontColor;
            if (entry.paxMode === 'standard') {
                const paxInfo = PDF_PAX_COLORS[entry.pax] || PDF_PAX_COLORS['Adversaire'];
                paxColor = paxInfo.color;
                paxText = paxInfo.text;
                paxFontColor = paxInfo.fontColor;
            } else {
                paxColor = entry.paxColor || FREE_MODE_COLORS[0].hex;
                paxText = entry.pax;
                paxFontColor = this.getContrastYIQ(paxColor);
            }
            const row = this.elements.logTableBody.insertRow();
            row.dataset.id = entry.id;
            row.draggable = true;
            row.className = 'draggable';
            row.innerHTML = `
                <td style="width: 15%;">
                    <div class="heure-cell-container">
                        <span class="heure-cell-text">${entry.heure}</span>
                        <button type="button" class="action-btn-small edit" onclick="window.openEditModal('${entry.id}')" title="Modifier">
                            <span class="material-symbols-outlined" style="font-size: 18px;">edit</span>
                        </button>
                        <button type="button" class="delete-btn" onclick="window.deleteLogEntry('${entry.id}')">
                            <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
                        </button>
                    </div>
                </td>
                <td style="width: 15%;"><span class="pax-cell" style="background-color: ${paxColor}; color: ${paxFontColor};">${paxText}</span></td>
                <td style="width: 35%;">${entry.lieu}</td>
                <td style="width: 35%;">${entry.remarques}</td>
            `;
        });
    },

    handleDragOver(e) {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        const afterElement = UI.getDragAfterElement(UI.elements.logTableBody, e.clientY);
        if (afterElement == null) UI.elements.logTableBody.appendChild(dragging);
        else UI.elements.logTableBody.insertBefore(dragging, afterElement);
    },

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    handleDrop(e) {
        e.preventDefault();
        const logData = Array.from(UI.elements.logTableBody.querySelectorAll('tr')).map(row => {
            const id = row.dataset.id;
            return Storage.loadLogData().find(l => l.id === id);
        });
        Storage.saveLogData(logData);
    },

    handleDragEnd() {
        const dragging = document.querySelector('.dragging');
        if (dragging) dragging.classList.remove('dragging');
    },

    openEditModal(id) {
        const logData = Storage.loadLogData();
        const entry = logData.find(e => e.id === id);
        if (!entry) return;
        document.getElementById('edit_id').value = id;
        document.getElementById('edit_heure').value = entry.heure;
        document.getElementById('edit_lieu').value = entry.lieu || '';
        document.getElementById('edit_remarques').value = entry.remarques || '';
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('editModal').style.display = 'block';
    },

    confirmEditLog() {
        const id = document.getElementById('edit_id').value;
        if (!id) return;
        const updated = {
            heure: document.getElementById('edit_heure').value,
            lieu: document.getElementById('edit_lieu').value.trim(),
            remarques: document.getElementById('edit_remarques').value.trim()
        };
        LogManager.updateEntry(id, updated);
        if (updated.lieu) LogManager.addLieuToHistory(updated.lieu);
        this.renderLogTable(Storage.loadLogData());
        this.refreshLieuSuggestions();
        this.hideEditModal();
    },

    hideEditModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('editModal').style.display = 'none';
    },

    /** Recharge les suggestions de localisation dans le datalist */
    refreshLieuSuggestions() {
        const dl = document.getElementById('lieu_suggestions');
        if (!dl) return;
        const hist = LogManager.getLieuHistory();
        dl.innerHTML = hist.map(l => `<option value="${l.replace(/"/g, '&quot;')}">`).join('');
    },

    selectColorSwatch(hex, paletteId, hiddenInputId) {
        const palette = document.getElementById(paletteId);
        if (!palette) return;
        if (hiddenInputId) {
            const input = document.getElementById(hiddenInputId);
            if (input) input.value = hex;
        }
        palette.querySelectorAll('.color-swatch').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.color === hex);
        });
    },

    showCreatePaxModal() {
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('createPaxModal').style.display = 'block';
        document.getElementById('new_pax_name').value = '';
        document.getElementById('new_pax_name').focus();
        
        // Sélectionner la première couleur par défaut
        const firstColor = document.querySelector('#new_pax_color_palette .color-swatch');
        if (firstColor) firstColor.click();
    },

    hideCreatePaxModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('createPaxModal').style.display = 'none';
    },

    renderCustomPaxOptions() {
        const customPaxList = Storage.loadCollection('pcTacCustomPax') || [];
        const container = this.elements.paxSelectContainer;
        if (!container) return;
        container.querySelectorAll('.pax-select-option.custom').forEach(el => el.remove());
        const addBtn = document.getElementById('openCreatePaxBtn');
        customPaxList.forEach(pax => {
            const span = document.createElement('span');
            span.className = 'pax-select-option custom';
            span.textContent = pax.name;
            span.dataset.pax = pax.name;
            
            const selectCustom = () => {
                this.elements.paxInput.value = pax.name;
                this.elements.paxInput.dataset.lastSelected = pax.name;
                this.elements.paxInput.dataset.customColor = pax.color;
                this.elements.paxModeInput.value = 'free';
                
                container.querySelectorAll('.pax-select-option').forEach(b => {
                    b.classList.remove('selected');
                    if (b.classList.contains('custom')) {
                        b.style.background = '';
                        b.style.color = '';
                    }
                });
                
                span.classList.add('selected');
                span.style.background = pax.color;
                span.style.color = this.getContrastYIQ(pax.color);
            };

            span.onclick = selectCustom;
            span.oncontextmenu = (e) => { e.preventDefault(); this.deleteCustomPax(pax.id); };
            
            let timer;
            span.ontouchstart = () => { timer = setTimeout(() => this.deleteCustomPax(pax.id), 800); };
            span.ontouchend = () => clearTimeout(timer);
            
            if (this.elements.paxInput && this.elements.paxInput.value === pax.name) {
                span.classList.add('selected');
                span.style.background = pax.color;
                span.style.color = this.getContrastYIQ(pax.color);
            }
            
            container.insertBefore(span, addBtn);
        });
    },

    async renderAdversaries() {
        const raw = Storage.loadCollection('pcTacAdversaries') || [];
        const list = await ImageStore.hydrate(raw, 'photo');
        const tbody = document.getElementById('adversary-table-body');
        if (!tbody) return;
        tbody.innerHTML = list.map(item => `
            <tr>
                <td style="width: 80px;">
                    ${item.photo ? `<img src="${item.photo}" style="width: 60px; height: 60px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-glass);">` : '<span class="material-symbols-outlined" style="font-size: 40px; color: var(--text-muted);">person</span>'}
                </td>
                <td>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.85em;">
                        <div><strong style="color: var(--accent-blue);">NOM:</strong> ${esc(item.nom)}</div>
                        <div><strong style="color: var(--accent-blue);">PRÉNOM:</strong> ${esc(item.prenom)}</div>
                        <div><strong style="color: var(--accent-blue);"><span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">cake</span>:</strong> ${esc(item.dob) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">LIEN VICTIMES:</strong> ${esc(item.lien) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">ATTITUDE:</strong> ${esc(item.attitude) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">SUBSTANCE:</strong> ${esc(item.substance) || 'N/C'}</div>
                        <div style="grid-column: span 3;"><strong style="color: var(--accent-blue);">ANTÉCÉDENTS:</strong> ${esc(item.antecedents) || 'N/C'}</div>
                        <div style="grid-column: span 3;"><strong style="color: var(--accent-blue);">ARMES:</strong> ${esc(item.armes) || 'N/C'}</div>
                    </div>
                </td>
                <td style="width: 50px;">
                    <div style="display: flex; gap: 5px;">
                        <button class="action-btn-small edit" onclick="window.UI.showEditAdversaryModal('${item.id}')" title="Modifier"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button>
                        <button class="delete-btn" onclick="window.deleteCollectionItem('pcTacAdversaries', '${item.id}', 'view-adversaires')"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    async renderHostages() {
        const raw = Storage.loadCollection('pcTacHostages') || [];
        const list = await ImageStore.hydrate(raw, 'photo');
        const tbody = document.getElementById('hostage-table-body');
        if (!tbody) return;
        tbody.innerHTML = list.map(item => `
            <tr>
                <td style="width: 80px;">
                    ${item.photo ? `<img src="${item.photo}" style="width: 60px; height: 60px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-glass);">` : '<span class="material-symbols-outlined" style="font-size: 40px; color: var(--text-muted);">person</span>'}
                </td>
                <td>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.85em;">
                        <div><strong style="color: var(--civil-yellow);">NOM:</strong> ${esc(item.nom)}</div>
                        <div><strong style="color: var(--civil-yellow);">PRÉNOM:</strong> ${esc(item.prenom)}</div>
                        <div><strong style="color: var(--civil-yellow);"><span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">cake</span>:</strong> ${esc(item.dob) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">LIEN ADV:</strong> ${esc(item.lien) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">ÉTAT:</strong> ${esc(item.etat) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">BLESSURES:</strong> ${esc(item.blessures) || 'N/C'}</div>
                    </div>
                </td>
                <td style="width: 50px;">
                    <div style="display: flex; gap: 5px;">
                        <button class="action-btn-small edit" onclick="window.UI.showEditHostageModal('${item.id}')" title="Modifier"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button>
                        <button class="delete-btn" onclick="window.deleteCollectionItem('pcTacHostages', '${item.id}', 'view-otages')"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    renderFriends() {
        const list = Storage.loadCollection('pcTacFriends') || [];
        const tbody = document.getElementById('friend-table-body');
        if (!tbody) return;
        tbody.innerHTML = list.map(item => `
            <tr>
                <td>${esc(item.nom)} ${esc(item.prenom)}</td>
                <td>${esc(item.unite)}</td>
                <td>${esc(item.tph)}</td>
                <td>${esc(item.mission)}</td>
                <td><button class="delete-btn" onclick="window.deleteCollectionItem('pcTacFriends', '${item.id}', 'view-amis')"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button></td>
            </tr>
        `).join('');
    },

    async renderPhotos(filterCategory) {
        // PC4 — sans argument explicite, conserver le dernier filtre choisi : les
        // appels après ajout / renommage / suppression ne doivent pas réinitialiser
        // l'affichage à « tout » et perdre la catégorie en cours de consultation.
        if (filterCategory === undefined) {
            filterCategory = localStorage.getItem('lastPhotoFilter') || 'all';
        }
        const raw = Storage.loadCollection('pcTacPhotos') || [];
        const board = document.getElementById('photo-board');
        if (!board) return;
        const preFiltered = filterCategory === 'all' ? raw : raw.filter(item => item.category === filterCategory);
        const filteredList = await ImageStore.hydrate(preFiltered, 'data');
        
        // Mise à jour des boutons de filtre pour respecter l'ordre et le style
        const filterContainer = document.getElementById('photo-filter-container');
        if (filterContainer) {
            filterContainer.innerHTML = PHOTO_CATEGORIES.map(cat => `
                <button class="tab-btn ${filterCategory === cat.id ? 'active' : ''}" onclick="UI.renderPhotos('${cat.id}')" style="padding: 6px 12px; font-size: 0.8em; width: auto; flex-direction: row; min-height: unset;">
                    <span>${cat.label}</span>
                </button>
            `).join('');
        }
        localStorage.setItem('lastPhotoFilter', filterCategory);
        
        // Sélection automatique de la catégorie correspondante dans le formulaire si ce n'est pas "all"
        const catSelect = document.getElementById('photo_category');
        if (catSelect && filterCategory !== 'all') {
            catSelect.value = filterCategory;
        }

        board.innerHTML = filteredList.map((item, index) => `
            <div class="photo-card" draggable="true" data-id="${item.id}" data-category="${item.category}" data-status="${item.status || 'active'}" ondragstart="UI.handlePhotoDragStart(event)" ondragover="UI.handlePhotoDragOver(event)" ondrop="UI.handlePhotoDrop(event)">
                <img src="${item.data}" onclick="UI.openLightbox('${item.data}', '${esc(String(item.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')" alt="${esc(item.title)}">
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="photo-title-text" style="font-size: 0.9em; font-weight: bold;">${esc(item.title)}</span>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn-small edit" title="Renommer" onclick="window.UI.editPhotoTitle('${item.id}')"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button>
                            <button class="action-btn-small delete" title="Supprimer" onclick="window.deleteCollectionItem('pcTacPhotos', '${item.id}', 'view-photos')"><span class="material-symbols-outlined" style="font-size: 16px;">delete</span></button>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase;">${(PHOTO_CATEGORIES.find(c => c.id === item.category) || {label: 'Autre'}).label}</span>
                        ${(item.category === 'neutralized' || item.category === 'trap') ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                <option value="active" ${item.status === 'active' || !item.status ? 'selected' : ''}>Actif</option>
                                <option value="neutralized" ${item.status === 'neutralized' ? 'selected' : ''}>Neutralisé</option>
                            </select>
                        ` : ''}
                        ${item.category === 'hostage' ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                <option value="ok" ${item.status === 'ok' || !item.status ? 'selected' : ''}>OK</option>
                                <option value="preoccupant" ${item.status === 'preoccupant' ? 'selected' : ''}>Préoccupant</option>
                                <option value="blesse" ${item.status === 'blesse' ? 'selected' : ''}>Blessé</option>
                                <option value="dcd" ${item.status === 'dcd' ? 'selected' : ''}>DCD</option>
                            </select>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    },

    handlePhotoDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.closest('.photo-card').dataset.id);
        e.target.closest('.photo-card').classList.add('dragging-photo');
    },

    handlePhotoDragOver(e) {
        e.preventDefault();
    },

    handlePhotoDrop(e) {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetCard = e.target.closest('.photo-card');
        if (!targetCard) return;
        const targetId = targetCard.dataset.id;
        if (draggedId === targetId) return;

        const list = Storage.loadCollection('pcTacPhotos');
        const draggedIdx = list.findIndex(p => p.id === draggedId);
        const targetIdx = list.findIndex(p => p.id === targetId);

        const [removed] = list.splice(draggedIdx, 1);
        list.splice(targetIdx, 0, removed);

        Storage.saveCollection('pcTacPhotos', list);
        this.renderPhotos();
    },

    updateAdversaryStatus(id, status) {
        const list = Storage.loadCollection('pcTacPhotos');
        const photo = list.find(p => p.id === id);
        if (photo) {
            photo.status = status;
            Storage.saveCollection('pcTacPhotos', list);
            const currentFilter = localStorage.getItem('lastPhotoFilter') || 'all';
            this.renderPhotos(currentFilter); // Re-render avec le filtre actuel
        }
    },

    editPhotoTitle(id) {
        const list = Storage.loadCollection('pcTacPhotos');
        const photo = list.find(p => p.id === id);
        if (!photo) return;
        const newTitle = prompt("Nouveau titre :", photo.title);
        if (newTitle) { photo.title = newTitle.trim(); Storage.saveCollection('pcTacPhotos', list); this.renderPhotos(); }
    },

    openLightbox(src, title) {
        const modal = document.getElementById('lightboxModal');
        const img = document.getElementById('lightboxImage');
        const titleEl = document.getElementById('lightboxTitle');
        if (!modal || !img) return;
        img.src = src;
        if (titleEl) titleEl.textContent = title;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        modal.onclick = (e) => { if (e.target === modal) this.closeLightbox(); };
        this._lightboxKeydown = (e) => { if (e.key === 'Escape') this.closeLightbox(); };
        window.addEventListener('keydown', this._lightboxKeydown);
    },

    closeLightbox() {
        const modal = document.getElementById('lightboxModal');
        if (!modal) return;
        modal.classList.remove('active');
        document.body.style.overflow = '';
        window.removeEventListener('keydown', this._lightboxKeydown);
    },

    initColorPalettes() {
        const palettes = [
            { id: 'free_color_palette', inputId: 'pax_custom_color_input' },
            { id: 'edit_free_color_palette', inputId: 'edit_free_color_val' },
            { id: 'new_pax_color_palette', inputId: 'new_pax_color_val' }
        ];
        palettes.forEach(p => {
            const container = document.getElementById(p.id);
            if (!container) return;
            container.innerHTML = '';
            FREE_MODE_COLORS.forEach(color => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'color-swatch';
                btn.style.backgroundColor = color.hex;
                btn.dataset.color = color.hex;
                btn.onclick = () => this.selectColorSwatch(color.hex, p.id, p.inputId);
                container.appendChild(btn);
            });
        });
    },

    toggleFullscreen() {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!isFullscreen) { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }
        else { if (document.exitFullscreen) document.exitFullscreen(); }
    },

    updateFullscreenIcon() {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (this.elements.fullscreenIcon) this.elements.fullscreenIcon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
    },

    handleThemeToggle() {
        document.body.classList.toggle('light-mode'); 
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        if (this.elements.darkModeIcon) this.elements.darkModeIcon.textContent = isDarkMode ? 'nightlight' : 'clear_day';
    },

    toggleDock() {
        const dockCollapsed = this.elements.dockMenu.classList.toggle('collapsed');
        localStorage.setItem('dockCollapsed', dockCollapsed);
        if (this.elements.dockToggleIcon) this.elements.dockToggleIcon.textContent = dockCollapsed ? 'expand_less' : 'expand_more';
    },

    toggleSearchMode() {
        document.getElementById('search_container').style.display = 'block';
        document.querySelector('.form-row.main-fields').style.display = 'none';
        document.getElementById('addLogBtn').style.display = 'none';
        document.getElementById('searchInput').focus();
    },

    closeSearchMode() {
        document.getElementById('search_container').style.display = 'none';
        document.querySelector('.form-row.main-fields').style.display = '';
        document.getElementById('addLogBtn').style.display = '';
        document.getElementById('searchInput').value = '';
        this.filterLogs();
    },

    filterLogs() {
        const query = document.getElementById('searchInput').value.toLowerCase();
        const rows = document.querySelectorAll('#logTable tbody tr');
        rows.forEach(row => { row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none'; });
    },

    showResetModal() {
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('resetModal').style.display = 'block';
    },

    hideResetModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('resetModal').style.display = 'none';
        this.hideEditModal();
    },

    async showEditAdversaryModal(id) {
        const list = Storage.loadCollection('pcTacAdversaries');
        const item = list.find(adv => adv.id === id);
        if (!item) return;

        document.getElementById('edit_adv_id').value = id;
        const fields = ['nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance', 'armes'];
        fields.forEach(f => {
            const el = document.getElementById('edit_adv_' + f);
            if (el) el.value = item[f] || '';
        });
        const preview = document.getElementById('edit_adv_preview');
        const existingPhoto = await ImageStore.get(id);
        preview.innerHTML = existingPhoto
            ? `<img src="${existingPhoto}" style="width: 100%; height: 100%; object-fit: cover;">`
            : '<span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-muted);">person</span>';

        const fileInput = document.getElementById('edit_adv_photo_input');
        if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }

        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('editAdversaryModal').style.display = 'block';
    },

    hideEditAdversaryModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('editAdversaryModal').style.display = 'none';
    },

    async handleAdversaryUpdate() {
        const id = document.getElementById('edit_adv_id').value;
        if (!id) return;
        const advList = Storage.loadCollection('pcTacAdversaries');
        const adv = advList.find(a => a.id === id);
        if (!adv) return this.hideEditAdversaryModal();

        const fields = ['nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance', 'armes'];
        fields.forEach(f => {
            const el = document.getElementById('edit_adv_' + f);
            if (el) adv[f] = el.value.trim();
        });

        const fileInput = document.getElementById('edit_adv_photo_input');
        const dataUrl = fileInput && fileInput.dataset.compressedBase64;
        if (dataUrl) {
            await ImageStore.put(id, dataUrl);
            delete adv.photo;
            adv.hasImage = true;

            const photoList = Storage.loadCollection('pcTacPhotos');
            const photoSyncId = id + "_sync";
            await ImageStore.put(photoSyncId, dataUrl);
            let photo = photoList.find(p => p.id === photoSyncId);
            if (photo) {
                delete photo.data;
                photo.hasImage = true;
                photo.title = `${adv.nom} ${adv.prenom}`;
            } else {
                photoList.push({
                    id: photoSyncId,
                    title: `${adv.nom} ${adv.prenom}`,
                    category: 'neutralized',
                    status: 'active',
                    hasImage: true
                });
            }
            Storage.saveCollection('pcTacPhotos', photoList);
        }

        Storage.saveCollection('pcTacAdversaries', advList);
        this.hideEditAdversaryModal();
        await this.renderAdversaries();
        if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }
    },

    async showEditHostageModal(id) {
        const list = Storage.loadCollection('pcTacHostages');
        const item = list.find(h => h.id === id);
        if (!item) return;

        document.getElementById('edit_host_id').value = id;
        const fields = ['nom', 'prenom', 'dob', 'lien', 'etat', 'blessures'];
        fields.forEach(f => {
            const el = document.getElementById('edit_host_' + f);
            if (el) el.value = item[f] || '';
        });
        const preview = document.getElementById('edit_host_preview');
        const existingPhoto = await ImageStore.get(id);
        preview.innerHTML = existingPhoto
            ? `<img src="${existingPhoto}" style="width: 100%; height: 100%; object-fit: cover;">`
            : '<span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-muted);">person_off</span>';

        const fileInput = document.getElementById('edit_host_photo_input');
        if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }

        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('editHostageModal').style.display = 'block';
    },

    hideEditHostageModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('editHostageModal').style.display = 'none';
    },

    async handleHostageUpdate() {
        const id = document.getElementById('edit_host_id').value;
        if (!id) return;
        const list = Storage.loadCollection('pcTacHostages');
        const host = list.find(h => h.id === id);
        if (!host) return this.hideEditHostageModal();

        const fields = ['nom', 'prenom', 'dob', 'lien', 'etat', 'blessures'];
        fields.forEach(f => {
            const el = document.getElementById('edit_host_' + f);
            if (el) host[f] = el.value.trim();
        });

        const fileInput = document.getElementById('edit_host_photo_input');
        const dataUrl = fileInput && fileInput.dataset.compressedBase64;
        if (dataUrl) {
            await ImageStore.put(id, dataUrl);
            delete host.photo;
            host.hasImage = true;

            const photoList = Storage.loadCollection('pcTacPhotos');
            const photoSyncId = id + "_sync";
            await ImageStore.put(photoSyncId, dataUrl);
            let photo = photoList.find(p => p.id === photoSyncId);
            if (photo) {
                delete photo.data;
                photo.hasImage = true;
                photo.title = `${host.nom} ${host.prenom}`;
            } else {
                photoList.push({
                    id: photoSyncId,
                    title: `${host.nom} ${host.prenom}`,
                    category: 'hostage',
                    status: 'ok',
                    hasImage: true
                });
            }
            Storage.saveCollection('pcTacPhotos', photoList);
        }

        Storage.saveCollection('pcTacHostages', list);
        this.hideEditHostageModal();
        await this.renderHostages();
        if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }
    }
};

window.UI = UI;
window.setPaxMode = UI.setPaxMode.bind(UI);
window.openEditModal = UI.openEditModal.bind(UI);
window.switchMainView = UI.switchMainView.bind(UI);
window.toggleSearchMode = UI.toggleSearchMode.bind(UI);
window.closeSearchMode = UI.closeSearchMode.bind(UI);
window.filterLogs = UI.filterLogs.bind(UI);
