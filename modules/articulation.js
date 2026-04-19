// ==================== Articulation.js ====================


// ============================================================
// Module: articulation.js
// Gestion dynamique des blocs MOICP, ZMSPCP,
// Ordre de la rame VL, Colonne de progression, Pénétration
// ============================================================

/**
 * Crée un bloc MOICP dynamique.
 * Auto-peuplé avec les membres India du PATRACDVR.
 * @param {Object} data - Données de restauration (optionnel)
 */
// Export des fonctions au scope global
window.addMoicp = addMoicp;
window.addZmspcp = addZmspcp;
window.addEffraction = addEffraction;
window.refreshRameVL = refreshRameVL;
window.refreshColonneProgression = refreshColonneProgression;
window.refreshOrdrePenetration = refreshOrdrePenetration;
window.refreshArticulationFromPatracdvr = refreshArticulationFromPatracdvr;

function addMoicp(data) {
    const container = document.getElementById('moicp_container');
    const blockId = data?.id || `moicp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.moicp-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block moicp-block collapsible-container ${stateClass}`;
    div.dataset.blockId = blockId;

    const defaultCat = data?.cat || DEFAULTS.cat.moicp;
    const defaultMission = data?.mission || DEFAULTS.missions.moicp;

    div.innerHTML = `
        <div class="collapsible-header" style="background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); border-left: 4px solid var(--accent-blue); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">shield</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Inter ' + blockIndex}" 
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;" 
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); this.closest('.moicp-block').remove(); syncDomToStore();" 
                    style="background: rgba(59, 130, 246, 0.15); border: none; color: var(--accent-blue); border-radius: 50%; width: 30px; height: 30px; cursor: pointer;" title="Supprimer ce MOICP">❌</button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <label>Mission (M):</label>
            <textarea class="moicp-mission" rows="3" oninput="syncDomToStore()">${defaultMission}</textarea>
            
            <label>Objectif (O):</label>
            <input type="text" class="moicp-objectif" value="${data?.objectif || ''}" oninput="syncDomToStore()">
            
            <label>Itinéraire (I):</label>
            <textarea class="moicp-itineraire" rows="3" oninput="syncDomToStore()">${data?.itineraire || ''}</textarea>
            
            <label>Points Particuliers (P):</label>
            <textarea class="moicp-pp" rows="3" oninput="syncDomToStore()">${data?.points_particuliers || ''}</textarea>
            
            <label>Conduite à Tenir (C):</label>
            <textarea class="moicp-cat" rows="5" oninput="syncDomToStore()">${defaultCat}</textarea>

            <label>Place du Chef (India):</label>
            <input type="text" class="moicp-place-chef" value="${data?.place_chef || ''}" oninput="syncDomToStore()">

            <h4 style="margin-top: 15px; color: var(--accent-blue);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition (ordre d'engagement)
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span> 
                Glissez pour réordonner. Cliquez ❌ pour retirer un membre de ce bloc.
            </p>
            <div class="articulation-members-zone moicp-members" 
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
            </div>

            <!-- Photos Itinéraire -->
            <h4 style="margin-top: 15px; color: var(--accent-blue);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">route</span> Photos Itinéraire
            </h4>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                <button type="button" class="add-btn" style="flex:1; justify-content: center; min-height: 44px;" onclick="document.getElementById('input_itin_ext_${blockId}').click()">📷 Extérieur</button>
                <input type="file" id="input_itin_ext_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_itin_ext_${blockId}', false)">
                
                <button type="button" class="add-btn" style="flex:1; justify-content: center; min-height: 44px;" onclick="document.getElementById('input_itin_int_${blockId}').click()">📷 Intérieur</button>
                <input type="file" id="input_itin_int_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_itin_int_${blockId}', false)">
            </div>
            <div id="photo_itin_ext_${blockId}" class="image-preview-container photo-display-area" style="margin-bottom:10px;"></div>
            <div id="photo_itin_int_${blockId}" class="image-preview-container photo-display-area"></div>
        </div>
    `;

    container.appendChild(div);

    // Peupler avec les membres
    const membersZone = div.querySelector('.moicp-members');
    _setupArticulationDropZone(membersZone);

    if (data?.members && data.members.length > 0) {
        // Restauration depuis sauvegarde
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'moicp');
        });
    } else {
        // Auto-peuplement depuis les India du PATRACDVR
        _autoPopulateFromCellule(membersZone, 'india', 'moicp');
    }

    if (!data) syncDomToStore();
}

