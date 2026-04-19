// ==================== FormManager.js ====================








function addDynamicField(containerId, value = '') {
    const container = document.getElementById(containerId);
    const item = document.createElement('div');
    item.className = 'dynamic-list-item';
    const fieldId = `dyn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    item.innerHTML = `<label for="${fieldId}" class="sr-only">Champ dynamique</label><input type="text" id="${fieldId}" class="dynamic-input" value="${value}" oninput="syncDomToStore()"><button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore();">❌</button>`;
    container.appendChild(item);
}

function initChipContainer(containerId, selectedValues = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const options = JSON.parse(container.dataset.options || '[]');
    container.innerHTML = '';

    options.forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-btn';
        btn.textContent = option;
        if (selectedValues.includes(option)) {
            btn.classList.add('selected');
        }
        btn.addEventListener('click', function () {
            this.classList.toggle('selected');
            syncDomToStore();
        });
        container.appendChild(btn);
    });

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Ajouter personnalisé (entrée)';
    customInput.onkeydown = function (event) {
        if (event.key === 'Enter' && this.value.trim()) {
            event.preventDefault();
            const customValue = this.value.trim();
            // Récupérer les options de base pour s'assurer de ne pas dupliquer
            const currentOptions = JSON.parse(container.dataset.options || '[]');
            // Récupérer les valeurs déjà sélectionnées/ajoutées dynamiquement
            const currentSelected = getChipData(containerId);

            if (!currentOptions.includes(customValue) && !currentSelected.includes(customValue)) {
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'chip-btn selected';
                newBtn.textContent = customValue;
                newBtn.addEventListener('click', function () { this.classList.toggle('selected'); syncDomToStore(); });

                // Insérer avant le champ de saisie pour respecter l'ordre
                container.insertBefore(newBtn, this);
            } else if (currentOptions.includes(customValue) && !currentSelected.includes(customValue)) {
                // Si l'option existe mais n'est pas sélectionnée, la sélectionner
                const existingBtn = Array.from(container.querySelectorAll('.chip-btn')).find(b => b.textContent === customValue);
                if (existingBtn) { existingBtn.classList.add('selected'); }
            }

            this.value = '';
            syncDomToStore();
        }
    };
    customInput.style.flexBasis = '150px';
    customInput.style.flexGrow = '0';
    customInput.style.minHeight = '40px';
    customInput.style.padding = '8px 12px';
    container.appendChild(customInput);
}

function getChipData(containerId) {
    const container = document.getElementById(containerId);
    const selectedChips = container.querySelectorAll('.chip-btn.selected');
    return Array.from(selectedChips).map(btn => btn.textContent);
}

function addMeField(value = '', containerId = 'me_container') {
    const container = document.getElementById(containerId);
    // Limiter à 3 éléments comme dans le code original
    const currentItems = container.querySelectorAll('.dynamic-list-item');
    if (currentItems.length >= 3) return;
    const item = document.createElement('div');
    item.className = 'dynamic-list-item';
    const meIndex = currentItems.length + 1;
    const fieldId = `me_${containerId}_${meIndex}_${Date.now()}`;
    item.innerHTML = `<label for="${fieldId}">ME${meIndex}:</label><input type="text" id="${fieldId}" name="${fieldId}" class="me-input" value="${value}" oninput="syncDomToStore()"><button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore();">❌</button>`;
    container.appendChild(item);
}

function addTimeEvent(type_from_load, hour_from_load = '', desc_from_load) {
    const container = document.getElementById('time_events_container');
    const isLoadingFromFile = type_from_load !== undefined;

    let type, hour = hour_from_load, desc;

    if (isLoadingFromFile) {
        type = type_from_load;
        desc = desc_from_load;
    } else {
        const currentEventCount = container.children.length;
        const prefilledData = [
            { type: 'T0', desc: 'Rasso PSIG' }, { type: 'T1', desc: 'Départ PR' },
            { type: 'T2', desc: 'Départ LE' }, { type: 'T3', desc: 'MEP TERMINÉ' },
            { type: 'T4', desc: 'TOP ACTION' },
        ];
        const defaultValues = prefilledData[currentEventCount] || { type: `T${currentEventCount}`, desc: '' };
        type = defaultValues.type;
        desc = defaultValues.desc;
    }

    const eventId = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const item = document.createElement('div');
    item.className = 'dynamic-list-item time-item draggable';
    item.id = eventId;
    item.setAttribute('draggable', 'true');
    const optionsHtml = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'].map(t =>
        `<option value="${t}" ${t === type ? 'selected' : ''}>${t}</option>`
    ).join('');

    const selectId = `type_${eventId}`;
    const hourId = `hour_${eventId}`;
    const descId = `desc_${eventId}`;

    item.innerHTML = `
                <label for="${selectId}" class="sr-only">Type d'événement</label>
                <select id="${selectId}" class="time-type-select" onchange="syncDomToStore()">${optionsHtml}</select>
                <label for="${hourId}" class="sr-only">Heure</label>
                <input type="time" id="${hourId}" class="time-hour-input" value="${hour}" onchange="syncDomToStore()">
                <label for="${descId}" class="sr-only">Description</label>
                <input type="text" id="${descId}" class="time-description-input" placeholder="Description" value="${desc || ''}" oninput="syncDomToStore()">
                <button type="button" class="remove-btn" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="this.parentElement.remove(); syncDomToStore();">❌</button>`;
    container.appendChild(item);
}

