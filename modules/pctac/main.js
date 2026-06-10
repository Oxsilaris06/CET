import { Storage } from './storage.js';
import { UI } from './ui.js';
import { LogManager } from './logManager.js';
import { PdfExport } from './pdfExport.js';
import { Utils } from './utils.js';
import { ImageStore } from './imageStore.js';
import './planMap.js'; // expose window.PlanMap (utilisé par UI.switchMainView)
import { CUSTOM_PAX_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY } from './config.js';

/**
 * Point d'entrée principal du module PC TAC
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Service Worker (PWA, offline-fallback)
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('[PC TAC] SW register failed:', err));
    }

    // Migration des photos base64 vers IndexedDB (s'exécute une seule fois)
    try {
        await ImageStore.migrateFromLocalStorage();
    } catch (e) {
        console.error('[PC TAC] migration IndexedDB échouée:', e);
    }

    // Initialisation UI
    UI.initElements();
    UI.initPaxModeAndColors();
    UI.updateTimeInput();
    setInterval(() => UI.updateTimeInput(), 60000);

    // Charger les données initiales
    const initialLogs = Storage.loadLogData();
    UI.renderLogTable(initialLogs);
    UI.refreshLieuSuggestions();

    // Initialiser les écouteurs d'onglets
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.setAttribute('role', 'tab'); // T13 (a11y)
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            UI.switchMainView(viewId);
        });
    });
    // T13 (a11y) — navigation aux flèches entre onglets (les .tab-btn sont déjà
    // des <button>, donc focusables et activables au clavier nativement).
    const tabBar = document.querySelector('.main-tab-bar');
    if (tabBar && window.UIPlatform && typeof UIPlatform.makeTablist === 'function') {
        UIPlatform.makeTablist(tabBar, {
            tabSelector: '.tab-btn',
            activate: (tab) => { if (tab && tab.dataset.view) UI.switchMainView(tab.dataset.view); }
        });
    }

    // Charger la dernière vue
    const lastView = localStorage.getItem('lastView') || 'view-main-courante';
    UI.switchMainView(lastView);

    // Initialiser le thème
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.replace('dark-mode', 'light-mode');
        if (UI.elements.darkModeIcon) UI.elements.darkModeIcon.textContent = 'clear_day';
    }

    // --- ÉVÉNEMENTS ---

    // Soumission Log
    if (UI.elements.logForm) {
        UI.elements.logForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = {
                mode: UI.elements.paxModeInput.value,
                pax: UI.elements.paxInput.value,
                paxColor: UI.elements.paxInput.dataset.customColor || UI.elements.paxCustomColorInput.value,
                heure: UI.elements.heureInput.value,
                lieu: UI.elements.lieuInput.value,
                freePax: UI.elements.freePaxInput ? UI.elements.freePaxInput.value : '',
                remarques: UI.elements.remarquesInput.value
            };
            const newEntry = LogManager.addEntry(formData);
            if (newEntry) {
                UI.renderLogTable(Storage.loadLogData());
                UI.elements.remarquesInput.value = '';
                UI.elements.lieuInput.value = '';
                UI.refreshLieuSuggestions();
                UI.elements.remarquesInput.focus();
                UI.updateTimeInput(true);
            }
        });
    }

    // Création Intervenant Personnalisé
    const confirmCreatePaxBtn = document.getElementById('confirmCreatePaxBtn');
    if (confirmCreatePaxBtn) {
        confirmCreatePaxBtn.onclick = () => {
            const name = document.getElementById('new_pax_name').value.trim();
            const color = document.getElementById('new_pax_color_val').value;
            if (!name) return alert("Nom requis");
            const list = Storage.loadCollection(CUSTOM_PAX_KEY);
            list.push({ id: Date.now().toString(), name, color });
            Storage.saveCollection(CUSTOM_PAX_KEY, list);
            UI.renderCustomPaxOptions();
            UI.hideCreatePaxModal();
        };
    }

    // Gestion des collections génériques (Adversaires, Otages, Amis, Photos)
    const forms = [
        { 
            id: 'adversary-form', 
            key: ADVERSARIES_KEY, 
            view: 'view-adversaires', 
            fields: ['adv_nom', 'adv_prenom', 'adv_dob', 'adv_lien', 'adv_antecedents', 'adv_attitude', 'adv_substance', 'adv_arme', 'adv_photo'], 
            map: f => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], antecedents: f[4], attitude: f[5], substance: f[6], armes: f[7], photo: f[8] }) 
        },
        { 
            id: 'hostage-form', 
            key: HOSTAGES_KEY, 
            view: 'view-otages', 
            fields: ['hostage_nom', 'hostage_prenom', 'hostage_dob', 'hostage_lien', 'hostage_etat', 'hostage_blessure', 'hostage_photo'], 
            map: f => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], etat: f[4], blessures: f[5], photo: f[6] }) 
        },
        { id: 'friend-form', key: FRIENDS_KEY, view: 'view-amis', fields: ['friend_nom', 'friend_prenom', 'friend_unite', 'friend_tph', 'friend_mission'], map: f => ({ nom: f[0], prenom: f[1], unite: f[2], tph: f[3], mission: f[4] }) }
    ];

    forms.forEach(cfg => {
        const f = document.getElementById(cfg.id);
        if (f) {
            f.addEventListener('submit', async (e) => {
                e.preventDefault();
                const values = cfg.fields.map(id => {
                    const el = document.getElementById(id);
                    if (el.type === 'file') return el.dataset.base64 || '';
                    return el.value;
                });
                
                // Au moins un champ texte/photo doit avoir une vraie valeur
                if (values.some(v => v && (typeof v !== 'string' || v.trim() !== ''))) {
                    const itemId = Date.now().toString();
                    const mapped = cfg.map(values);
                    const photoData = mapped.photo;

                    // L'image part en IndexedDB, on garde seulement un flag dans la collection
                    if (photoData && typeof photoData === 'string' && photoData.startsWith('data:')) {
                        try { await ImageStore.put(itemId, photoData); } catch (e) { console.error('[PC TAC] put image échec:', e); }
                        delete mapped.photo;
                        mapped.hasImage = true;
                    }

                    const list = Storage.loadCollection(cfg.key);
                    list.push({ id: itemId, ...mapped });
                    Storage.saveCollection(cfg.key, list);

                    cfg.fields.forEach(id => {
                        const el = document.getElementById(id);
                        if (el.type === 'file') { el.value = ''; delete el.dataset.base64; }
                        else el.value = '';
                    });
                    // Reset des aperçus miniatures
                    ['adv_photo_preview', 'hostage_photo_preview'].forEach(pid => {
                        const p = document.getElementById(pid);
                        if (p) {
                            const isAdv = pid === 'adv_photo_preview';
                            p.innerHTML = `<span class="material-symbols-outlined" style="font-size: 30px; color: var(--text-muted);">${isAdv ? 'person' : 'person_off'}</span>`;
                        }
                    });

                    if (cfg.view === 'view-adversaires') {
                        await UI.renderAdversaries();
                        // Copie automatique vers Photos pour les adversaires
                        if (photoData) {
                            const syncId = itemId + "_sync";
                            try { await ImageStore.put(syncId, photoData); } catch (e) { console.error('[PC TAC] put sync image échec:', e); }
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            photoList.push({
                                id: syncId,
                                title: `${mapped.nom} ${mapped.prenom}`,
                                category: 'neutralized',
                                status: 'active',
                                hasImage: true
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            await UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-otages') {
                        await UI.renderHostages();
                        // Copie automatique vers Photos pour les otages avec statut intelligent
                        if (photoData) {
                            const b = (mapped.blessures || '').toLowerCase().trim();
                            const rasTerms = ['ras', '-', '/', 'rien', 'neant', 'néant', 'idemne', 'indemne', 'aucune', '0', 'ok'];
                            const isRas = rasTerms.some(term => b === term || b === term + '.');

                            let status = 'ok';
                            if ((b !== '' && !isRas) || b.includes('inconnu') || b === '?') status = 'preoccupant';
                            if (b.includes('blesse') || b.includes('blessé') || b.includes('grave')) status = 'blesse';
                            if (b.includes('mort') || b.includes('dcd') || b.includes('decede') || b.includes('décédé')) status = 'dcd';

                            const syncId = itemId + "_sync";
                            try { await ImageStore.put(syncId, photoData); } catch (e) { console.error('[PC TAC] put sync image échec:', e); }
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            photoList.push({
                                id: syncId,
                                title: `${mapped.nom} ${mapped.prenom}`,
                                category: 'hostage',
                                status: status,
                                hasImage: true
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            await UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-amis') UI.renderFriends();
                }
            });
        }
    });

    // Gestion base64 pour les inputs file d'adversaire/otage + aperçu miniature
    ['adv_photo', 'hostage_photo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                        el.dataset.base64 = compressedData;
                        // Mise à jour de la miniature dans le formulaire
                        const previewId = id === 'adv_photo' ? 'adv_photo_preview' : 'hostage_photo_preview';
                        const preview = document.getElementById(previewId);
                        if (preview) {
                            preview.innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                        }
                    } catch (err) {
                        console.error("Erreur de compression:", err);
                    }
                }
            });
        }
    });

    // Formulaire Photo spécifique
    if (UI.elements.photoForm) {
        UI.elements.photoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('photo_title').value.trim();
            const fileInput = document.getElementById('photo_file');
            const categorySelect = document.getElementById('photo_category');
            const category = categorySelect ? categorySelect.value : 'other';
            if (!title || !fileInput.files[0]) return alert("Titre et fichier requis");

            try {
                const compressedData = await Utils.compressImage(fileInput.files[0], 1024, 1024, 0.7);
                const photoId = Date.now().toString();
                await ImageStore.put(photoId, compressedData);
                const list = Storage.loadCollection(PHOTOS_KEY);
                list.push({ id: photoId, title, category, status: 'active', hasImage: true });
                Storage.saveCollection(PHOTOS_KEY, list);
                document.getElementById('photo_title').value = '';
                fileInput.value = '';
                await UI.renderPhotos();
            } catch (err) {
                console.error("Erreur de compression/sauvegarde:", err);
                alert("Erreur lors de l'ajout de la photo.");
            }
        });
    }

    // --- EXPOSITIONS GLOBALES ---
    window.deleteLogEntry = (id) => {
        LogManager.deleteEntry(id);
        UI.renderLogTable(Storage.loadLogData());
    };

    window.deleteCollectionItem = async (key, id, viewId) => {
        if (!confirm('Confirmer la suppression ?')) return;
        const list = Storage.loadCollection(key).filter(item => item.id !== id);
        Storage.saveCollection(key, list);

        // Nettoyer l'image dans IndexedDB
        try { await ImageStore.delete(id); } catch (e) { console.error('[PC TAC] delete image échec:', e); }

        // Suppression en cascade pour les photos synchronisées
        if (viewId === 'view-adversaires' || viewId === 'view-otages') {
            const photoKey = 'pcTacPhotos';
            const photos = Storage.loadCollection(photoKey);
            const syncId = id + "_sync";
            const filteredPhotos = photos.filter(p => p.id !== syncId);
            Storage.saveCollection(photoKey, filteredPhotos);
            try { await ImageStore.delete(syncId); } catch (e) { console.error('[PC TAC] delete sync échec:', e); }
        }

        if (viewId === 'view-adversaires') await UI.renderAdversaries();
        if (viewId === 'view-otages') await UI.renderHostages();
        if (viewId === 'view-amis') UI.renderFriends();
        if (viewId === 'view-photos') await UI.renderPhotos();
    };

    const previewPdfBtn = document.getElementById('previewPdfDockBtn');
    if (previewPdfBtn) previewPdfBtn.onclick = () => PdfExport.buildPdf();

    const resetBtn = document.getElementById('resetDataDockBtn');
    if (resetBtn) resetBtn.onclick = () => UI.showResetModal();

    const confirmResetBtn = document.getElementById('confirmResetBtn');
    if (confirmResetBtn) {
        confirmResetBtn.onclick = async () => {
            Storage.clearAllData();
            try { await ImageStore.clear(); } catch (e) { console.error('[PC TAC] clear IDB échec:', e); }

            // Reset des champs du formulaire principal
            ['lieu_input', 'remarques_input', 'heure_input'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            // Reset des formulaires de collection
            ['adversary-form', 'hostage-form', 'friend-form', 'photo-form'].forEach(fid => {
                const f = document.getElementById(fid);
                if (f) f.reset();
            });
            // Reset des aperçus photo
            ['adv_photo_preview', 'hostage_photo_preview'].forEach(pid => {
                const p = document.getElementById(pid);
                if (p) {
                    const isAdv = pid === 'adv_photo_preview';
                    p.innerHTML = `<span class="material-symbols-outlined" style="font-size: 30px; color: var(--text-muted);">${isAdv ? 'person' : 'person_off'}</span>`;
                }
            });
            ['adv_photo', 'hostage_photo'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.value = ''; delete el.dataset.base64; }
            });

            UI.hideResetModal();
            location.reload();
        };
    }

    const cancelCreatePaxBtn = document.getElementById('cancelCreatePaxBtn');
    if (cancelCreatePaxBtn) cancelCreatePaxBtn.onclick = () => UI.hideCreatePaxModal();

    // Édition Adversaire (champs + photo)
    const confirmEditAdvBtn = document.getElementById('confirmEditAdvBtn');
    if (confirmEditAdvBtn) confirmEditAdvBtn.onclick = () => UI.handleAdversaryUpdate();

    const editAdvPhotoInput = document.getElementById('edit_adv_photo_input');
    if (editAdvPhotoInput) {
        editAdvPhotoInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                    document.getElementById('edit_adv_preview').innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    editAdvPhotoInput.dataset.compressedBase64 = compressedData;
                } catch (err) {
                    console.error("Erreur de compression:", err);
                }
            }
        };
    }

    // Édition Otage (champs + photo)
    const confirmEditHostBtn = document.getElementById('confirmEditHostBtn');
    if (confirmEditHostBtn) confirmEditHostBtn.onclick = () => UI.handleHostageUpdate();

    const editHostPhotoInput = document.getElementById('edit_host_photo_input');
    if (editHostPhotoInput) {
        editHostPhotoInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                    document.getElementById('edit_host_preview').innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    editHostPhotoInput.dataset.compressedBase64 = compressedData;
                } catch (err) {
                    console.error("Erreur de compression:", err);
                }
            }
        };
    }

    // Édition Log (Enregistrer + Annuler du Reset)
    const confirmEditLogBtn = document.getElementById('confirmEditBtn');
    if (confirmEditLogBtn) confirmEditLogBtn.onclick = () => UI.confirmEditLog();

    const cancelResetBtn = document.getElementById('cancelResetBtn');
    if (cancelResetBtn) cancelResetBtn.onclick = () => UI.hideResetModal();

    // --- ARCHIVE TOUT-EN-UN (.pctac.zip) ---
    const { Archive } = await import('./archive.js');

    const exportArchiveBtn = document.getElementById('exportJsonDockBtn');
    if (exportArchiveBtn) exportArchiveBtn.onclick = () => Archive.exportZip();

    const importArchiveBtn = document.getElementById('importJsonDockBtn');
    const archiveFileInput = document.getElementById('archiveImportInput');
    if (importArchiveBtn && archiveFileInput) {
        importArchiveBtn.onclick = () => archiveFileInput.click();
        archiveFileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const res = await Archive.importFile(file);
                if (res && res.cancelled) {
                    archiveFileInput.value = '';
                    return;
                }
                UI.renderLogTable(Storage.loadLogData());
                UI.refreshLieuSuggestions();
                await UI.renderAdversaries();
                await UI.renderHostages();
                UI.renderFriends();
                await UI.renderPhotos();
                if (window.PlanMap && window.PlanMap.initialized) window.PlanMap.refresh();
                alert('Archive importée avec succès.');
            } catch (err) {
                console.error('[Archive] import échec:', err);
                alert('Erreur d\'import : ' + err.message);
            }
            archiveFileInput.value = '';
        };
    }

    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) darkModeToggle.onclick = () => UI.handleThemeToggle();

    const fullscreenToggle = document.getElementById('fullscreenToggle');
    if (fullscreenToggle) {
        fullscreenToggle.onclick = () => UI.toggleFullscreen();
        document.addEventListener('fullscreenchange', () => UI.updateFullscreenIcon());
    }

    const dockToggleBtn = document.getElementById('dockToggleBtn');
    if (dockToggleBtn) dockToggleBtn.onclick = () => UI.toggleDock();
    // T17 — restaure l'état réduit/déployé du dock (le markup est figé 'collapsed',
    // et la préférence enregistrée n'était jamais relue au démarrage).
    try {
        const savedDock = localStorage.getItem('dockCollapsed');
        if (savedDock !== null && UI.elements && UI.elements.dockMenu) {
            const collapsed = savedDock === 'true';
            UI.elements.dockMenu.classList.toggle('collapsed', collapsed);
            if (UI.elements.dockToggleIcon) UI.elements.dockToggleIcon.textContent = collapsed ? 'expand_less' : 'expand_more';
        }
    } catch (e) { /* localStorage indispo */ }
});
