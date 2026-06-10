/**
 * patrac.js — Gestion du tableau de répartition du personnel et des véhicules (PATRACDVR).
 * Chargé par : 4.html
 * Fonctions principales : addPatracdvrRow, addPatracdvrMember, handleMemberSelection, initializePatracdvr
 */
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
                    <button type="button" class="remove-btn" title="Supprimer le véhicule"><span class="material-symbols-outlined">close</span></button>
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
                equipement2: 'Cam pieton',
                tenue: 'UBAS',
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
/**
 * Crée une CELLULE entière (≥ 2 PAX) en une fois. Une cellule India/AO occupe le
 * prochain numéro libre ; Effraction est unique. La fonction par défaut découle du
 * type (India→Inter, AO→AO, Effrac→Effrac). Les PAX sont pré-affectés à la cellule,
 * donc l'articulation (MOICP←India / ZMSPCP←AO / Effraction) se peuple aussitôt.
 */
function addCellBatch(type) {
    const labelMap = { India: 'India (Inter)', AO: 'AO', Effrac: 'Effraction' };
    const input = prompt(
        `Trigrammes des PAX de la cellule ${labelMap[type] || type}\n` +
        `(séparés par espace, virgule ou retour à la ligne — 2 minimum) :`
    );
    if (input === null) return;
    const trigs = input.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (trigs.length < 2) {
        alert('Une cellule comporte au moins 2 personnels.');
        return;
    }

    let cellule, fonction;
    if (type === 'Effrac') {
        cellule = 'Effrac';
        fonction = 'Effrac';
    } else {
        const isIndia = (type === 'India');
        const prefix = isIndia ? 'India ' : 'AO';
        const max = isIndia ? 5 : 8;
        const used = new Set(
            Array.from(document.querySelectorAll('.patracdvr-member-btn')).map(b => b.dataset.cellule)
        );
        let n = 1;
        while (n <= max && used.has(prefix + n)) n++;
        if (n > max) n = max; // toutes occupées : on réutilise la dernière
        cellule = prefix + n;
        fonction = isIndia ? 'Inter' : 'AO';
    }

    const existing = new Set(
        Array.from(document.querySelectorAll('.patracdvr-member-btn')).map(b => b.dataset.trigramme)
    );
    let created = 0, skipped = 0;
    // Cellule Effraction : auto-équipement → 1er PAX = Bélier, 2e PAX = Lot 5.11.
    const effracEquip = ['Belier', 'Lot 5.11'];
    trigs.forEach(trig => {
        if (trig.length < 2 || trig.length > 4 || existing.has(trig)) { skipped++; return; }
        existing.add(trig);
        const memberData = { trigramme: trig, cellule: cellule, fonction: fonction };
        if (type === 'Effrac') memberData.equipement = effracEquip[created] || 'Sans';
        addPatracdvrMember(getUnassignedContainer(), memberData);
        created++;
    });

    if (created > 0) {
        syncDomToStore();
        updateArticulationDisplay();
        if (typeof toast === 'function') {
            toast(`Cellule ${cellule} : ${created} PAX ajouté(s)${skipped ? ', ' + skipped + ' ignoré(s)' : ''}.`, 'success');
        }
    } else {
        alert('Aucun PAX valide créé (trigrammes invalides ou déjà existants).');
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
        equipement2: 'Cam pieton',
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

// Panneau d'édition de membre = fiche-accordéon : 1 ligne par attribut (en-tête
// label → valeur(s) courante(s) + chevron) ; le corps repliable contient les pills.
function setupQuickEditPanel() {
    const contentContainer = document.querySelector('#quickEditPanel .quick-edit-content');
    if (!contentContainer) return;
    contentContainer.innerHTML = '';

    for (const [title, config] of Object.entries(quickEditMapping)) {
        const options = memberConfig[config.key] || [];

        const row = document.createElement('div');
        row.className = 'qe-row';
        row.dataset.attr = config.attribute;
        row.dataset.key = config.key;

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'qe-row-head';
        head.setAttribute('aria-expanded', 'false');
        head.innerHTML =
            `<span class="qe-row-label">${title}</span>` +
            `<span class="qe-row-value"></span>` +
            `<span class="material-symbols-outlined qe-row-chevron">chevron_right</span>`;
        row.appendChild(head);

        const body = document.createElement('div');
        body.className = 'qe-row-body';
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'quick-edit-options';
        options.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-edit-btn';
            btn.textContent = option;
            btn.dataset.attribute = config.attribute;
            btn.dataset.value = option;
            optionsContainer.appendChild(btn);
        });
        body.appendChild(optionsContainer);
        row.appendChild(body);

        // Attribut à option unique (ex Arme S. = "PSA") : pas d'accordéon, l'en-tête
        // bascule la valeur entre l'option et "Sans".
        if (options.length <= 1) {
            row.classList.add('qe-row-mono');
            row.dataset.single = options[0] || 'Sans';
            const chev = row.querySelector('.qe-row-chevron');
            if (chev) chev.style.display = 'none';
        }

        contentContainer.appendChild(row);
    }
}