function updateAdvTitle(id, val) {
    const entry = document.getElementById(id);
    if (!entry) return;
    const title = entry.querySelector('.adv-title');
    if (title) {
        title.textContent = val ? `Adversaire: ${val}` : "Adversaire";
    }
}

function removeAdversary(id) {
    if (confirm("Supprimer définitivement cette fiche adversaire ?")) {
        const entry = document.getElementById(id);
        if (entry) {
            // Supprimer les photos d'abord
            entry.querySelectorAll('.image-preview').forEach(img => {
                removeImage(img.id, null);
            });
            entry.remove();
            syncDomToStore();
        }
    }
}

function addAdversary(data = null) {
    const container = document.getElementById('adversaries_container');
    const id = data && data.id ? data.id : `adv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const div = document.createElement('div');
    div.className = 'collapsible-container adversary-entry open';
    div.id = id;
    div.dataset.advId = id;

    const advIndex = container.children.length + 1;
    const nameVal = data?.nom_adversaire || '';
    const title = nameVal ? `Adversaire: ${nameVal}` : `Adversaire`;

    div.innerHTML = `
        <div class="collapsible-header">
            <h3 class="adv-title">${title}</h3>
            <div style="display: flex; gap: 10px; align-items: center;">
                <div onclick="event.stopPropagation()">
                    <button type="button" class="remove-btn" onclick="removeAdversary('${id}')" title="Supprimer cet adversaire">❌</button>
                </div>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <h3 style="margin: 0 0 10px 0; color: var(--accent-blue); font-size: 1.1em;">📷 Gestion Photos</h3>
            
            <label for="input_main_${id}">Photo principale (Aperçu):</label>
            <div id="photo_main_${id}" class="image-preview-container single-photo photo-display-area" data-is-single="true" style="margin-bottom: 5px;"></div>
            <button type="button" class="add-btn" style="width:100%; margin-bottom: 15px;" onclick="document.getElementById('input_main_${id}').click()">📷 Ajouter Photo Principale</button>
            <input type="file" id="input_main_${id}" name="input_main_${id}" class="sr-only-input" accept="image/*" onchange="handleFileChange(this, 'photo_main_${id}', true)">
            
            <label for="input_extra_${id}">Photos supplémentaires (Aperçu):</label>
            <div id="photo_extra_${id}" class="image-preview-container extra-photos photo-display-area" style="margin-bottom: 5px;"></div>
            <button type="button" class="add-btn" style="width:100%; margin-bottom: 15px;" onclick="document.getElementById('input_extra_${id}').click()">📷 Ajouter Photos Supplémentaires</button>
            <input type="file" id="input_extra_${id}" name="input_extra_${id}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_extra_${id}', false)">
            
            <h3 style="margin-top: 10px; color: var(--danger-red); font-size: 1.1em;">📷 Renforts Potentiels</h3>
            <div id="photo_renforts_${id}" class="image-preview-container photo-display-area" style="margin-bottom: 5px;"></div>
            <button type="button" class="add-btn" style="width:100%; justify-content: center; margin-bottom: 20px;" onclick="document.getElementById('input_renforts_${id}').click()">➕ Ajouter Photo(s) Renforts</button>
            <input type="file" id="input_renforts_${id}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_renforts_${id}', false)">

            <hr style="border: 0; border-top: 1px solid var(--border-light); margin: 15px 0;">

            <label for="nom_adv_${id}">Nom/Prénom:</label>
            <input type="text" id="nom_adv_${id}" name="nom_adv_${id}" class="adv-field" data-field="nom_adversaire" placeholder="Nom et Prénom..." value="${nameVal}" oninput="updateAdvTitle('${id}', this.value); syncDomToStore()">
            
            <label for="domicile_adv_${id}">Domicile:</label>
            <textarea id="domicile_adv_${id}" name="domicile_adv_${id}" class="adv-field" data-field="domicile_adversaire" rows="2" oninput="syncDomToStore()">${data?.domicile_adversaire || ''}</textarea>
            
            <label>Moyens Employés (ME):</label>
            <div id="me_${id}" class="me-container"></div>
            <button type="button" class="add-btn" onclick="addMeField('', 'me_${id}')">➕ ME</button>
            
            <h3>Informations Target</h3>
            <div class="dynamic-list-item">
                <label for="naissance_adv_${id}" class="sr-only">Date de naissance</label>
                <input type="date" id="naissance_adv_${id}" name="naissance_adv_${id}" class="adv-field" data-field="date_naissance" value="${data?.date_naissance || ''}" oninput="syncDomToStore()">
                <label for="lieu_adv_${id}" class="sr-only">Lieu de naissance</label>
                <input type="text" id="lieu_adv_${id}" name="lieu_adv_${id}" class="adv-field" data-field="lieu_naissance" placeholder="Lieu de naissance" value="${data?.lieu_naissance || ''}" oninput="syncDomToStore()">
            </div>
            <div class="dynamic-list-item">
                <label for="stature_adv_${id}" class="sr-only">Stature</label>
                <input type="text" id="stature_adv_${id}" name="stature_adv_${id}" class="adv-field" data-field="stature_adversaire" placeholder="Stature" value="${data?.stature_adversaire || ''}" oninput="syncDomToStore()">
                <label for="ethnie_adv_${id}" class="sr-only">Ethnie</label>
                <select id="ethnie_adv_${id}" name="ethnie_adv_${id}" class="adv-field" data-field="ethnie_adversaire" onchange="syncDomToStore()">
                    <option value="" ${!data?.ethnie_adversaire ? 'selected' : ''} disabled>Ethnie</option>
                    <option ${data?.ethnie_adversaire === 'Caucasien' ? 'selected' : ''}>Caucasien</option>
                    <option ${data?.ethnie_adversaire === 'Nord africain' ? 'selected' : ''}>Nord africain</option>
                    <option ${data?.ethnie_adversaire === 'Afro-antillais' ? 'selected' : ''}>Afro-antillais</option>
                    <option ${data?.ethnie_adversaire === 'Asiatique' ? 'selected' : ''}>Asiatique</option>
                </select>
            </div>
            <label for="signes_adv_${id}">Signes particuliers:</label>
            <input type="text" id="signes_adv_${id}" name="signes_adv_${id}" class="adv-field" data-field="signes_particuliers" value="${data?.signes_particuliers || ''}" oninput="syncDomToStore()">
            
            <label for="sitfam_adv_${id}">Situation familiale:</label>
            <input type="text" id="sitfam_adv_${id}" name="sitfam_adv_${id}" class="adv-field" data-field="situation_familiale" value="${data?.situation_familiale || ''}" oninput="syncDomToStore()">

            <label for="profession_adv_${id}">Profession:</label>
            <input type="text" id="profession_adv_${id}" name="profession_adv_${id}" class="adv-field" data-field="profession_adversaire" value="${data?.profession_adversaire || ''}" oninput="syncDomToStore()">
            
            <label for="antecedents_adv_${id}">Antécédents:</label>
            <textarea id="antecedents_adv_${id}" name="antecedents_adv_${id}" class="adv-field" data-field="antecedents_adversaire" rows="2" oninput="syncDomToStore()">${data?.antecedents_adversaire || ''}</textarea>
            
            <label>État d'esprit:</label>
            <div id="esprit_${id}" class="chip-container" data-options='["Serein", "Hostile", "Conciliant", "Sur ses gardes"]'></div>
            
            <label for="attitude_adv_${id}">Attitude (connue):</label>
            <textarea id="attitude_adv_${id}" name="attitude_adv_${id}" class="adv-field" data-field="attitude_adversaire" rows="2" oninput="syncDomToStore()">${data?.attitude_adversaire || ''}</textarea>
            
            <label>Volume (renfort potentiel):</label>
            <div id="volume_${id}" class="chip-container" data-options='["Seul", "Famille", "BO", "Conjointe", "2-3", "4+"]'></div>

            <label for="substances_adv_${id}">Substances:</label>
            <input type="text" id="substances_adv_${id}" name="substances_adv_${id}" class="adv-field" data-field="substances_adversaire" value="${data?.substances_adversaire || ''}" oninput="syncDomToStore()">
            
            <label>Véhicules:</label>
            <div id="vehicules_${id}" class="vehicules-container"></div>
            <button type="button" class="add-btn" onclick="addDynamicField('vehicules_${id}')">➕</button>
            
            <label for="armes_adv_${id}">Armes connues:</label>
            <input type="text" id="armes_adv_${id}" name="armes_adv_${id}" class="adv-field" data-field="armes_connues" value="${data?.armes_connues || ''}" oninput="syncDomToStore()">
        </div>
    `;

    container.appendChild(div);

    // Initialisation des composants
    initChipContainer(`esprit_${id}`, data?.etat_esprit_list || []);
    initChipContainer(`volume_${id}`, data?.volume_list || []);

    if (data?.me_list) {
        data.me_list.forEach(val => addMeField(val, `me_${id}`));
    }
    if (data?.vehicules_list) {
        data.vehicules_list.forEach(val => addDynamicField(`vehicules_${id}`, val));
    }

    if (!data) syncDomToStore();
}

function addHypothesis(val = '') {
    const container = document.getElementById('hypotheses_container');
    const id = `hyp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.style.marginBottom = '10px';
    div.innerHTML = `
        <label for="${id}" class="sr-only">Hypothèse</label>
        <input type="text" id="${id}" class="hypothese-input" value="${val.replace(/"/g, '&quot;')}" placeholder="Saisir une hypothèse..." oninput="syncDomToStore()" style="flex-grow: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-body); color: var(--text-primary);">
        <button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore()" style="padding: 0 10px;" title="Supprimer">❌</button>
    `;
    container.appendChild(div);
    syncDomToStore();
}