/**
 * Crée un bloc ZMSPCP dynamique.
 * Auto-peuplé avec les membres AO du PATRACDVR.
 * @param {Object} data - Données de restauration (optionnel)
 */
function addZmspcp(data) {
    const container = document.getElementById('zmspcp_container');
    const blockId = data?.id || `zmspcp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.zmspcp-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block zmspcp-block collapsible-container ${stateClass}`;
    div.dataset.blockId = blockId;

    const defaultCat = data?.cat || DEFAULTS.cat.zmspcp;
    const defaultMission = data?.mission || DEFAULTS.missions.zmspcp;

    div.innerHTML = `
        <div class="collapsible-header" style="background: rgba(142, 68, 173, 0.1); color: var(--moicp-zmspcp-purple, #8e44ad); border-left: 4px solid var(--moicp-zmspcp-purple, #8e44ad); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">visibility</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Appui Observation ' + blockIndex}" 
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(142, 68, 173, 0.3); color: var(--moicp-zmspcp-purple, #8e44ad); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;" 
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); this.closest('.zmspcp-block').remove(); syncDomToStore();" 
                    style="background: rgba(142, 68, 173, 0.15); border: none; color: var(--moicp-zmspcp-purple, #8e44ad); border-radius: 50%; width: 30px; height: 30px; cursor: pointer;" title="Supprimer ce ZMSPCP">❌</button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <label>Zone d'installation (Z):</label>
            <textarea class="zmspcp-zone" rows="3" oninput="syncDomToStore()">${data?.zone || ''}</textarea>
            
            <label>Mission (M):</label>
            <textarea class="zmspcp-mission" rows="3" oninput="syncDomToStore()">${defaultMission}</textarea>
            
            <label>Secteur de surveillance (S):</label>
            <textarea class="zmspcp-secteur" rows="3" oninput="syncDomToStore()">${data?.secteur || ''}</textarea>
            
            <label>Points Particuliers (P):</label>
            <textarea class="zmspcp-pp" rows="3" oninput="syncDomToStore()">${data?.points_particuliers || ''}</textarea>
            
            <label>Conduite à Tenir (C):</label>
            <textarea class="zmspcp-cat" rows="5" oninput="syncDomToStore()">${defaultCat}</textarea>

            <label>Place du Chef (P):</label>
            <input type="text" class="zmspcp-place-chef" value="${data?.place_chef || ''}" oninput="syncDomToStore()">

            <h4 style="margin-top: 15px; color: var(--moicp-zmspcp-purple, #8e44ad);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition (ordre d'engagement)
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span>
                Glissez pour réordonner. Cliquez ❌ pour retirer un membre de ce bloc.
            </p>
            <div class="articulation-members-zone zmspcp-members" 
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
            </div>

            <!-- Photos Terrain -->
            <h4 style="margin-top: 15px; color: var(--moicp-zmspcp-purple, #8e44ad);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">terrain</span> Photos Terrain / AO
            </h4>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                <button type="button" class="add-btn" style="flex:1; justify-content: center;" onclick="document.getElementById('input_bapteme_${blockId}').click()">📷 Baptême Terrain</button>
                <input type="file" id="input_bapteme_${blockId}" hidden accept="image/*" multiple onchange="handleFileChange(this, 'photo_bapteme_${blockId}', false)">
                
                <button type="button" class="add-btn" style="flex:1; justify-content: center;" onclick="document.getElementById('input_empl_ao_${blockId}').click()">📷 Emplacement AO</button>
                <input type="file" id="input_empl_ao_${blockId}" hidden accept="image/*" multiple onchange="handleFileChange(this, 'photo_empl_ao_${blockId}', false)">
            </div>
            <div id="photo_bapteme_${blockId}" class="image-preview-container photo-display-area" style="margin-bottom:10px;"></div>
            <div id="photo_empl_ao_${blockId}" class="image-preview-container photo-display-area"></div>
        </div>
    `;

    container.appendChild(div);

    const membersZone = div.querySelector('.zmspcp-members');
    _setupArticulationDropZone(membersZone);

    if (data?.members && data.members.length > 0) {
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'zmspcp');
        });
    } else {
        _autoPopulateFromCellule(membersZone, 'ao', 'zmspcp');
    }

    if (!data) syncDomToStore();
}

