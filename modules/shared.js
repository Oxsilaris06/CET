// ==================== SharedUI.js ====================

/**
 * ==========================================
 * SHARED MODULES - GSTART PROJECT
 * ==========================================
 * Fournit les composants HTML communs (Adversaire, Pax, Photo)
 * et le système de stockage local (LocalStorage Wrapper).
 */

const SharedData = {
    storageKey: 'gstart_shared_data',

    // --- Gestion du Stockage (LocalStorage) ---
    init() {
        if (!localStorage.getItem(this.storageKey)) {
            localStorage.setItem(this.storageKey, JSON.stringify({
                adversaires: [],
                amis: [],
                otages: [],
                intervenants: [],
                photos: []
            }));
        }
    },

    getData() {
        this.init();
        return JSON.parse(localStorage.getItem(this.storageKey));
    },

    saveData(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
    },

    addItem(collection, item) {
        const data = this.getData();
        item.id = Date.now().toString(); // ID unique basé sur le timestamp
        if (!data[collection]) data[collection] = [];
        data[collection].push(item);
        this.saveData(data);
        return item;
    },

    removeItem(collection, id) {
        const data = this.getData();
        if (data[collection]) {
            data[collection] = data[collection].filter(i => i.id !== id);
            this.saveData(data);
        }
    },

    updateItem(collection, id, updatedItem) {
        const data = this.getData();
        if (data[collection]) {
            const index = data[collection].findIndex(i => i.id === id);
            if (index !== -1) {
                updatedItem.id = id; // Préserve l'ID
                data[collection][index] = updatedItem;
                this.saveData(data);
            }
        }
    }
};