window.isFormLoading = false;

// Export des fonctions au scope global
window.addDynamicField = addDynamicField;
window.initChipContainer = initChipContainer;
window.getChipData = getChipData;
window.addMeField = addMeField;
window.addTimeEvent = addTimeEvent;
window.updateAdvTitle = updateAdvTitle;
window.addAdversary = addAdversary;
window.addHypothesis = addHypothesis;

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const debouncedSync = debounce(syncDomToStore, 500);
window.syncDomToStore = debouncedSync;
window.syncDomToStoreImmediate = syncDomToStore; // For cases where immediate sync is needed

function syncDomToStore() {
    if (window.isFormLoading) {
        console.log("Sync skipped: Form is loading...");
        return;
    }
    try {
        const data = {};
        document.querySelectorAll('#oi-form input:not([type="file"]), #oi-form textarea, #oi-form select').forEach(field => {
            if (field.id) data[field.id] = field.value;
        });

        data.dynamic_photos = {};
        document.querySelectorAll('.image-preview-container').forEach(container => {
            if (container.id) {
                const imagesMetadata = Array.from(container.querySelectorAll('.image-preview-item')).map(item => {
                    const img = item.querySelector('.image-preview');
                    const titleInput = item.querySelector('.photo-title-input');
                    return {
                        id: img.id,
                        annotations: img.dataset.annotations || '[]',
                        tools: img.dataset.tools || '[]',
                        other_tools: img.dataset.otherTools || '',
                        customTitle: titleInput ? titleInput.value : ''
                    };
                });
                if (imagesMetadata.length > 0) {
                    data.dynamic_photos[container.id] = imagesMetadata;
                }
            }
        });

        // Suppression de la sauvegarde de l'ID d'image de fond

        // Adversaires dynamiques
        data.adversaries = Array.from(document.querySelectorAll('.adversary-entry')).map(entry => {
            const advId = entry.dataset.advId;
            const advData = { id: advId };
            entry.querySelectorAll('.adv-field').forEach(field => {
                advData[field.dataset.field] = field.value;
            });
            advData.me_list = Array.from(entry.querySelectorAll('.me-container .me-input')).map(i => i.value).filter(Boolean);
            advData.etat_esprit_list = getChipData(`esprit_${advId}`);
            advData.volume_list = getChipData(`volume_${advId}`);
            advData.vehicules_list = Array.from(entry.querySelectorAll(`.vehicules-container .dynamic-input`)).map(i => i.value).filter(Boolean);
            return advData;
        });



        // Sauvegarde des données détaillées des membres PATRACDVR (incluant DIR)
        const memberDatasetsToSave = ['trigramme', 'fonction', 'cellule', 'equipement', 'equipement2', 'tenue', 'gpb',
            'principales', 'secondaires', 'afis', 'grenades', 'dir'];

        const unassignedEl = document.getElementById('unassigned_members_container');
        data.patracdvr_unassigned = unassignedEl
            ? Array.from(unassignedEl.querySelectorAll('.patracdvr-member-btn')).map(btn => {
                const memberData = {};
                memberDatasetsToSave.forEach(key => { memberData[key] = btn.dataset[key] || ''; });
                return memberData;
            })
            : [];

        data.patracdvr_rows = Array.from(document.querySelectorAll('#patracdvr_container .patracdvr-vehicle-row')).map(row => ({
            vehicle: row.dataset.vehicleName,
            members: Array.from(row.querySelectorAll('.patracdvr-member-btn')).map(btn => {
                const memberData = {};
                memberDatasetsToSave.forEach(key => { memberData[key] = btn.dataset[key] || ''; });
                return memberData;
            })
        }));

        data.time_events = Array.from(document.querySelectorAll('#time_events_container .time-item')).map(item => ({
            type: item.querySelector('.time-type-select')?.value || '',
            hour: item.querySelector('.time-hour-input')?.value || '',
            description: item.querySelector('.time-description-input')?.value || ''
        }));

        data.hypotheses = Array.from(document.querySelectorAll('#hypotheses_container .hypothese-input')).map(input => input.value);

        // Sauvegarde des blocs MOICP
        data.moicp_blocks = Array.from(document.querySelectorAll('.moicp-block')).map(block => ({
            id: block.dataset.blockId,
            title: block.querySelector('.block-title-input')?.value || '',
            mission: block.querySelector('.moicp-mission')?.value || '',
            objectif: block.querySelector('.moicp-objectif')?.value || '',
            itineraire: block.querySelector('.moicp-itineraire')?.value || '',
            points_particuliers: block.querySelector('.moicp-pp')?.value || '',
            cat: block.querySelector('.moicp-cat')?.value || '',
            place_chef: block.querySelector('.moicp-place-chef')?.value || '',
            members: Array.from(block.querySelectorAll('.articulation-member')).map(m => m.dataset.trigramme)
        }));

        // Sauvegarde des blocs ZMSPCP
        data.zmspcp_blocks = Array.from(document.querySelectorAll('.zmspcp-block')).map(block => ({
            id: block.dataset.blockId,
            title: block.querySelector('.block-title-input')?.value || '',
            zone: block.querySelector('.zmspcp-zone')?.value || '',
            mission: block.querySelector('.zmspcp-mission')?.value || '',
            secteur: block.querySelector('.zmspcp-secteur')?.value || '',
            points_particuliers: block.querySelector('.zmspcp-pp')?.value || '',
            cat: block.querySelector('.zmspcp-cat')?.value || '',
            place_chef: block.querySelector('.zmspcp-place-chef')?.value || '',
            members: Array.from(block.querySelectorAll('.articulation-member')).map(m => m.dataset.trigramme)
        }));

        // Sauvegarde des blocs Cellule Effraction
        data.effraction_blocks = Array.from(document.querySelectorAll('.effraction-block')).map(block => ({
            id: block.dataset.blockId,
            title: block.querySelector('.block-title-input')?.value || '',
            mission: block.querySelector('.effrac-mission')?.value || '',
            porte: block.querySelector('.effrac-porte')?.value || '',
            structure: block.querySelector('.effrac-structure')?.value || '',
            serrurerie: block.querySelector('.effrac-serrurerie')?.value || '',
            environnement: block.querySelector('.effrac-environnement')?.value || '',
            bati_a_bati: block.querySelector('.effrac-bati-bati')?.value || '',
            dormant_a_dormant: block.querySelector('.effrac-dormant-dormant')?.value || '',
            prof_linteaux: block.querySelector('.effrac-prof-linteaux')?.value || '',
            prof_bati: block.querySelector('.effrac-prof-bati')?.value || '',
            h_porte: block.querySelector('.effrac-h-porte')?.value || '',
            h_marche: block.querySelector('.effrac-h-marche')?.value || '',
            prof_marche: block.querySelector('.effrac-prof-marche')?.value || '',
            prof_moulure: block.querySelector('.effrac-prof-moulure')?.value || '',
            members: Array.from(block.querySelectorAll('.articulation-member')).map(m => m.dataset.trigramme),
            hypotheses: Array.from(block.querySelectorAll('.effrac-hypothesis-item')).map(item => ({
                id: item.dataset.hypId,
                title: item.querySelector('.effrac-hyp-title')?.value || '',
                desc: item.querySelector('.effrac-hyp-desc')?.value || '',
                effrac: item.querySelector('.effrac-hyp-effrac')?.value || '',
                degag: item.querySelector('.effrac-hyp-degag')?.value || '',
                assaut: item.querySelector('.effrac-hyp-assaut')?.value || ''
            }))
        }));

        // Sauvegarde des ordres
        data.rame_vl_order = Array.from(document.querySelectorAll('#rame_vl_container .rame-vl-chip')).map(c => c.dataset.vehicleName);
        data.colonne_progression_order = Array.from(document.querySelectorAll('#colonne_progression_container .order-chip')).map(c => c.dataset.trigramme);
        data.ordre_penetration_order = Array.from(document.querySelectorAll('#ordre_penetration_container .order-chip')).map(c => c.dataset.trigramme);

        // Sauvegarde des options de configuration (memberConfig est global dans le bundle)
        if (typeof memberConfig !== 'undefined') data.options = memberConfig;

        // Persister dans Store (le Proxy déclenche notify() -> saveToStorage)
        Store.state.formData = data;

    } catch (e) {
        console.error("Erreur de sauvegarde:", e);
    }
}