// ============================================================
// Fonctions internes pour les blocs MOICP/ZMSPCP
// ============================================================

/**
 * Auto-peuple une zone de membres depuis les cellules PATRACDVR.
 * @param {HTMLElement} zone - La drop zone
 * @param {string} cellulePrefix - 'india' ou 'ao'
 * @param {string} type - 'moicp' ou 'zmspcp'
 */
function _autoPopulateFromCellule(zone, cellulePrefix, type) {
    if (!zone || !Store.state.formData.patracdvr_rows) return;
    zone.innerHTML = '';
    
    const allMembers = [];
    // Récupérer depuis les lignes (véhicules)
    Store.state.formData.patracdvr_rows.forEach(row => {
        row.members.forEach(m => allMembers.push(m));
    });
    // Récupérer depuis les non-assignés
    if (Store.state.formData.patracdvr_unassigned) {
        Store.state.formData.patracdvr_unassigned.forEach(m => allMembers.push(m));
    }

    const sorted = allMembers
        .filter(m => {
            const cellule = (m.cellule || '').toLowerCase();
            return cellule.startsWith(cellulePrefix) && cellule !== 'sans';
        })
        .sort((a, b) => (a.cellule || '').localeCompare(b.cellule || '', undefined, { numeric: true, sensitivity: 'base' }));

    sorted.forEach(m => {
        _addArticulationMemberChip(zone, m.trigramme, type);
    });
}

function _autoPopulateEffraction(zone) {
    if (!zone || !Store.state.formData.patracdvr_rows) return;
    zone.innerHTML = '';
    
    const allMembers = [];
    Store.state.formData.patracdvr_rows.forEach(row => {
        row.members.forEach(m => allMembers.push(m));
    });
    if (Store.state.formData.patracdvr_unassigned) {
        Store.state.formData.patracdvr_unassigned.forEach(m => allMembers.push(m));
    }

    const sorted = allMembers
        .filter(m => {
            const cellule = (m.cellule || '').toLowerCase();
            const fonction = (m.fonction || '').toLowerCase();
            return (cellule.includes('effrac') || fonction.includes('effrac')) && cellule !== 'sans';
        })
        .sort((a, b) => (a.cellule || '').localeCompare(b.cellule || '', undefined, { numeric: true, sensitivity: 'base' }));

    sorted.forEach(m => {
        _addArticulationMemberChip(zone, m.trigramme, 'effraction');
    });
}

/**
 * Ajoute un chip de membre dans une zone d'articulation.
 */
function _addArticulationMemberChip(zone, trigramme, type) {
    if (!trigramme || trigramme === 'N/A') return;

    const chip = document.createElement('div');
    chip.className = `articulation-member ${type}-member`;
    chip.dataset.trigramme = trigramme;
    chip.draggable = true;

    // Récupérer infos depuis le PATRACDVR
    const patracdvrBtn = document.querySelector(`.patracdvr-member-btn[data-trigramme="${trigramme}"]`);
    const cellule = patracdvrBtn ? (patracdvrBtn.dataset.cellule || '') : '';
    const fonction = patracdvrBtn ? (patracdvrBtn.dataset.fonction || '') : '';

    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    const funcDisplay = fonction !== 'Sans' ? fonction : '';
    const subtitle = [cellDisplay, funcDisplay].filter(Boolean).join(' / ');

    chip.innerHTML = `
        <span class="art-member-trigramme">${trigramme}</span>
        ${subtitle ? `<span class="art-member-detail">${subtitle}</span>` : ''}
        <button type="button" class="art-member-remove" onclick="this.parentElement.remove(); syncDomToStore();" title="Retirer">×</button>
    `;

    // Drag events pour réordonner
    chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', trigramme);
        e.dataTransfer.effectAllowed = 'move';
        chip.classList.add('dragging');
        setTimeout(() => chip.style.opacity = '0.4', 0);
    });
    chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        chip.style.opacity = '1';
        syncDomToStore();
    });

    zone.appendChild(chip);
}