window.SharedComponents = {
    db: SharedData,

    // ==========================================
    // MODULE: ADVERSAIRE
    // ==========================================
    Adversaire: {
        renderForm(containerId, onSaveCallbackName) {
            return `
                <div class="shared-module-form" id="form_adversaire_${containerId}">
                    <h4><span class="material-symbols-outlined">person_add</span> Créer un Adversaire</h4>
                    
                    <div class="form-row-dynamic" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                        <div><label for="adv_nom_${containerId}">Nom / Surnom / Signalement</label><input type="text" id="adv_nom_${containerId}" placeholder="Ex: Individu armé, 'Le balafré'..."></div>
                        <div><label for="adv_morpho_${containerId}">Morphologie</label><input type="text" id="adv_morpho_${containerId}" placeholder="Taille, corpulence..."></div>
                        <div><label for="adv_tenue_${containerId}">Tenue vestimentaire</label><input type="text" id="adv_tenue_${containerId}" placeholder="Veste noire, jean..."></div>
                        <div><label for="adv_arme_${containerId}">Armement / Dangerosité</label><input type="text" id="adv_arme_${containerId}" placeholder="Couteau, arme de poing..."></div>
                    </div>
                    
                    <div style="background: rgba(220, 38, 38, 0.05); border: 1px dashed var(--danger-red, #dc2626); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <h5 style="color: var(--danger-red, #dc2626); margin-top: 0; margin-bottom: 10px;">Fichiers GEND (Saisie Manuelle)</h5>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                            <div><label for="adv_taj_${containerId}">TAJ</label><input type="text" id="adv_taj_${containerId}" placeholder="Positif / Négatif / Actes"></div>
                            <div><label for="adv_fpr_${containerId}">FPR</label><input type="text" id="adv_fpr_${containerId}" placeholder="Fiche S, etc..."></div>
                            <div><label for="adv_sia_${containerId}">SIA / FINIADA</label><input type="text" id="adv_sia_${containerId}" placeholder="Détenteur ?"></div>
                            <div><label for="adv_siv_${containerId}">SIV / FOVES</label><input type="text" id="adv_siv_${containerId}" placeholder="Véhicule connu ?"></div>
                        </div>
                    </div>
                    
                    <button type="button" class="action-button add-btn" style="width: 100%" onclick="${onSaveCallbackName}('${containerId}')">
                        <span class="material-symbols-outlined">save</span> Enregistrer l'adversaire
                    </button>
                </div>
            `;
        },

        renderList(adversaires, onDeleteCallbackName) {
            if (!adversaires || adversaires.length === 0) return `<p style="color: var(--text-muted); font-style: italic;">Aucun adversaire enregistré.</p>`;

            return `
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${adversaires.map(adv => `
                        <div style="border: 1px solid var(--border-color, #3f3f46); padding: 15px; border-radius: 8px; background: rgba(0,0,0,0.2); position: relative;">
                            <button type="button" onclick="${onDeleteCallbackName}('${adv.id}')" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: var(--danger-red, #dc2626); cursor: pointer;"><span class="material-symbols-outlined">delete</span></button>
                            <h4 style="margin: 0 0 10px 0; color: var(--accent-blue, #3b82f6);">${adv.nom}</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85em; color: var(--text-secondary, #a1a1aa);">
                                <div><strong>Morpho:</strong> ${adv.morpho || '-'}</div>
                                <div><strong>Tenue:</strong> ${adv.tenue || '-'}</div>
                                <div style="color: var(--danger-red, #dc2626);"><strong>Arme:</strong> ${adv.arme || '-'}</div>
                                <div><strong>TAJ:</strong> ${adv.taj || '-'} | <strong>FPR:</strong> ${adv.fpr || '-'}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        },

        getFormData(containerId) {
            return {
                nom: document.getElementById('adv_nom_' + containerId)?.value || '',
                morpho: document.getElementById('adv_morpho_' + containerId)?.value || '',
                tenue: document.getElementById('adv_tenue_' + containerId)?.value || '',
                arme: document.getElementById('adv_arme_' + containerId)?.value || '',
                taj: document.getElementById('adv_taj_' + containerId)?.value || '',
                fpr: document.getElementById('adv_fpr_' + containerId)?.value || '',
                sia: document.getElementById('adv_sia_' + containerId)?.value || '',
                siv: document.getElementById('adv_siv_' + containerId)?.value || ''
            };
        }
    },

    // ==========================================
    // MODULE: PAX (Ami, Otage, Intervenant)
    // ==========================================
    Pax: {
        renderForm(type, containerId, onSaveCallbackName) {
            // type "amis", "otages", "intervenants"
            let title = type === 'amis' ? 'Créer Ami / Force amie' : (type === 'otages' ? 'Créer un Otage / Civil' : 'Créer un Intervenant (Log)');
            let icon = type === 'amis' ? 'group' : (type === 'otages' ? 'accessible_forward' : 'badge');
            let colorSelectHtml = '';

            if (type === 'intervenants') {
                colorSelectHtml = `
                    <div>
                        <label for="pax_color_${containerId}">Couleur (Affichage Timeline)</label>
                        <select id="pax_color_${containerId}" style="margin-bottom: 0;">
                            <option value="#3b82f6" style="background:#3b82f6; color:white;">Bleu (TI/Assaut)</option>
                            <option value="#22c55e" style="background:#22c55e; color:white;">Vert (Négo/Médic)</option>
                            <option value="#eab308" style="background:#eab308; color:black;">Jaune (Appui/Sniper)</option>
                            <option value="#ef4444" style="background:#ef4444; color:white;">Rouge (Effraction/Spécial)</option>
                            <option value="#a855f7" style="background:#a855f7; color:white;">Violet (Drone/Robot)</option>
                            <option value="#e2e8f0" style="background:#e2e8f0; color:black;">Blanc (Autre)</option>
                        </select>
                    </div>
                `;
            }

            let extraFieldsHtml = '';
            if (type !== 'intervenants') {
                extraFieldsHtml = `
                    <div>
                        <label for="pax_desc1_${containerId}">${type === 'amis' ? 'Unité / Fonction' : 'Âge / Genre'}</label>
                        <input type="text" id="pax_desc1_${containerId}">
                    </div>
                    <div>
                        <label for="pax_desc2_${containerId}">${type === 'amis' ? 'Mission / TPH' : 'État / Blessure potentielle'}</label>
                        <input type="text" id="pax_desc2_${containerId}">
                    </div>
                `;
            }

            return `
                <div class="shared-module-form" id="form_pax_${containerId}">
                    <h4><span class="material-symbols-outlined">${icon}</span> ${title}</h4>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                             <div>
                            <label for="pax_nom_${containerId}">Nom / Prénom / Indicatif</label>
                            <input type="text" id="pax_nom_${containerId}">
                        </div>
                        ${extraFieldsHtml}
                        ${colorSelectHtml}
                    </div>
                    
                    <button type="button" class="action-button add-btn" style="width: 100%" onclick="${onSaveCallbackName}('${type}', '${containerId}')">
                        <span class="material-symbols-outlined">save</span> Enregistrer le contact
                    </button>
                </div>
            `;
        },

        renderList(paxList, type, onDeleteCallbackName) {
            if (!paxList || paxList.length === 0) return `<p style="color: var(--text-muted); font-style: italic;">Aucun contact de type ${type} enregistré.</p>`;

            return `
                <div style="display: flex; flex-wrap: wrap; gap: 12px;">
                    ${paxList.map(p => `
                        <div style="border: 1px solid var(--border-color, #3f3f46); padding: 10px 15px; border-radius: 8px; background: rgba(0,0,0,0.2); min-width: 200px; display: flex; flex-direction: column; position: relative;">
                            ${type === 'intervenants' ? `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${p.color}; position: absolute; left: 10px; top: 15px;"></div>` : ''}
                            
                            <div style="padding-left: ${type === 'intervenants' ? '15px' : '0'}; flex: 1;">
                                <strong style="display:block; margin-bottom: 5px;">${p.nom}</strong>
                                ${p.desc1 ? `<div style="font-size: 0.8em; color: var(--text-secondary);">Info: ${p.desc1}</div>` : ''}
                                ${p.desc2 ? `<div style="font-size: 0.8em; color: var(--text-secondary);">${type === 'otages' ? '⚠️ ' : ''}${p.desc2}</div>` : ''}
                            </div>
                            
                            <button type="button" onclick="${onDeleteCallbackName}('${type}', '${p.id}')" style="align-self: flex-end; margin-top: 8px; background: none; border: none; color: var(--danger-red, #dc2626); cursor: pointer; font-size: 0.8em; display: flex; align-items: center; gap: 5px;">
                                <span class="material-symbols-outlined" style="font-size: 1.2em;">delete</span> Retirer
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        },

        getFormData(type, containerId) {
            return {
                nom: document.getElementById('pax_nom_' + containerId)?.value || '',
                desc1: document.getElementById('pax_desc1_' + containerId)?.value || '',
                desc2: document.getElementById('pax_desc2_' + containerId)?.value || '',
                color: document.getElementById('pax_color_' + containerId)?.value || '#e2e8f0',
                type: type
            };
        }
    },

    // ==========================================
    // MODULE: PHOTO (Vue contextuelle et Galerie)
    // ==========================================
    Photo: {
        renderUploadZone(contextId, onUploadCallbackName) {
            return `
                <div class="photo-upload-zone" style="border: 2px dashed var(--border-color, #3f3f46); border-radius: 8px; padding: 20px; text-align: center; background: rgba(255,255,255,0.02); margin-bottom: 15px;">
                    <span class="material-symbols-outlined" style="font-size: 3em; color: var(--text-muted); margin-bottom: 10px; display: block;">add_a_photo</span>
                    <input type="file" id="photo_input_${contextId}" accept="image/*" style="display: none;" onchange="${onUploadCallbackName}(event, '${contextId}')">
                    <label for="photo_input_${contextId}" style="cursor: pointer; color: var(--accent-blue, #3b82f6); font-weight: bold; border-bottom: 1px dotted var(--accent-blue, #3b82f6); display: inline-block; margin-bottom: 10px;">Cliquez pour ajouter une photo</label>
                    <input type="text" id="photo_titre_${contextId}" placeholder="Titre / Contexte de la photo..." style="width: 100%; max-width: 300px; display: block; margin: 0 auto; text-align: center; background: rgba(0,0,0,0.5);">
                </div>
            `;
        },

        renderGallery(photos, onDeleteCallbackName) {
            if (!photos || photos.length === 0) return `<p style="color: var(--text-muted); font-style: italic; text-align: center;">Aucune photo centralisée.</p>`;

            return `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px;">
                    ${photos.map(photo => `
                        <div style="border: 1px solid var(--border-color, #3f3f46); border-radius: 8px; overflow: hidden; background: #000; position: relative; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                            <img src="${photo.dataUrl}" alt="${photo.titre}" style="width: 100%; height: 140px; object-fit: cover; display: block;">
                            <div style="padding: 8px; background: rgba(0,0,0,0.8); position: absolute; bottom: 0; width: 100%;">
                                <div style="color: #fff; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${photo.titre}">${photo.titre || 'Sans titre'}</div>
                                <div style="font-size: 0.7em; color: var(--text-muted, #9ca3af);">${photo.context}</div>
                            </div>
                            <button type="button" onclick="${onDeleteCallbackName}('${photo.id}')" style="position: absolute; top: 5px; right: 5px; background: rgba(220, 38, 38, 0.8); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                                <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        },

        // Fonction utilitaire Base64 (à appeler depuis le callback)
        async fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result);
                reader.onerror = error => reject(error);
            });
        }
    }
};

// Initialisation globale si nécessaire
if (typeof window.SharedComponents !== 'undefined' && window.SharedComponents.db) {
    window.SharedComponents.db.init();
}