async function loadFormData() {
    window.isFormLoading = true;
    try {
        // Suppression de cleanupObjectUrls car nous n'utilisons plus de Blobs pour les vignettes
    // Utilisation de la clé isolée
    const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
    const dataString = localStorage.getItem(key);
    if (!dataString) {
        // Si aucune donnée dans localStorage, on initialise le panneau d'édition rapide 
        // avec les valeurs par défaut JS, et on retourne false
        initializePatracdvr({});
        setupQuickEditPanel();
        return false;
    }

    const data = JSON.parse(dataString);

        // Chargement des options de configuration
        if (data.options) {
            Object.assign(memberConfig, data.options);
        }

        // Nettoyer l'UI
        document.querySelectorAll('.image-preview-container, .photo-display-area').forEach(c => c.innerHTML = '');

        // Charger les métadonnées de base
        Object.keys(data).forEach(key => {
            const excludedKeys = [
                'dynamic_photos', 'patracdvr_rows', 'patracdvr_unassigned',
                'time_events', 'adversaries', 'pdf_background_id',
                'moicp_blocks', 'zmspcp_blocks', 'effraction_blocks', 'options',
                'rame_vl_order', 'colonne_progression_order', 'ordre_penetration_order'
            ];
            if (excludedKeys.includes(key)) return;
            const el = document.getElementById(key);
            if (el) el.value = data[key];
        });

        // --- 1. Création des conteneurs dynamiques (Adversaires, Temps, etc.) ---
        const adversariesContainer = document.getElementById('adversaries_container');
        if (adversariesContainer) {
            adversariesContainer.innerHTML = '';
            if (data.adversaries && data.adversaries.length > 0) {
                data.adversaries.forEach(adv => addAdversary(adv));
            } else if (data.nom_adversaire) {
                // Migration depuis l'ancien format statique si présent
                const migrateAdv = (suffix = '') => ({
                    nom_adversaire: data[`nom_adversaire${suffix}`],
                    domicile_adversaire: data[`domicile_adversaire${suffix}`],
                    date_naissance: data[`date_naissance${suffix}`],
                    lieu_naissance: data[`lieu_naissance${suffix}`],
                    stature_adversaire: data[`stature_adversaire${suffix}`],
                    ethnie_adversaire: data[`ethnie_adversaire${suffix}`],
                    signes_particuliers: data[`signes_particuliers${suffix}`],
                    profession_adversaire: data[`profession_adversaire${suffix}`],
                    antecedents_adversaire: data[`antecedents_adversaire${suffix}`],
                    attitude_adversaire: data[`attitude_adversaire${suffix}`],
                    substances_adversaire: data[`substances_adversaire${suffix}`],
                    armes_connues: data[`armes_connues${suffix}`],
                    me_list: data[`me_list${suffix === '_2' ? '_2' : ''}`],
                    etat_esprit_list: data[`etat_esprit_list${suffix === '_2' ? '_2' : ''}`],
                    volume_list: data[`volume_list${suffix === '_2' ? '_2' : ''}`],
                    vehicules_list: data[`vehicules_list${suffix === '_2' ? '_2' : ''}`]
                });
                addAdversary(migrateAdv());
                if (data.nom_adversaire_2) addAdversary(migrateAdv('_2'));
            }
        }

        document.getElementById('time_events_container').innerHTML = '';
        (data.time_events || []).forEach(ev => addTimeEvent(ev.type, ev.hour, ev.description));

        const hypothesesContainer = document.getElementById('hypotheses_container');
        if (hypothesesContainer) {
            hypothesesContainer.innerHTML = '';
            if (data.hypotheses && data.hypotheses.length > 0) {
                data.hypotheses.forEach(h => addHypothesis(h));
            } else if (data.hypothese_h1 || data.hypothese_h2 || data.hypothese_h3) {
                // Migration from old static H1, H2, H3
                if (data.hypothese_h1) addHypothesis(data.hypothese_h1);
                if (data.hypothese_h2) addHypothesis(data.hypothese_h2);
                if (data.hypothese_h3) addHypothesis(data.hypothese_h3);
            }
        }


        // --- 2. Initialisations diverses ---
        initializePatracdvr(data);
        setupQuickEditPanel();

        // --- 2b. Restauration articulaton MOICP / ZMSPCP ---
        const moicpContainer = document.getElementById('moicp_container');
        if (moicpContainer) moicpContainer.innerHTML = '';
        const zmspcpContainer = document.getElementById('zmspcp_container');
        if (zmspcpContainer) zmspcpContainer.innerHTML = '';
        const effracContainer = document.getElementById('effraction_container');
        if (effracContainer) effracContainer.innerHTML = '';

        if (data.moicp_blocks && data.moicp_blocks.length > 0) {
            data.moicp_blocks.forEach(blockData => addMoicp(blockData));
        }
        if (data.zmspcp_blocks && data.zmspcp_blocks.length > 0) {
            data.zmspcp_blocks.forEach(blockData => addZmspcp(blockData));
        }
        if (data.effraction_blocks && data.effraction_blocks.length > 0) {
            data.effraction_blocks.forEach(blockData => addEffraction(blockData));
        }

        // Rafraîchir les ordres (Rame VL, Colonne, Pénétration)
        refreshRameVL(data.rame_vl_order || null);
        refreshColonneProgression(data.colonne_progression_order || null);
        refreshOrdrePenetration(data.ordre_penetration_order || null);

        await updateCustomBgPreview();

        // --- 3. Restauration des photos (après que les conteneurs existent) ---
        if (data.dynamic_photos) {
            for (const previewId in data.dynamic_photos) {
                const previewContainer = document.getElementById(previewId);
                const fileDataArray = data.dynamic_photos[previewId];

                if (previewContainer && fileDataArray) {
                    for (const imgData of fileDataArray) {
                        const imageBlob = await dbManager.getItem(imgData.id);
                        if (imageBlob) {
                            // On convertit en Base64 pour éviter les erreurs "local resource" en file://
                            const base64Data = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result);
                                reader.onerror = reject;
                                reader.readAsDataURL(imageBlob);
                            });

                            let previewUrl = base64Data;
                            Store.state.annotations = JSON.parse(imgData.annotations || '[]');
                            if (Store.state.annotations.length > 0) {
                                try {
                                    const annotatedBlob = await createAnnotatedImageBlob(imageBlob, Store.state.annotations);
                                    previewUrl = await new Promise((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => resolve(reader.result);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(annotatedBlob);
                                    });
                                } catch (e) {
                                    console.error("Erreur génération preview annotée", e);
                                }
                            }

                            const interactiveItem = document.createElement('div');
                            interactiveItem.className = 'image-preview-item draggable';
                            interactiveItem.draggable = true;
                            interactiveItem.id = imgData.id + "_item";

                            const isEffrac = previewId.includes('effrac');

                            interactiveItem.innerHTML = `
                                        <img id="${imgData.id}" class="image-preview" src="${previewUrl}" style="display:block;" 
                                            data-annotations='${(imgData.annotations || "[]").replace(/'/g, "&apos;")}' 
                                            data-tools='${(imgData.tools || "[]").replace(/'/g, "&apos;")}' 
                                            data-other-tools='${(imgData.other_tools || "").replace(/'/g, "&apos;")}'
                                        >
                                        <input type="text" class="photo-title-input" placeholder="Légende de la photo..." 
                                            value="${(imgData.customTitle || "").replace(/"/g, "&quot;")}"
                                            style="width: 100%; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 4px; padding: 2px 5px; font-size: 0.8em;" 
                                            oninput="syncDomToStore()">
                                        <div style="display: flex; gap: 5px; margin-top: 5px;">
                                            <button type="button" class="add-btn" style="background-color: var(--accent-blue); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openAnnotationModal('${imgData.id}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">edit</span></button>
                                            ${isEffrac ? `<button type="button" class="add-btn" style="background-color: var(--effraction-gold); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openEffractionToolsModal('${imgData.id}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">hardware</span></button>` : ''}
                                            <button type="button" class="remove-btn" style="padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="removeImage('${imgData.id}', this.closest('.image-preview-item'))">&times;</button>
                                        </div>`;
                            previewContainer.appendChild(interactiveItem);
                        }
                    }
                }
            }
        }
        return true;

    } catch (e) {
        console.error("Erreur de chargement:", e);
        if (typeof initializePatracdvr === 'function') initializePatracdvr({});
        if (typeof setupQuickEditPanel === 'function') setupQuickEditPanel();
        return false;
    } finally {
        window.isFormLoading = false;
        // Final sync once everything is in DOM
        if (typeof updateArticulationDisplay === 'function') updateArticulationDisplay();
        if (typeof syncAllThumbnails === 'function') syncAllThumbnails();
        syncDomToStore();
    }
}