/**
 * Configure une zone de drop pour les membres d'articulation.
 */
function _setupArticulationDropZone(zone) {
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.style.borderColor = 'var(--accent-blue)';
        zone.style.background = 'rgba(91, 155, 213, 0.05)';

        const dragging = zone.querySelector('.articulation-member.dragging');
        if (!dragging) return;

        const siblings = [...zone.querySelectorAll('.articulation-member:not(.dragging)')];
        const afterElement = siblings.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientX - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (afterElement == null) {
            zone.appendChild(dragging);
        } else {
            zone.insertBefore(dragging, afterElement);
        }
    });

    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = 'var(--border-color)';
        zone.style.background = '';
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'var(--border-color)';
        zone.style.background = '';

        // Si c'est un drop inter-bloc (le chip vient d'un autre bloc du même type)
        const trigramme = e.dataTransfer.getData('text/plain');
        const dragging = document.querySelector('.articulation-member.dragging');

        if (dragging && dragging.parentElement !== zone) {
            // Déplacer le chip vers cette zone
            zone.appendChild(dragging);
        }

        syncDomToStore();
    });
}

// ============================================================
// Ordre de la rame VL
// ============================================================

/**
 * Rafraîchit les boutons VL dans les slots de la rame.
 */
function refreshRameVL(savedData) {
    const container = document.getElementById('rame_vl_container');
    if (!container) return;
    container.innerHTML = '';

    // Récupérer tous les VL du PATRACDVR
    const vehicleRows = document.querySelectorAll('#patracdvr_container .patracdvr-vehicle-row');
    const vehicleNames = Array.from(vehicleRows).map(row => row.dataset.vehicleName).filter(Boolean);

    if (vehicleNames.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun VL dans le PATRACDVR.</p>';
        return;
    }

    // Si on a des données sauvegardées, les utiliser pour l'ordre
    let orderedNames = vehicleNames;
    if (savedData && savedData.length > 0) {
        // Combiner saved + nouveaux VL pas encore dans la sauvegarde
        const savedSet = new Set(savedData);
        const extra = vehicleNames.filter(n => !savedSet.has(n));
        orderedNames = savedData.filter(n => vehicleNames.includes(n)).concat(extra);
    }

    orderedNames.forEach((name, index) => {
        const chip = document.createElement('div');
        chip.className = 'rame-vl-chip';
        chip.dataset.vehicleName = name;
        chip.draggable = true;
        chip.innerHTML = `
            <span class="rame-vl-position">${index + 1}</span>
            <span class="rame-vl-name">${name}</span>
        `;

        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', name);
            chip.classList.add('dragging');
            setTimeout(() => chip.style.opacity = '0.4', 0);
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            chip.style.opacity = '1';
            _updateRamePositions();
            syncDomToStore();
        });

        container.appendChild(chip);
    });

    _setupRameDropZone(container);
}

function _setupRameDropZone(container) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector('.rame-vl-chip.dragging');
        if (!dragging) return;

        const siblings = [...container.querySelectorAll('.rame-vl-chip:not(.dragging)')];
        const afterElement = siblings.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });
}

function _updateRamePositions() {
    const chips = document.querySelectorAll('#rame_vl_container .rame-vl-chip');
    chips.forEach((chip, i) => {
        chip.querySelector('.rame-vl-position').textContent = i + 1;
    });
}

