// ==================== Patracdvr.js ====================

// Redundant declarations removed (now in init.js)

// Helper: Get live DOM references to PATRACDVR containers
function getUnassignedContainer() { return document.getElementById('unassigned_members_container'); }
function getPatracdvrContainer() { return document.getElementById('patracdvr_container'); }

// Helper used by FormManager
// getMemberConfig -> memberConfig is global

let modalTempData = {};

function renameVehicle(element) {
    const currentName = element.textContent;
    const newName = prompt("Renommer le véhicule :", currentName);
    if (newName && newName.trim() !== "") {
        element.textContent = newName.trim();
        const row = element.closest('.patracdvr-vehicle-row');
        if (row) {
            row.dataset.vehicleName = newName.trim();
            syncDomToStore();
            updateArticulationDisplay();
        }
    }
}

function addPatracdvrRow(vehicleName, members = []) {
    const container = document.getElementById('patracdvr_container');
    const row = document.createElement('div');
    row.className = 'patracdvr-vehicle-row';
    row.dataset.vehicleName = vehicleName;

    row.innerHTML = `
                <div class="vehicle-header">
                    <span class="vehicle-name" onclick="renameVehicle(this)" title="Cliquer pour renommer">${vehicleName}</span>
                    <button type="button" class="remove-btn" title="Supprimer le véhicule">❌</button>
                </div>
                <div class="patracdvr-members-container"></div>`;

    container.appendChild(row);

    const membersContainer = row.querySelector('.patracdvr-members-container');
    row.querySelector('.remove-btn').addEventListener('click', () => {
        // Utilisation d'un `confirm` natif
        const confirmation = confirm(`Voulez-vous vraiment supprimer le véhicule "${vehicleName}" et désattribuer ses membres ?`);
        if (confirmation) {
            // Désattribution des membres
            membersContainer.querySelectorAll('.patracdvr-member-btn').forEach(memberBtn => {
                memberBtn.dataset.cellule = 'Sans';
                memberBtn.dataset.fonction = 'Sans';
                updateMemberButtonVisuals(memberBtn);
                getUnassignedContainer().appendChild(memberBtn);
            });
            // Suppression de la ligne du véhicule
            row.remove();
            // Réinitialisation du panneau d'édition rapide si le membre actif était dans ce véhicule
            if (activeMemberId) {
                const activeMember = document.getElementById(activeMemberId);
                if (!document.contains(activeMember)) {
                    activeMemberId = null;
                    document.getElementById('quickEditPanel').style.display = 'none';
                }
            }
            syncDomToStore();
            updateArticulationDisplay();
        }
    });

    // Attacher les écouteurs de Drop uniquement au conteneur de membres du véhicule
    membersContainer.addEventListener('dragenter', handleDragEnter);
    membersContainer.addEventListener('dragleave', handleDragLeave);
    membersContainer.addEventListener('dragover', handleDragOver);
    membersContainer.addEventListener('drop', handleDrop);

    members.forEach(memberData => addPatracdvrMember(membersContainer, memberData));
    syncDomToStore();
    updateArticulationDisplay();
}

function addManualVehicle() {
    let vehicleName = prompt("Veuillez saisir le nom du nouveau VL (ex: KODIAQ, SHARAN, VTC...):");
    if (vehicleName) {
        vehicleName = vehicleName.trim();
        if (vehicleName.length > 0) {
            addPatracdvrRow(vehicleName);
        }
    }
}