function checkCoherence() {
    // Utilisation de la clé isolée
    const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
    const dataString = localStorage.getItem(key);
    Store.state.formData = JSON.parse(dataString || '{}');
    const getVal = (id) => Store.state.formData[id] || '';
    const alerts = [];
    const members = (Store.state.formData.patracdvr_rows || []).flatMap(row => row.members);
    const indiaMembers = members.filter(m => m.cellule && m.cellule.toLowerCase().startsWith('india'));
    const aoMembers = members.filter(m => m.cellule && m.cellule.toLowerCase().startsWith('ao'));
    const allAssignedMembers = [...indiaMembers, ...aoMembers];

    if (!getVal('date_op')) { alerts.push("La Date de l'opération est manquante. <span class='material-symbols-outlined'>event</span>"); }

    if (!Store.state.formData.adversaries || Store.state.formData.adversaries.length === 0) {
        alerts.push("Aucun adversaire n'a été créé. (Onglet 2) <span class='material-symbols-outlined'>person</span>");
    } else {
        Store.state.formData.adversaries.forEach((adv, index) => {
            if (!adv.nom_adversaire) alerts.push(`Le Nom de l'adversaire n°${index + 1} est manquant. <span class='material-symbols-outlined'>person</span>`);
            if (!adv.domicile_adversaire) alerts.push(`Le Domicile de l'adversaire "${adv.nom_adversaire || index + 1}" est manquant. <span class='material-symbols-outlined'>home</span>`);
        });
    }

    allAssignedMembers.forEach(member => {
        const hasNoPrimary = member.principales === 'Sans' || !member.principales;
        const hasNoSecondary = member.secondaires === 'Sans' || !member.secondaires;

        if (hasNoPrimary && hasNoSecondary && member.fonction !== 'Sans') {
            alerts.push(`Membre ${member.trigramme} est assigné mais n'a AUCUN armement principal/secondaire. (Cellule: ${member.cellule}) <span class='material-symbols-outlined'>local_fire_department</span>`);
        }
        if (member.afis !== 'Sans' && !member.afis) {
            alerts.push(`Membre ${member.trigramme} a un AFI non spécifié. <span class='material-symbols-outlined'>handgun</span>`);
        }
    });

    const chefInter = allAssignedMembers.find(m => m.fonction && m.fonction.includes('Chef inter'));
    if (chefInter && !chefInter.cellule.toLowerCase().startsWith('india')) {
        alerts.push(`Le Chef inter (${chefInter.trigramme}) est assigné à la cellule ${chefInter.cellule} au lieu d'India. <span class='material-symbols-outlined'>group</span>`);
    }

    if (!Store.state.formData.time_events || Store.state.formData.time_events.length < 3) {
        alerts.push(`La Chronologie (T0, T1, T4...) est incomplète. Au moins 3 étapes sont recommandées. (Onglet 5) <span class='material-symbols-outlined'>timeline</span>`);
    } else {
        const t4 = Store.state.formData.time_events.find(e => e.type === 'T4');
        if (!t4) alerts.push("Le TOP ACTION (T4) n'est pas défini dans la chronologie. <span class='material-symbols-outlined'>timer</span>");
    }

    const unassignedCount = (Store.state.formData.patracdvr_unassigned || []).length;
    if (unassignedCount > 0) {
        alerts.push(`${unassignedCount} membres ne sont PAS assignés à un véhicule/équipe. <span class='material-symbols-outlined'>groups_2</span>`);
    }

    const coherenceAlertsContainer = document.getElementById('coherence_alerts_container');
    if (coherenceAlertsContainer) {
        coherenceAlertsContainer.innerHTML = '';
        if (alerts.length > 0) {
            alerts.forEach(alertText => {
                const alertDiv = document.createElement('div');
                alertDiv.className = 'coherence-alert';
                alertDiv.innerHTML = `<span class="material-symbols-outlined">error</span> ${alertText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}`;
                coherenceAlertsContainer.appendChild(alertDiv);
            });
        } else {
            coherenceAlertsContainer.innerHTML = `<div class="coherence-alert" style="background-color: var(--success-green); color: #000000;"><span class="material-symbols-outlined">check_circle</span> Aucune incohérence majeure détectée. Prêt à générer.</div>`;
        }
    }

    const recapFinalisation = document.getElementById('recap_finalisation');
    if (recapFinalisation) {
        let recapHtml = '<h4>Synthèse des Éléments Clés :</h4><ul>';
        recapHtml += `<li>Opération du ${getVal('date_op') || 'N/A'} - H: ${getVal('heure_execution') || 'N/A'}</li>`;
        if (Store.state.formData.adversaries) {
            Store.state.formData.adversaries.forEach((adv, i) => {
                recapHtml += `<li>Objectif ${i + 1} : ${adv.nom_adversaire || 'Sans Nom'}</li>`;
            });
        }
        recapHtml += `<li>Équipe INDIA : ${indiaMembers.map(m => m.trigramme).join(', ') || 'N/A'}</li>`;
        recapHtml += `<li>Équipe AO : ${aoMembers.map(m => m.trigramme).join(', ') || 'N/A'}</li>`;
        recapHtml += `<li>Hypothèses : ${(Store.state.formData.hypotheses || []).slice(0, 1).join(', ').substring(0, 30) || 'N/A'}</li>`;
        recapHtml += '</ul>';
        recapFinalisation.innerHTML = recapHtml;
    }

    return alerts.length === 0;
}