// ============================================================
// Ordre de la colonne de progression
// ============================================================

/**
 * Rafraîchit l'ordre de la colonne de progression (membres India).
 */
function refreshColonneProgression(savedOrder) {
    const container = document.getElementById('colonne_progression_container');
    if (!container) return;
    container.innerHTML = '';

    // Récupérer tous les membres India
    const indiaMembers = _getIndiaMembersOrdered();

    if (indiaMembers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun membre India dans le PATRACDVR.</p>';
        return;
    }

    let ordered = indiaMembers.map(m => m.trigramme);
    if (savedOrder && savedOrder.length > 0) {
        const currentSet = new Set(ordered);
        const extra = ordered.filter(t => !savedOrder.includes(t));
        ordered = savedOrder.filter(t => currentSet.has(t)).concat(extra);
    }

    ordered.forEach((trigramme, index) => {
        const memberInfo = indiaMembers.find(m => m.trigramme === trigramme);
        const chip = _createOrderChip(trigramme, memberInfo, index, 'colonne');
        container.appendChild(chip);
    });

    _setupOrderDropZone(container, 'colonne');
}

// ============================================================
// Ordre de pénétration
// ============================================================

/**
 * Rafraîchit l'ordre de pénétration (par défaut = ordre colonne).
 */
function refreshOrdrePenetration(savedOrder) {
    const container = document.getElementById('ordre_penetration_container');
    if (!container) return;
    container.innerHTML = '';

    const indiaMembers = _getIndiaMembersOrdered();

    if (indiaMembers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun membre India dans le PATRACDVR.</p>';
        return;
    }

    let ordered;
    if (savedOrder && savedOrder.length > 0) {
        const currentSet = new Set(indiaMembers.map(m => m.trigramme));
        const extra = indiaMembers.map(m => m.trigramme).filter(t => !savedOrder.includes(t));
        ordered = savedOrder.filter(t => currentSet.has(t)).concat(extra);
    } else {
        // Par défaut = ordre colonne
        const colonneChips = document.querySelectorAll('#colonne_progression_container .order-chip');
        if (colonneChips.length > 0) {
            ordered = Array.from(colonneChips).map(c => c.dataset.trigramme);
        } else {
            ordered = indiaMembers.map(m => m.trigramme);
        }
    }

    ordered.forEach((trigramme, index) => {
        const memberInfo = indiaMembers.find(m => m.trigramme === trigramme);
        const chip = _createOrderChip(trigramme, memberInfo, index, 'penetration');
        container.appendChild(chip);
    });

    _setupOrderDropZone(container, 'penetration');
}

// ============================================================
// Helpers pour les ordres (colonne / pénétration)
// ============================================================

function _getIndiaMembersOrdered() {
    const allMembers = document.querySelectorAll('.patracdvr-member-btn');
    return Array.from(allMembers)
        .filter(btn => {
            const cellule = (btn.dataset.cellule || '').toLowerCase();
            return cellule.startsWith('india') && cellule !== 'sans';
        })
        .sort((a, b) => {
            const cellA = a.dataset.cellule || '';
            const cellB = b.dataset.cellule || '';
            return cellA.localeCompare(cellB, undefined, { numeric: true, sensitivity: 'base' });
        })
        .map(btn => ({
            trigramme: btn.dataset.trigramme,
            cellule: btn.dataset.cellule,
            fonction: btn.dataset.fonction
        }));
}

function _createOrderChip(trigramme, memberInfo, index, type) {
    const chip = document.createElement('div');
    chip.className = `order-chip ${type}-chip`;
    chip.dataset.trigramme = trigramme;
    chip.draggable = true;

    const cellule = memberInfo?.cellule || '';
    const fonction = memberInfo?.fonction || '';
    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    const funcDisplay = fonction !== 'Sans' ? fonction : '';

    chip.innerHTML = `
        <span class="order-position">${index + 1}</span>
        <span class="order-trigramme">${trigramme}</span>
        <span class="order-detail">${[cellDisplay, funcDisplay].filter(Boolean).join(' / ')}</span>
    `;

    chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', trigramme);
        chip.classList.add('dragging');
        setTimeout(() => chip.style.opacity = '0.4', 0);
    });
    chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        chip.style.opacity = '1';
        _updateOrderPositions(chip.parentElement);
        syncDomToStore();
    });

    return chip;
}