function addManualMember() {
    let trigramme = prompt("Veuillez saisir le trigramme du nouveau PAX (ex: ABC):");
    if (trigramme) {
        trigramme = trigramme.trim().toUpperCase();
        const existingMember = document.querySelector(`.patracdvr-member-btn[data-trigramme="${trigramme}"]`);
        if (existingMember) {
            alert(`Le membre avec le trigramme "${trigramme}" existe déjà. Veuillez en choisir un autre.`);
            return;
        }

        if (trigramme.length >= 2 && trigramme.length <= 4) {
            const initialData = {
                trigramme: trigramme,
                cellule: 'Sans',
                fonction: 'Sans',
                principales: 'Sans',
                secondaires: 'PSA',
                afis: 'Sans',
                grenades: 'Sans',
                equipement: 'Sans',
                equipement2: 'Sans',
                tenues: 'UBAS',
                gpb: 'GPBL',
                dir: '' // Initialisation DIR
            };
            const newMemberBtn = addPatracdvrMember(getUnassignedContainer(), initialData);

            if (newMemberBtn) {
                handleMemberSelection({ target: newMemberBtn });
            }
            // syncDomToStore(); // Déjà appelé dans addPatracdvrMember
        } else {
            alert("Le trigramme doit contenir entre 2 et 4 caractères.");
        }
    }
}
function addPatracdvrMember(containerElement, data = {}) {
    if (!containerElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'patracdvr-member-btn draggable';
    btn.id = `member_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    btn.setAttribute('draggable', 'true');
    const memberData = {
        trigramme: 'N/A',
        fonction: 'Sans',
        cellule: 'India 1',
        principales: 'Sans',
        secondaires: 'PSA',
        afis: 'Sans',
        grenades: 'Sans',
        equipement: 'Sans',
        equipement2: 'Sans',
        tenue: 'UBAS',
        gpb: 'GPBL',
        dir: '', 
        ...data
    };
    Object.keys(memberData).forEach(key => btn.dataset[key] = memberData[key]);
    updateMemberButtonVisuals(btn);

    btn.addEventListener('click', handleMemberSelection);
    btn.addEventListener('contextmenu', handleMemberContextMenu);

    // --- AJOUT CORRECTIF MOBILE ---
    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchmove', handleTouchMove, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd);
    // ------------------------------

    containerElement.appendChild(btn);

    syncDomToStore();
    updateArticulationDisplay();
    return btn;
}

function handleMemberContextMenu(event) {
    event.preventDefault();
    const btn = event.target.closest('.patracdvr-member-btn');
    if (!btn) return;

    window.contextMemberId = btn.id;
    const menu = document.getElementById('memberContextMenu');
    if (menu) {
        menu.style.display = 'block';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
    }

    // Hide menu on click elsewhere
    const hideMenu = () => {
        if (menu) menu.style.display = 'none';
        document.removeEventListener('click', hideMenu);
    };
    setTimeout(() => document.addEventListener('click', hideMenu), 10);
}

function cloneMemberFromContext() {
    const id = window.contextMemberId;
    if (!id) return;
    const original = document.getElementById(id);
    if (!original) return;

    const data = { ...original.dataset };
    delete data.id; // Let addPatracdvrMember generate a new ID
    
    // Add "Clone" suffix to trigramme if space permits, or just duplicate
    const baseTrigramme = data.trigramme || 'N/A';
    data.trigramme = (baseTrigramme + 'C').slice(0, 4);

    const container = original.parentElement;
    addPatracdvrMember(container, data);
    syncDomToStore();
    updateArticulationDisplay();
}

function deleteMemberFromContext() {
    const id = window.contextMemberId;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;

    if (confirm(`Supprimer définitivement le membre ${el.dataset.trigramme || ''} ?`)) {
        if (activeMemberId === id) {
            activeMemberId = null;
            document.getElementById('quickEditPanel').style.display = 'none';
        }
        el.remove();
        syncDomToStore();
        updateArticulationDisplay();
    }
}

function updateMemberButtonVisuals(btn) {
    const trigramme = btn.dataset.trigramme || 'N/A';
    const fonction = btn.dataset.fonction || '';
    const cellule = btn.dataset.cellule || '';
    const dir = btn.dataset.dir || '';

    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    // NOUVEAU: Affichage DIR
    const dirDisplay = dir ? `<br><span class="dir-info">DIR: ${dir}</span>` : '';

    // Gestion multi-fonctions pour l'affichage (troncature si trop long)
    let functionDisplay = '';
    if (fonction !== 'Sans') {
        const funcs = fonction.split(', ');
        if (funcs.length > 1) {
            functionDisplay = ` / ${funcs[0]} +${funcs.length - 1}`;
        } else {
            functionDisplay = ` / ${fonction}`;
        }
    }

    const separation = (cellDisplay && functionDisplay) ? '' : '';

    btn.innerHTML = `<span class="trigramme">${trigramme}</span><span class="fonction">${cellDisplay}${separation}${functionDisplay}</span>${dirDisplay}`;

    // Si le membre est dans le conteneur "Personnel à attribuer", on masque la fonction/cellule.
    if (btn.closest('#unassigned_members_container')) {
        btn.innerHTML = `<span class="trigramme">${trigramme}</span>`;
    }
}

function updateArticulationDisplay() {
    if (window.isFormLoading) return;
    // Compatibility wrapper — la logique a été déplacée dans articulation.js
    if (typeof refreshArticulationFromPatracdvr === 'function') {
        refreshArticulationFromPatracdvr();
    }
}

function initializePatracdvr(dataFromStorage) {
    getUnassignedContainer().innerHTML = '';
    getPatracdvrContainer().innerHTML = '';
    if (dataFromStorage && (dataFromStorage.patracdvr_rows?.length > 0 || dataFromStorage.patracdvr_unassigned?.length > 0)) {
        (dataFromStorage.patracdvr_unassigned || []).forEach(member => addPatracdvrMember(getUnassignedContainer(), member));
        (dataFromStorage.patracdvr_rows || []).forEach(row => addPatracdvrRow(row.vehicle, row.members));
    }
}

function resetPatracdvrUI() {
    if (confirm("Voulez-vous vraiment réinitialiser tout le personnel et les véhicules du PATRACDVR ?")) {
        initializePatracdvr({});
        if (typeof activeMemberId !== 'undefined') activeMemberId = null;
        const panel = document.getElementById('quickEditPanel');
        if (panel) panel.style.display = 'none';
        
        syncDomToStore();
        updateArticulationDisplay();
        if (typeof toast === 'function') toast("PATRACDVR réinitialisé", "success");
    }
}

function loadConfigObject(config) {
    if (config.options) {
        Object.assign(memberConfig, config.options);
        setupQuickEditPanel();
    }

    if (config.members && Array.isArray(config.members)) {
        getUnassignedContainer().innerHTML = '';
        getPatracdvrContainer().innerHTML = '';
        config.members.forEach(memberData => {
            const defaultData = {
                cellule: memberData.cellule || 'Sans',
                fonction: memberData.fonction || 'Sans',
                principales: memberData.principales || 'Sans',
                secondaires: memberData.secondaires || 'PSA',
                afis: memberData.afis || 'Sans',
                grenades: memberData.grenades || 'Sans',
                equipement: memberData.equipement || 'Sans',
                equipement2: memberData.equipement2 || 'Sans',
                tenue: memberData.tenue || 'UBAS',
                gpb: memberData.gpb || 'GPBL',
                dir: '',
                ...memberData
            };
            addPatracdvrMember(getUnassignedContainer(), defaultData);
        });
    }
    syncDomToStore();
}

function setupQuickEditPanel() {
    const contentContainer = document.querySelector('#quickEditPanel .quick-edit-content');
    if (!contentContainer) return;
    contentContainer.innerHTML = '';

    for (const [title, config] of Object.entries(quickEditMapping)) {

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'quick-edit-category';

        const panelTitle = document.createElement('h5');
        panelTitle.textContent = title;
        categoryDiv.appendChild(panelTitle);

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'quick-edit-options';

        (memberConfig[config.key] || []).forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-edit-btn';
            btn.textContent = option;
            btn.dataset.attribute = config.attribute;
            btn.dataset.value = option;
            optionsContainer.appendChild(btn);
        });

        categoryDiv.appendChild(optionsContainer);
        contentContainer.appendChild(categoryDiv);
    }
}

function handleMemberSelection(event) {
    const clickedButton = event.target.closest('.patracdvr-member-btn');
    if (!clickedButton) return;

    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }

    if (activeMemberId === clickedButton.id) {
        clickedButton.classList.remove('member-active');
        activeMemberId = null;
        document.getElementById('quickEditPanel').style.display = 'none';
        return;
    }

    if (activeMemberId) {
        const oldActive = document.getElementById(activeMemberId);
        if (oldActive) oldActive.classList.remove('member-active');
    }

    activeMemberId = clickedButton.id;
    clickedButton.classList.add('member-active');

    if (window.innerWidth < 768) {
        openQuickEditModal(activeMemberId);
    } else {
        populateQuickEditPanel(activeMemberId);
        document.getElementById('quickEditPanel').style.display = 'flex';
    }
    syncDomToStore();
}

function populateQuickEditPanel(memberId) {
    const member = document.getElementById(memberId);
    if (!member) return;

    const trigrammeDisplay = member.dataset.trigramme || 'N/A';
    document.getElementById('selectedMemberTrigramme').textContent = trigrammeDisplay;
    document.getElementById('quick_edit_trigramme_input').value = trigrammeDisplay;

    document.getElementById('quick_edit_dir_input').value = member.dataset.dir || '';

    document.querySelectorAll('#quickEditPanel .quick-edit-btn').forEach(btn => {
        const attribute = btn.dataset.attribute;
        const value = btn.dataset.value;
        const memberValue = member.dataset[attribute];

        if (multiSelectAttributes.includes(attribute)) {
            const currentValues = memberValue ? memberValue.split(', ') : [];
            btn.classList.toggle('selected', currentValues.includes(value));
        } else {
            btn.classList.toggle('selected', memberValue === value);
        }
    });
}

function openQuickEditModal(memberId) {
    const modal = document.getElementById('quickEditModal');
    const title = document.getElementById('quick_modal_title');
    const content = document.getElementById('quick_modal_content');
    const member = document.getElementById(memberId);

    if (!member) return;

    // Bloquer le scroll du fond
    document.body.classList.add('modal-open');

    // Initialiser les données temporaires à partir du membre
    modalTempData = { ...member.dataset };
    const originalTrigramme = modalTempData.trigramme || 'N/A';
    title.textContent = `Édition: ${originalTrigramme}`;
    content.innerHTML = '';

    // --- 1. Champ Trigramme ---
    const trigrammeDiv = document.createElement('div');
    trigrammeDiv.className = 'quick-edit-category';
    trigrammeDiv.innerHTML = `
        <h5>Trigramme</h5>
        <input type="text" id="modal_quick_edit_trigramme_input" placeholder="ABC" 
               value="${originalTrigramme}" 
               style="padding: 12px; font-size: 1.1em; width:100%; box-sizing:border-box; background: var(--bg-interactive); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;">
    `;
    content.appendChild(trigrammeDiv);

    // --- 2. Champ DIR Radio ---
    const dirDiv = document.createElement('div');
    dirDiv.className = 'quick-edit-category';
    dirDiv.innerHTML = `
        <h5>DIR (Canal Radio)</h5>
        <input type="text" id="modal_quick_edit_dir_input" placeholder="Ex: 42" 
               value="${modalTempData.dir || ''}" 
               style="padding: 12px; font-size: 1.1em; width:100%; box-sizing:border-box; background: var(--bg-interactive); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;">
    `;
    content.appendChild(dirDiv);

    // Écouteurs pour les données temporaires
    setTimeout(() => {
        const tInput = document.getElementById('modal_quick_edit_trigramme_input');
        const dInput = document.getElementById('modal_quick_edit_dir_input');
        
        if (tInput) tInput.addEventListener('input', (e) => {
            modalTempData.trigramme = e.target.value.toUpperCase();
            title.textContent = `Édition: ${modalTempData.trigramme}`;
        });
        if (dInput) dInput.addEventListener('input', (e) => {
            modalTempData.dir = e.target.value;
        });
    }, 10);

    // --- 3. Options d'édition (boutons) ---
    setupQuickEditPanel(); 
    const quickEditPanelContent = document.querySelector('#quickEditPanel .quick-edit-content');
    const contentClone = quickEditPanelContent.cloneNode(true);
    content.appendChild(contentClone);

    // Mettre à jour l'état visuel des boutons clonés et ajouter les écouteurs
    const modalButtons = content.querySelectorAll('.quick-edit-btn');
    modalButtons.forEach(btn => {
        const attr = btn.dataset.attribute;
        const val = btn.dataset.value;
        const currentVal = modalTempData[attr];

        if (multiSelectAttributes.includes(attr)) {
            const vals = currentVal ? currentVal.split(', ') : [];
            btn.classList.toggle('selected', vals.includes(val));
        } else {
            btn.classList.toggle('selected', currentVal === val);
        }

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const attribute = btn.dataset.attribute;
            const value = btn.dataset.value;

            if (multiSelectAttributes.includes(attribute)) {
                let currentValues = modalTempData[attribute] ? modalTempData[attribute].split(', ') : [];
                if (value === 'Sans') {
                    currentValues = ['Sans'];
                } else {
                    if (currentValues.includes('Sans')) currentValues = [];
                    if (currentValues.includes(value)) {
                        currentValues = currentValues.filter(v => v !== value);
                    } else {
                        currentValues.push(value);
                    }
                }
                if (currentValues.length === 0) currentValues = ['Sans'];
                modalTempData[attribute] = currentValues.join(', ');
                
                btn.classList.toggle('selected', currentValues.includes(value));
                const group = btn.parentElement;
                if (value !== 'Sans') {
                    const sansBtn = Array.from(group.children).find(b => b.dataset.value === 'Sans');
                    if (sansBtn) sansBtn.classList.remove('selected');
                } else {
                    Array.from(group.children).forEach(b => { if (b !== btn) b.classList.remove('selected'); });
                }
            } else {
                modalTempData[attribute] = value;
                const group = btn.parentElement;
                group.querySelectorAll('.quick-edit-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            }
        });
    });

    modal.showModal();
}

function saveQuickEditModalChanges() {
    const member = document.getElementById(activeMemberId);
    if (!member) return;

    Object.keys(modalTempData).forEach(key => {
        member.dataset[key] = modalTempData[key];
    });

    updateMemberButtonVisuals(member);
    closeQuickEditModal();

    syncDomToStore();
    updateArticulationDisplay();
}

function closeQuickEditModal() {
    const modal = document.getElementById('quickEditModal');
    if (modal) modal.close();
    document.body.classList.remove('modal-open');
    if (activeMemberId) {
        const oldActive = document.getElementById(activeMemberId);
        if (oldActive) oldActive.classList.remove('member-active');
        activeMemberId = null;
    }
}

function saveQuickEditChanges() {
    const member = document.getElementById(activeMemberId);
    if (!member) return;

    const newTrigramme = document.getElementById('quick_edit_trigramme_input').value.toUpperCase();
    member.dataset.trigramme = newTrigramme;
    document.getElementById('selectedMemberTrigramme').textContent = newTrigramme;

    member.dataset.dir = document.getElementById('quick_edit_dir_input').value;

    updateMemberButtonVisuals(member);
    syncDomToStore();
    updateArticulationDisplay();
    populateQuickEditPanel(activeMemberId);
}

function initPatracQuickEditUi() {
    if (patracQuickEditUiInitialized) return;
    patracQuickEditUiInitialized = true;

    const saveBtn = document.getElementById('saveQuickEditBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveQuickEditChanges);

    const quickEditPanel = document.getElementById('quickEditPanel');
    if (quickEditPanel) {
        quickEditPanel.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = event.target;
            const quickEditButton = target.closest('.quick-edit-btn');

            if (quickEditButton && activeMemberId) {
                const activeMember = document.getElementById(activeMemberId);
                if (!activeMember) return;
                const attribute = quickEditButton.dataset.attribute;
                const value = quickEditButton.dataset.value;

                if (multiSelectAttributes.includes(attribute)) {
                    let currentValues = activeMember.dataset[attribute] ? activeMember.dataset[attribute].split(', ') : [];
                    if (value === 'Sans') {
                        currentValues = ['Sans'];
                    } else {
                        if (currentValues.includes('Sans')) currentValues = [];
                        if (currentValues.includes(value)) {
                            currentValues = currentValues.filter(v => v !== value);
                        } else {
                            currentValues.push(value);
                        }
                    }
                    if (currentValues.length === 0) currentValues = ['Sans'];
                    activeMember.dataset[attribute] = currentValues.join(', ');

                    quickEditButton.classList.toggle('selected', currentValues.includes(value));
                    if (value !== 'Sans') {
                        const group = quickEditButton.parentElement;
                        const sansBtn = Array.from(group.children).find(b => b.textContent === 'Sans');
                        if (sansBtn) sansBtn.classList.remove('selected');
                    } else {
                        const group = quickEditButton.parentElement;
                        Array.from(group.children).forEach(b => { if (b !== quickEditButton) b.classList.remove('selected'); });
                    }
                } else {
                    activeMember.dataset[attribute] = value;
                    if (attribute === 'cellule' && value === 'Sans') {
                        activeMember.dataset.fonction = 'Sans';
                    }
                    if (attribute === 'fonction' && value !== 'Sans' && activeMember.dataset.cellule === 'Sans') {
                        activeMember.dataset.cellule = 'India 1';
                    }
                    const group = quickEditButton.parentElement;
                    group.querySelectorAll('.quick-edit-btn').forEach(btn => btn.classList.remove('selected'));
                    quickEditButton.classList.add('selected');
                }

                updateMemberButtonVisuals(activeMember);
                if (typeof syncDomToStore === 'function') {
                    syncDomToStore();
                    updateArticulationDisplay();
                }
            }
        });

        quickEditPanel.addEventListener('input', (e) => {
            if (!activeMemberId) return;
            const member = document.getElementById(activeMemberId);
            if (!member) return;
            if (e.target.id === 'quick_edit_trigramme_input') {
                member.dataset.trigramme = e.target.value.toUpperCase();
                updateMemberButtonVisuals(member);
                if (typeof syncDomToStore === 'function') syncDomToStore();
            } else if (e.target.id === 'quick_edit_dir_input') {
                member.dataset.dir = e.target.value;
                updateMemberButtonVisuals(member);
                if (typeof syncDomToStore === 'function') {
                    syncDomToStore();
                    updateArticulationDisplay();
                }
            }
        });
    }

    const quickEditModal = document.getElementById('quickEditModal');
    const cancelBtn = document.getElementById('quick_modal_cancelBtn');
    const saveBtnModal = document.getElementById('quick_modal_saveBtn');

    if (quickEditModal && cancelBtn && saveBtnModal) {
        cancelBtn.addEventListener('click', closeQuickEditModal);
        saveBtnModal.addEventListener('click', saveQuickEditModalChanges);

        quickEditModal.addEventListener('click', (e) => {
            if (e.target === quickEditModal) closeQuickEditModal();
        });
    }
}

let patracQuickEditUiInitialized = false;
window.initPatracQuickEditUi = initPatracQuickEditUi;

// --- GLOBAL EXPOSURE ---
window.renameVehicle = renameVehicle;
window.addManualVehicle = addManualVehicle;
window.addManualMember = addManualMember;
window.addPatracdvrRow = addPatracdvrRow;
window.addPatracdvrMember = addPatracdvrMember;
window.initializePatracdvr = initializePatracdvr;
window.updateMemberButtonVisuals = updateMemberButtonVisuals;
window.populateQuickEditPanel = populateQuickEditPanel;
window.saveQuickEditChanges = saveQuickEditChanges;
window.updateArticulationDisplay = updateArticulationDisplay;
window.cloneMemberFromContext = cloneMemberFromContext;
window.deleteMemberFromContext = deleteMemberFromContext;
window.resetPatracdvrUI = resetPatracdvrUI;
window.loadConfigObject = loadConfigObject;
