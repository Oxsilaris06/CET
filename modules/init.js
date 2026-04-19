// ==================== Constants.js ====================
// Support OI2_CONFIG override (oi2.html uses separate storage keys)
const LOCAL_STORAGE_KEY = (window.OI2_CONFIG && window.OI2_CONFIG.LOCAL_STORAGE_KEY) || 'tactical_oi_data';
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
const INDEXED_DB_NAME = (window.OI2_CONFIG && window.OI2_CONFIG.DB_NAME) || 'OI_GeneratorLiteDB';
const BACKGROUND_IMAGE_ID = 'pdf_background';
const BACKGROUND_IMAGE_LIGHT = 'assets/img/fond_oi_light.png';
const BACKGROUND_IMAGE_DARK = 'assets/img/fond_oi_dark.png';

// --- Globals ---
const DEFAULTS = {
    missions: {
        moicp: 'RECONNAÎTRE LE DOMICILE EN VUE D\'APPRÉHENDER L\'OBJECTIF',
        zmspcp: 'BOUCLER - SURVEILLER - INTERDIRE TOUTE FUITE',
        effraction: `SOUTENIR L'ÉLÉMENT D'INTERVENTION\nL'objectif premier de la cellule est d'effectuer une effraction rapide et sécurisée sur la porte principale façade ALPHA afin de permettre la progression fluide de l'équipe d'assaut. En mesure de se rearticuler sur ordre.`
    },
    cat: {
        moicp: `- Si décelé, dynamiser jusqu'au domicile.\n- Si présence tierce personne lors de la progression, contrôler.\n- Si fuite, CR direction fuite + interpellation.\n- Si rébellion, usage du strict niveau de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.`,
        zmspcp: `- Compte rendu de mise en place.\n- Renseigner régulièrement.\n- Si décelé, CR.\n- Si fuite, CR direction fuite + interpellation si rapport de force favorable.\n- Si rébellion, usage du strict minimum de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.`,
        generales: `- Pas d'initiative individuelle hors cadre légitime défense.\n- Discipline radio stricte.\n- CR systématique de tout changement de situation.`
    }
};

let activeMemberId = null;
let memberConfig = {
    fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "Conducteur", "Chef de bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
    cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"],
    principales: ["UMP9", "G36", "FAP", "Sans"],
    afis: ["PIE", "LBD40", "LBD44", "Sans"],
    secondaires: ["PSA"],
    grenades: ["GENL", "MP7", "Sans"],
    equipements: ["Sans", "BBAL", "Bouclier MO", "Belier", "Lacry", "IL", "Lot 5.11", "HDR 50", "OP71", "DoorRaider", "Cintreuse"],
    equipements2: ["Sans", "Cam pieton", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass"],
    tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis"],
    gpbs: ["GPBL", "GPBPD", "Casque Lourd", "Casque MO", "Sans"]
};

// --- Wizard State & DOM ---
let visitedSteps = new Set();
let steps = [];
let progressSteps = [];
let prevBtn, nextBtn, previewBtn;
let patracdvrContainer, unassignedContainer, resetPatracdvrBtn;
let presentationModal, downloadPdfBtn, coherenceAlertsContainer, recapFinalisation;
let currentAnnotationColor = '#c0392b';

// Canvases for annotations
const tempCanvas = document.createElement('canvas');
const tempCtx = tempCanvas.getContext('2d');
const multiSelectAttributes = ['fonction', 'equipement', 'equipement2', 'afis', 'gpb'];
const quickEditMapping = {
    'Cellule': { key: 'cellules', attribute: 'cellule' },
    'Fonction': { key: 'fonctions', attribute: 'fonction' },
    'Arme P.': { key: 'principales', attribute: 'principales' },
    'Arme S.': { key: 'secondaires', attribute: 'secondaires' },
    'A.F.I.': { key: 'afis', attribute: 'afis' },
    'Grenades': { key: 'grenades', attribute: 'grenades' },
    'Équip. 1': { key: 'equipements', attribute: 'equipement' },
    'Équip. 2': { key: 'equipements2', attribute: 'equipement2' },
    'Tenue': { key: 'tenues', attribute: 'tenue' },
    'GPB': { key: 'gpbs', attribute: 'gpb' }
};

// --- Annotation / Drawing Globals ---
let annotationModal, canvas, ctx, rotationInput;
let baseImage = new Image();
let currentTool = 'move';
let isDrawing = false;
let isDragging = false;
let startX, startY;
let currentAnnotation = null;
let selectedAnnotation = null;
let dragOffsetX, dragOffsetY;
let isMovingAnnotation = false;


// ==================== Store.js (Advanced Proxy Implementation) ====================

const initialState = {
    formData: {},
    annotations: [],
    currentStep: 0,
    compressedImages: {},
    objectUrlsCache: {}
};

const listeners = new Set();

/**
 * Crée un proxy récursif pour surveiller les changements de propriétés,
 * même dans les objets imbriqués (ex: Store.state.formData.nom = '...')
 */
function createDeepProxy(target, notifyCallback) {
    return new Proxy(target, {
        get(obj, prop) {
            const val = Reflect.get(obj, prop);

            // On ne proxyfie PAS les types binaires (Blob, ArrayBuffer, TypedArrays)
            // car cela corrompt l'accès aux données internes pour pdf-lib et URL.createObjectURL
            if (val !== null && typeof val === 'object') {
                const isBinary = (val instanceof Blob) ||
                    (val instanceof ArrayBuffer) ||
                    (ArrayBuffer.isView(val)) ||
                    (val instanceof File);

                if (!isBinary) {
                    return createDeepProxy(val, notifyCallback);
                }
            }
            return val;
        },
        set(obj, prop, value) {
            const result = Reflect.set(obj, prop, value);
            notifyCallback(); // Déclenche la notification à chaque modification
            return result;
        }
    });
}

const StoreBase = {
    state: initialState,

    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    notify() {
        for (let listener of listeners) {
            listener(this.state);
        }
        this.saveToStorage();
    },

    saveToStorage() {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.state.formData));
        } catch (e) {
            console.error("LocalStorage Error:", e);
        }
    },

    async checkIntegrity() {
        if (!this.state.formData.dynamic_photos) return;
        let changed = false;
        
        for (const containerId in this.state.formData.dynamic_photos) {
            const photos = this.state.formData.dynamic_photos[containerId];
            const validPhotos = [];
            
            for (const photo of photos) {
                const exists = await window.dbManager.getItem(photo.id);
                if (exists) {
                    validPhotos.push(photo);
                } else {
                    console.warn(`Photo ${photo.id} introuvable dans IDB, suppression de la référence.`);
                    changed = true;
                }
            }
            
            if (changed) {
                this.state.formData.dynamic_photos[containerId] = validPhotos;
            }
        }
        
        if (changed) {
            this.notify();
            if (typeof window.syncAllThumbnails === 'function') window.syncAllThumbnails();
        }
    },

    loadFromStorage() {
        const data = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (data) {
            try {
                // On peuple directement pour éviter le Proxy set() récursif lors de l'init
                this.state.formData = JSON.parse(data);
                console.log('✅ Store initialisé depuis le stockage');
            } catch (e) {
                console.error('Invalid JSON in localStorage', e);
            }
        }
    }
};