function _setupOrderDropZone(container, type) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector(`.${type}-chip.dragging`);
        if (!dragging) return;

        const siblings = [...container.querySelectorAll(`.${type}-chip:not(.dragging)`)];
        const afterElement = siblings.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });
}

function _updateOrderPositions(container) {
    if (!container) return;
    container.querySelectorAll('.order-chip').forEach((chip, i) => {
        chip.querySelector('.order-position').textContent = i + 1;
    });
}

// ============================================================
// Rafraîchissement global depuis PATRACDVR
// ============================================================

/**
 * Appelé après modification du PATRACDVR pour synchroniser
 * les ordres et les compositions.
 */
/**
 * Appelé après modification du PATRACDVR pour synchroniser
 * les ordres et les compositions. Proactif : rafraîchit les 3 listes d'ordres.
 */
function refreshArticulationFromPatracdvr() {
    if (window.isFormLoading) return;
    console.log("Synchronisation Articulation depuis PATRACDVR...");

    // 1. Rame VL
    const currentRame = Array.from(document.querySelectorAll('#rame_vl_container .rame-vl-chip')).map(c => c.dataset.vehicleName);
    refreshRameVL(currentRame.length > 0 ? currentRame : null);

    // 2. Colonne de progression (via Store)
    const currentColonne = Array.from(document.querySelectorAll('#colonne_progression_container .order-chip')).map(c => c.dataset.trigramme);
    refreshColonneProgression(currentColonne.length > 0 ? currentColonne : null);

    // 3. Ordre de pénétration
    const currentPenetration = Array.from(document.querySelectorAll('#ordre_penetration_container .order-chip')).map(c => c.dataset.trigramme);
    refreshOrdrePenetration(currentPenetration.length > 0 ? currentPenetration : null);

    // 4. Mise à jour des compositions dans les blocs MOICP/ZMSPCP
    document.querySelectorAll('.moicp-members').forEach(zone => _autoPopulateFromCellule(zone, 'india', 'moicp'));
    document.querySelectorAll('.zmspcp-members').forEach(zone => _autoPopulateFromCellule(zone, 'ao', 'zmspcp'));
    document.querySelectorAll('.effraction-members').forEach(zone => _autoPopulateEffraction(zone));
}

// --- RÉACTIVITÉ ---
let lastPatracData = "";
Store.subscribe((state) => {
    if (window.isFormLoading) return;
    
    // On ne surveille que les changements structurels du PATRACDVR
    const currentPatracData = JSON.stringify({
        rows: state.formData.patracdvr_rows,
        unassigned: state.formData.patracdvr_unassigned
    });

    if (currentPatracData !== lastPatracData) {
        lastPatracData = currentPatracData;
        console.log("Mise à jour réactive de l'articulation...");
        refreshArticulationFromPatracdvr();
    }
});

// ============================================================
// CELLULE EFFRACTION
// ============================================================

/**
 * Crée un bloc Cellule Effraction dynamique.
 */