// --- GLOBAL EXPOSURE ---
window.addDynamicField = addDynamicField;
window.initChipContainer = initChipContainer;
window.getChipData = getChipData;
window.addMeField = addMeField;
window.addTimeEvent = addTimeEvent;
window.updateAdvTitle = updateAdvTitle;
window.removeAdversary = removeAdversary;
window.addAdversary = addAdversary;
window.addHypothesis = addHypothesis;
window.syncDomToStore = syncDomToStore;
window.saveToStorage = syncDomToStore;
window.saveFormData = syncDomToStore;
window.loadFormData = loadFormData;
window.checkCoherence = checkCoherence;

// --- SESSION MANAGEMENT & RESET FUNCTIONS ---

/**
 * Exporte la session actuelle dans un fichier JSON.
 */
window.exportSession = function () {
    syncDomToStore();
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (data) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `OI_Session_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else {
        alert("Aucune donnée à exporter.");
    }
};

/**
 * Importe une session depuis un fichier JSON.
 */
window.importSession = function (file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = event.target.result;
            const data = JSON.parse(json); // Validation JSON

            // On s'assure que c'est bien un objet de données tactiques
            if (typeof data !== 'object' || Array.isArray(data)) {
                throw new Error("Format de données invalide");
            }

            const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
            localStorage.setItem(key, json);
            alert("Session importée avec succès. Rechargement du formulaire...");

            // Le rechargement est la méthode la plus sûre pour reconstruire tout le DOM
            // proprement à partir du nouvel état localStorage.
            location.reload();
        } catch (err) {
            alert("Erreur: Fichier de session invalide.");
            console.error(err);
        }
    };
    reader.readAsText(file);
};

/**
 * Réinitialise tous les champs de la page active.
 */
/**
 * Réinitialise tous les champs de la page active.
 */
window.resetActivePage = async function () {
    const activeStep = document.querySelector('.wizard-step.active');
    if (!activeStep) return;

    // Protection PATRACDVR
    if (activeStep.querySelector('#patracdvr_container')) {
        toast("Le PATRACDVR ne peut être réinitialisé que via son bouton dédié.", "warning");
        return;
    }

    if (!confirm("Réinitialiser uniquement les champs de la page active ?")) return;

    // 1. Vider les champs standards
    activeStep.querySelectorAll('input:not([type="file"]), textarea, select').forEach(el => {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
        else el.value = '';
    });

    // 2. Supprimer les éléments dynamiques
    activeStep.querySelectorAll('.dynamic-list-item, .adversary-entry, .moicp-block, .zmspcp-block, .effraction-block, .time-item, .order-chip').forEach(el => el.remove());

    // 3. Désélectionner les puces (chips)
    activeStep.querySelectorAll('.chip-btn.selected').forEach(el => el.classList.remove('selected'));

    // 4. Supprimer les photos de la zone ET de l'IndexedDB
    const images = activeStep.querySelectorAll('.image-preview-item img');
    for (const img of images) {
        if (window.dbManager) await window.dbManager.deleteItem(img.id);
        img.closest('.image-preview-item').remove();
    }

    // Sauvegarde de l'état vidé
    syncDomToStore();
    toast("Page réinitialisée", "success");
};

/**
 * Réinitialise l'intégralité du formulaire (Garde le PATRACDVR par défaut).
 */
window.resetAllData = async function (keepPatrac = true) {
    const msg = keepPatrac
        ? "Réinitialisation complète : Effacer toutes les données et photos (SAUF la configuration PATRAC) ?"
        : "Réinitialisation TOTALE : Effacer TOUTES les données, y compris le personnel ?";

    if (!confirm(msg)) return;

    let patracBackup = null;
    if (keepPatrac && Store.state.formData) {
        patracBackup = {
            patracdvr_rows: Store.state.formData.patracdvr_rows || [],
            patracdvr_unassigned: Store.state.formData.patracdvr_unassigned || [],
            options: Store.state.formData.options || {}
        };
    }

    // Clear everything
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    if (window.dbManager) await window.dbManager.clearAllImages();

    if (patracBackup) {
        Store.state.formData = patracBackup;
        Store.saveToStorage();
        toast("Application réinitialisée (Personnel conservé)", "success");
        setTimeout(() => location.reload(), 1000);
    } else {
        toast("Application réinitialisée à zéro", "success");
        setTimeout(() => location.reload(), 1000);
    }
};