/** Texte de synthèse de la valeur d'un attribut pour l'en-tête de ligne. */
function _qeRowValueText(member, row) {
    const attr = row.dataset.attr;
    const raw = member.dataset[attr] || '';
    if (multiSelectAttributes.includes(attr)) {
        // Afficher TOUTES les valeurs sélectionnées (aucune troncature).
        const vals = raw.split(', ').map(v => v.trim()).filter(v => v && v !== 'Sans');
        if (!vals.length) return { text: 'Sans', empty: true };
        return { text: vals.join(' · '), empty: false };
    }
    if (!raw || raw === 'Sans') return { text: 'Sans', empty: true };
    return { text: raw, empty: false };
}

/** Rafraîchit la valeur affichée dans l'en-tête d'une ligne (+ état mono on/off). */
function repaintRowValue(row, member) {
    const valEl = row.querySelector('.qe-row-value');
    if (!valEl) return;
    const { text, empty } = _qeRowValueText(member, row);
    valEl.textContent = text;
    valEl.classList.toggle('is-empty', empty);
    if (row.classList.contains('qe-row-mono')) row.classList.toggle('qe-mono-on', !empty);
}

/** Pastille « Enregistré » : feedback visuel d'auto-sauvegarde. */
let _qeAutosaveTimer = null;
function flashAutoSave() {
    const el = document.getElementById('qeAutosave');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(_qeAutosaveTimer);
    _qeAutosaveTimer = setTimeout(() => el.classList.remove('show'), 1200);
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

    // Composant unique mobile + desktop : la fiche-accordéon inline (compacte).
    populateQuickEditPanel(activeMemberId);
    const panel = document.getElementById('quickEditPanel');
    panel.style.display = 'flex';
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

    // Peindre la valeur courante de chaque ligne-fiche + replier toutes les lignes.
    document.querySelectorAll('#quickEditPanel .qe-row').forEach(row => {
        repaintRowValue(row, member);
        row.classList.remove('is-open');
        const h = row.querySelector('.qe-row-head');
        if (h) h.setAttribute('aria-expanded', 'false');
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

    // (Plus de bouton « Sauvegarder » : auto-sauvegarde à chaque modification.)

    const quickEditPanel = document.getElementById('quickEditPanel');
    if (quickEditPanel) {
        quickEditPanel.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = event.target;

            // 1) Clic sur un EN-TÊTE de ligne : accordéon (ouvre/ferme), ou bascule
            //    on/off pour les attributs à option unique (mono).
            const head = target.closest('.qe-row-head');
            if (head) {
                const row = head.closest('.qe-row');
                if (!row) return;
                if (row.classList.contains('qe-row-mono')) {
                    if (!activeMemberId) return;
                    const m = document.getElementById(activeMemberId);
                    if (!m) return;
                    const attr = row.dataset.attr;
                    const single = row.dataset.single || 'Sans';
                    m.dataset[attr] = (m.dataset[attr] === single) ? 'Sans' : single;
                    repaintRowValue(row, m);
                    updateMemberButtonVisuals(m);
                    if (typeof syncDomToStore === 'function') { syncDomToStore(); updateArticulationDisplay(); }
                    flashAutoSave();
                    return;
                }
                const willOpen = !row.classList.contains('is-open');
                quickEditPanel.querySelectorAll('.qe-row.is-open').forEach(r => {
                    r.classList.remove('is-open');
                    const h = r.querySelector('.qe-row-head'); if (h) h.setAttribute('aria-expanded', 'false');
                });
                if (willOpen) { row.classList.add('is-open'); head.setAttribute('aria-expanded', 'true'); }
                return;
            }

            // 2) Clic sur une PILL d'option : écrit l'attribut du membre actif.
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

                // Refléter la nouvelle valeur dans l'en-tête + replier (mono-select).
                const editedRow = quickEditButton.closest('.qe-row');
                if (editedRow) {
                    repaintRowValue(editedRow, activeMember);
                    // Couplage cellule↔fonction : repeindre toutes les lignes concernées.
                    if (attribute === 'cellule' || attribute === 'fonction') {
                        quickEditPanel.querySelectorAll('.qe-row').forEach(r => repaintRowValue(r, activeMember));
                    }
                    // Sélection unique (non multi) : on replie pour enchaîner vite.
                    if (!multiSelectAttributes.includes(attribute)) {
                        setTimeout(() => {
                            editedRow.classList.remove('is-open');
                            const h = editedRow.querySelector('.qe-row-head'); if (h) h.setAttribute('aria-expanded', 'false');
                        }, 150);
                    }
                }
                flashAutoSave();
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
                flashAutoSave();
            } else if (e.target.id === 'quick_edit_dir_input') {
                member.dataset.dir = e.target.value;
                updateMemberButtonVisuals(member);
                if (typeof syncDomToStore === 'function') {
                    syncDomToStore();
                    updateArticulationDisplay();
                }
                flashAutoSave();
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
window.addCellBatch = addCellBatch;
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

// ============================================================
// CONFIGURATION UNITÉ — édition de memberConfig depuis l'OI
// (remplace l'aller-retour vers patracdvr.html : tout se fait dans 4.html)
// ============================================================
function openUniteConfigModal() {
    const content = document.getElementById('unite_config_content');
    const modal = document.getElementById('uniteConfigModal');
    if (!content || !modal || typeof quickEditMapping === 'undefined') return;
    const esc = (v) => (window.UIPlatform ? UIPlatform.esc(v) : String(v));
    content.innerHTML = '';
    for (const [title, cfg] of Object.entries(quickEditMapping)) {
        const group = document.createElement('div');
        group.className = 'unite-config-group';
        const opts = (memberConfig[cfg.key] || []).join(', ');
        group.innerHTML = `<label>${esc(title)}</label><textarea data-config-key="${esc(cfg.key)}" rows="2">${esc(opts)}</textarea>`;
        content.appendChild(group);
    }
    document.body.classList.add('modal-open');
    if (typeof modal.showModal === 'function') { try { modal.showModal(); } catch (e) { modal.setAttribute('open', ''); } }
    else modal.setAttribute('open', '');
}

function saveUniteConfig() {
    const content = document.getElementById('unite_config_content');
    if (!content) return;
    content.querySelectorAll('textarea[data-config-key]').forEach(ta => {
        const key = ta.dataset.configKey;
        const list = ta.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const deduped = [...new Set(list)];
        memberConfig[key] = deduped.length ? deduped : ['Sans'];
    });
    // Régénérer les boutons d'édition de membre + persister IMMÉDIATEMENT (data.options).
    if (typeof setupQuickEditPanel === 'function') setupQuickEditPanel();
    if (typeof window.flushFormData === 'function') window.flushFormData();
    else if (typeof syncDomToStore === 'function') syncDomToStore();
    const modal = document.getElementById('uniteConfigModal');
    if (modal && typeof modal.close === 'function') modal.close();
    document.body.classList.remove('modal-open');
    if (typeof toast === 'function') toast("Configuration de l'unité enregistrée", 'success');
}
window.openUniteConfigModal = openUniteConfigModal;
window.saveUniteConfig = saveUniteConfig;

// ============================================================
// PDF DU PATRACDVR — généré directement (pdf-lib), sans patracdvr.html
// ============================================================
async function generatePatracdvrPdf() {
    if (typeof PDFLib === 'undefined') {
        if (typeof toast === 'function') toast('Bibliothèque PDF indisponible (réseau ?).', 'error');
        return;
    }
    try {
        // Collecte depuis le DOM (mêmes classes que patracdvr.html).
        const rowsData = [];
        document.querySelectorAll('#patracdvr_container .patracdvr-vehicle-row').forEach(row => {
            const members = Array.from(row.querySelectorAll('.patracdvr-member-btn')).map(b => ({ ...b.dataset }));
            rowsData.push({ vehicle: row.dataset.vehicleName || 'Véhicule', members });
        });
        const unassigned = Array.from(document.querySelectorAll('#unassigned_members_container .patracdvr-member-btn')).map(b => ({ ...b.dataset }));
        if (unassigned.length) rowsData.push({ vehicle: 'NON ASSIGNÉS', members: unassigned });
        if (!rowsData.length) { if (typeof toast === 'function') toast('Aucun membre dans le PATRACDVR.', 'warning'); return; }

        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        // Helvetica standard = WinAnsi : on neutralise tout caractère non encodable.
        const safe = (v) => String(v == null ? '' : v).replace(/[^\x00-\xFF]/g, '?');

        const A4L = [841.89, 595.28];
        const M = 28;
        const cols = [
            { t: 'PAX', k: 'trigramme', w: 52 }, { t: 'Fct', k: 'fonction', w: 78 },
            { t: 'Cel.', k: 'cellule', w: 56 }, { t: 'Arme P.', k: 'principales', w: 66 },
            { t: 'Arme S.', k: 'secondaires', w: 56 }, { t: 'AFI', k: 'afis', w: 54 },
            { t: 'Gren.', k: 'grenades', w: 56 }, { t: 'Equip 1', k: 'equipement', w: 92 },
            { t: 'Equip 2', k: 'equipement2', w: 92 }, { t: 'Tenue', k: 'tenue', w: 56 },
            { t: 'GPB', k: 'gpb', w: 56 }, { t: 'DIR', k: 'dir', w: 42 }
        ];
        const tableW = cols.reduce((s, c) => s + c.w, 0);
        const cInk = rgb(0.1, 0.1, 0.12), cLine = rgb(0.62, 0.62, 0.66), cHead = rgb(0.85, 0.88, 0.95), cVeh = rgb(0.80, 0.86, 1);
        const fs = 8, vehH = 16, headH = 18;

        let page, y;
        const newPage = () => { page = pdf.addPage(A4L); y = A4L[1] - M; };
        const wrap = (txt, w) => {
            const words = safe(txt).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
            for (const wd of words) {
                const test = cur ? cur + ' ' + wd : wd;
                if (font.widthOfTextAtSize(test, fs) > w - 6 && cur) { lines.push(cur); cur = wd; } else cur = test;
            }
            if (cur) lines.push(cur);
            return lines.length ? lines : ['-'];
        };
        const drawHeaderRow = () => {
            let x = M;
            page.drawRectangle({ x: M, y: y - headH, width: tableW, height: headH, color: cHead });
            cols.forEach(c => {
                page.drawText(c.t, { x: x + 3, y: y - headH + 6, size: fs, font: bold, color: cInk });
                page.drawLine({ start: { x, y }, end: { x, y: y - headH }, color: cLine, thickness: 0.5 });
                x += c.w;
            });
            page.drawLine({ start: { x, y }, end: { x, y: y - headH }, color: cLine, thickness: 0.5 });
            page.drawLine({ start: { x: M, y: y - headH }, end: { x: M + tableW, y: y - headH }, color: cLine, thickness: 0.5 });
            y -= headH;
        };

        newPage();
        page.drawText('PATRACDVR', { x: M, y: y - 14, size: 20, font: bold, color: rgb(0.18, 0.42, 0.85) });
        page.drawText(new Date().toLocaleDateString('fr-FR'), { x: M + tableW - 70, y: y - 12, size: 10, font, color: cInk });
        y -= 34;
        drawHeaderRow();

        for (const grp of rowsData) {
            if (y - vehH - 6 < M) { newPage(); drawHeaderRow(); }
            page.drawRectangle({ x: M, y: y - vehH, width: tableW, height: vehH, color: cVeh });
            page.drawText('VEHICULE : ' + safe(grp.vehicle), { x: M + 4, y: y - vehH + 4, size: 9, font: bold, color: cInk });
            y -= vehH;
            for (const m of grp.members) {
                const cellLines = cols.map(c => { let v = m[c.k] || ''; if (v === 'Sans') v = '-'; return wrap(v, c.w); });
                const nLines = Math.max(1, ...cellLines.map(l => l.length));
                const h = Math.max(vehH, nLines * (fs + 2) + 4);
                if (y - h < M) { newPage(); drawHeaderRow(); }
                let x = M;
                cols.forEach((c, ci) => {
                    page.drawLine({ start: { x, y }, end: { x, y: y - h }, color: cLine, thickness: 0.5 });
                    cellLines[ci].forEach((ln, li) => page.drawText(ln, { x: x + 3, y: y - 11 - li * (fs + 2), size: fs, font, color: cInk }));
                    x += c.w;
                });
                page.drawLine({ start: { x, y }, end: { x, y: y - h }, color: cLine, thickness: 0.5 });
                page.drawLine({ start: { x: M, y: y - h }, end: { x: M + tableW, y: y - h }, color: cLine, thickness: 0.5 });
                y -= h;
            }
        }

        const bytes = await pdf.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `PATRACDVR_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        if (typeof toast === 'function') toast('PDF PATRACDVR généré', 'success');
    } catch (e) {
        console.error('[PATRACDVR PDF] échec:', e);
        if (typeof toast === 'function') toast('Erreur de génération PDF : ' + e.message, 'error');
        else alert('Erreur PDF PATRACDVR : ' + e.message);
    }
}
window.generatePatracdvrPdf = generatePatracdvrPdf;