function addEffraction(data) {
    const container = document.getElementById('effraction_container');
    const blockId = data?.id || `effrac_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.effraction-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block effraction-block collapsible-container ${stateClass}`;
    div.id = blockId;
    div.dataset.blockId = blockId;

    div.innerHTML = `
        <div class="collapsible-header" style="background: rgba(212, 175, 55, 0.1); color: var(--effraction-gold); border-left: 4px solid var(--effraction-gold); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">hardware</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Effraction ' + blockIndex}" 
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(212, 175, 55, 0.3); color: var(--effraction-gold); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;" 
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); this.closest('.effraction-block').remove(); syncDomToStore();" 
                    style="background: rgba(212, 175, 55, 0.15); border: none; color: var(--effraction-gold); border-radius: 50%; width: 30px; height: 30px; cursor: pointer;" title="Supprimer">❌</button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <h4 style="margin-top: 15px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition cellule EFFRAC
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span> 
                Glissez pour réordonner.
            </p>
            <div class="articulation-members-zone effraction-members" 
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px;">
            </div>

            <label>Mission EFFRAC :</label>
            <textarea class="effrac-mission" rows="4" style="width:100%; margin-bottom: 15px;" oninput="syncDomToStore()" placeholder="...">${data?.mission || DEFAULTS.missions.effraction}</textarea>

            <label>Type de porte :</label>
            <textarea class="effrac-porte" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Description libre...">${data?.porte || ''}</textarea>
            
            <label>Structure & Dormant :</label>
            <textarea class="effrac-structure" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: Isolation par l'exterieur recouvert de crépi...">${data?.structure || ''}</textarea>
            
            <label>Serrurerie :</label>
            <textarea class="effrac-serrurerie" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: PVC, 1 point de fermeture...">${data?.serrurerie || ''}</textarea>

            <label>Environnement immédiat :</label>
            <textarea class="effrac-environnement" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: Petite marche en brique...">${data?.environnement || ''}</textarea>
            
            <div class="effrac-measurements-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px;">
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Bâti à Bâti (cm)</label>
                    <input type="text" class="effrac-bati-bati" value="${data?.bati_a_bati || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Dormant à Dormant (cm)</label>
                    <input type="text" class="effrac-dormant-dormant" value="${data?.dormant_a_dormant || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Profondeur linteaux (cm)</label>
                    <input type="text" class="effrac-prof-linteaux" value="${data?.prof_linteaux || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Profondeur Bâti (cm)</label>
                    <input type="text" class="effrac-prof-bati" value="${data?.prof_bati || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Hauteur de porte (cm)</label>
                    <input type="text" class="effrac-h-porte" value="${data?.h_porte || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Hauteur marche (opt.)</label>
                    <input type="text" class="effrac-h-marche" value="${data?.h_marche || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Prof. marche (opt.)</label>
                    <input type="text" class="effrac-prof-marche" value="${data?.prof_marche || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Prof. moulure (opt.)</label>
                    <input type="text" class="effrac-prof-moulure" value="${data?.prof_moulure || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
            </div>

            <h4 style="margin-top: 25px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">psychology</span> Hypothèses & Déroulement
            </h4>
            <div class="effrac-hypotheses-list" id="effrac_hyp_list_${blockId}"></div>
            <button type="button" class="add-btn" style="width:100%; justify-content: center; margin-bottom: 20px;" onclick="addEffractionHypothesis('${blockId}')">➕ Ajouter Hypothèse</button>

            <h4 style="margin-top: 15px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">add_a_photo</span> Photos Effraction
            </h4>
            <div style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span> 
                Ajoutez des photos et précisez les outils pour chacune.
            </div>
            <button type="button" class="add-btn" style="width:100%; justify-content: center;" onclick="document.getElementById('input_effrac_${blockId}').click()">➕ Ajouter Photo(s)</button>
            <input type="file" id="input_effrac_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_effrac_${blockId}', false)">
            <div id="photo_effrac_${blockId}" class="image-preview-container photo-display-area" style="margin-top:10px;"></div>
        </div>
    `;

    container.appendChild(div);

    const membersZone = div.querySelector('.effraction-members');
    _setupArticulationDropZone(membersZone);

    if (data?.members && data.members.length > 0) {
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'effraction');
        });
    } else {
        _autoPopulateEffraction(membersZone);
    }

    if (data?.hypotheses && data.hypotheses.length > 0) {
        data.hypotheses.forEach(hyp => addEffractionHypothesis(blockId, hyp));
    }

    // Default mission if it hasn't been rehydrated and no data is passed (handled via the textarea default text implicitly, but if data exists it uses data.mission)
    if (data?.mission) {
        div.querySelector('.effrac-mission').value = data.mission;
    }

    if (!data) syncDomToStore();
}