// L'objet Store final expose les méthodes de StoreBase 
// ET un état 'state' qui est lui-même un proxy profond.
const Store = new Proxy(StoreBase, {
    get(target, prop) {
        if (prop === 'state') {
            return createDeepProxy(target.state, () => target.notify());
        }
        return Reflect.get(target, prop);
    }
});

// --- INITIALISATION DU STORE ---
Store.loadFromStorage();


// ==================== DBManager.js ====================

const dbManager = {
    dbName: 'OI_GeneratorLiteDB',
    storeName: 'images',
    db: null,

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
                if (!this.db.objectStoreNames.contains(this.storeName)) {
                    this.db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });
    },

    putItem(key, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(blob, key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    },

    getItem(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    deleteItem(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => {
                if (Store.state.objectUrlsCache && Store.state.objectUrlsCache[key]) {
                    URL.revokeObjectURL(Store.state.objectUrlsCache[key]);
                    delete Store.state.objectUrlsCache[key];
                }
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    },

    clearAllImages() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => {
                if (typeof cleanupObjectUrls === 'function') cleanupObjectUrls();
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }
};


// ==================== Unified Initialization ===================
// --- Styles Dynamiques ---
const style = document.createElement('style');
style.textContent = `
    textarea { resize: both !important; }
    .draggable.dragging { opacity: 0.5; border: 2px dashed var(--accent-blue); }
    .patracdvr-member-btn { transition: all 0.2s ease; cursor: pointer; }
    .patracdvr-member-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
    .container { scroll-behavior: smooth; }
    
    /* Context Menu Styles */
    .context-menu button:hover {
        background-color: var(--bg-interactive-hover) !important;
    }

    /* FIX: Photo Upload Visibility & Interaction */
    .file-upload-label {
        display: flex !important;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        cursor: pointer;
    }
`;
document.head.appendChild(style);

// --- GLOBAL EXPOSURE (PHASE 1) ---
window.Store = Store;
window.dbManager = dbManager;
window.visitedSteps = visitedSteps;
window.memberConfig = memberConfig;

// Aliases pour la compatibilité
window.saveToStorage = () => {
    if (typeof syncDomToStore === 'function') {
        return syncDomToStore();
    }
    return Store.saveToStorage();
};

window.saveFormData = window.saveToStorage;

// Export DEFAULTS
window.DEFAULTS = DEFAULTS;

// --- Vérification de disponibilité du stockage local ---
(function checkStorageAvailability() {
    let storageAvailable = false;

    // Test localStorage
    try {
        const testKey = '__storage_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        storageAvailable = true;
        console.log('✅ LocalStorage disponible');
    } catch (e) {
        console.warn('⚠️ LocalStorage non disponible - Mode local détecté');
        console.warn('ℹ️ En mode file://, le navigateur peut bloquer localStorage pour des raisons de sécurité.');
        console.warn('💡 Solution: Utilisez un serveur HTTP local (ex: python3 -m http.server 8000)');
    }

    // Test IndexedDB
    try {
        const testDb = indexedDB.open('test_db', 1);
        testDb.onsuccess = () => {
            console.log('✅ IndexedDB disponible');
            testDb.result.close();
            indexedDB.deleteDatabase('test_db');
        };
        testDb.onerror = () => {
            console.warn('⚠️ IndexedDB non disponible');
        };
    } catch (e) {
        console.warn('⚠️ IndexedDB non disponible');
    }

    if (!storageAvailable) {
        console.warn('\n🔴 ATTENTION: Le stockage local est bloqué en mode file://');
        console.warn('ℹ️ Les données ne seront PAS conservées entre les rechargements de page.');
        console.warn('💡 Pour utiliser toutes les fonctionnalités, lancez un serveur HTTP local:\n   python3 -m http.server 8000\n   puis ouvrez: http://localhost:8000/4.html');
    }
})();