window.addEffractionHypothesis = function (blockId, data = null) {
    const list = document.getElementById(`effrac_hyp_list_${blockId}`);
    if (!list) return;
    const hypId = data?.id || `hyp_effrac_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const div = document.createElement('div');
    div.className = 'effrac-hypothesis-item dynamic-list-item';
    div.dataset.hypId = hypId;
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.style.background = 'var(--bg-container)';
    div.style.padding = '15px';
    div.style.border = '1px solid var(--border-color)';
    div.style.borderRadius = 'var(--radius-md)';
    div.style.marginBottom = '10px';

    div.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 10px;">
            <input type="text" class="effrac-hyp-title" value="${data?.title || 'Hypothèse ' + (list.children.length + 1)}" placeholder="Titre..." style="font-weight: bold; background: transparent; border: none; border-bottom: 1px solid var(--border-color); color: var(--text-primary); font-size: 1.1em; width: 60%;" oninput="syncDomToStore()">
            <button type="button" class="remove-btn" onclick="this.closest('.effrac-hypothesis-item').remove(); syncDomToStore();" style="padding: 5px;">❌</button>
        </div>
        
        <label style="font-size: 0.85em;">Description Initiale:</label>
        <textarea class="effrac-hyp-desc" rows="2" style="width:100%; margin-bottom: 10px;" oninput="syncDomToStore()">${data?.desc || ''}</textarea>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Effraction:</label>
                <textarea class="effrac-hyp-effrac text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.effrac || ''}</textarea>
            </div>
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Dégagement:</label>
                <textarea class="effrac-hyp-degag text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.degag || ''}</textarea>
            </div>
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Assaut:</label>
                <textarea class="effrac-hyp-assaut text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.assaut || ''}</textarea>
            </div>
        </div>
    `;
    list.appendChild(div);
    if (!data) syncDomToStore();
}

/**
 * Logique pour le modal des outils d'effraction
 */
let currentEffractionImgId = null;

function openEffractionToolsModal(imgId) {
    currentEffractionImgId = imgId;
    const img = document.getElementById(imgId);
    if (!img) return;

    const modal = document.getElementById('effractionToolsModal');
    if (!modal) return;

    const tools = JSON.parse(img.dataset.tools || '[]');
    const otherTools = img.dataset.otherTools || '';

    // Reset buttons
    modal.querySelectorAll('.effrac-tool-btn').forEach(btn => {
        btn.classList.toggle('active', tools.includes(btn.dataset.tool));
        btn.onclick = () => btn.classList.toggle('active');
    });

    // Reset other tools input
    const otherToolsInput = document.getElementById('effrac_other_tools');
    if (otherToolsInput) otherToolsInput.value = otherTools;

    document.body.classList.add('modal-open');
    modal.showModal();
}

function saveEffractionTools() {
    if (!currentEffractionImgId) return;
    const img = document.getElementById(currentEffractionImgId);
    if (!img) return;

    const modal = document.getElementById('effractionToolsModal');
    const selectedTools = Array.from(modal.querySelectorAll('.effrac-tool-btn.active')).map(btn => btn.dataset.tool);
    const otherToolsInput = document.getElementById('effrac_other_tools');

    img.dataset.tools = JSON.stringify(selectedTools);
    img.dataset.otherTools = otherToolsInput ? otherToolsInput.value : '';

    modal.close();
    document.body.classList.remove('modal-open');
    syncDomToStore();
}

// --- GLOBAL EXPOSURE ---
window.addMoicp = addMoicp;
window.addZmspcp = addZmspcp;
window.addEffraction = addEffraction;
window.addEffractionHypothesis = addEffractionHypothesis;
window.openEffractionToolsModal = openEffractionToolsModal;
window.saveEffractionTools = saveEffractionTools;
window.refreshArticulationFromPatracdvr = refreshArticulationFromPatracdvr;


