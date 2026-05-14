/**
 * Stockage des images en IndexedDB pour PC TAC.
 *
 * Pourquoi : localStorage est limité à ~5-10 Mo et se sature vite avec des
 * photos base64. IndexedDB offre plusieurs centaines de Mo et survit aux
 * écritures concurrentes. Les métadonnées (titre, catégorie, statut, lien
 * adversaire/otage) restent en localStorage ; seuls les data URLs migrent.
 */

const DB_NAME = 'pcTacImages';
const STORE = 'images';
const VERSION = 1;
const MIGRATION_FLAG = 'pcTacIdbMigratedV1';

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

function withStore(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try { result = fn(store); } catch (e) { return reject(e); }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    }));
}

export const ImageStore = {
    async put(id, dataUrl) {
        if (!id || !dataUrl) return;
        return withStore('readwrite', store => store.put(dataUrl, id));
    },

    async get(id) {
        if (!id) return null;
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    },

    async getMany(ids) {
        if (!ids || !ids.length) return {};
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const out = {};
            let pending = ids.length;
            ids.forEach(id => {
                const req = store.get(id);
                req.onsuccess = () => {
                    out[id] = req.result || null;
                    if (--pending === 0) resolve(out);
                };
                req.onerror = () => reject(req.error);
            });
        });
    },

    async delete(id) {
        if (!id) return;
        return withStore('readwrite', store => store.delete(id));
    },

    async deleteMany(ids) {
        if (!ids || !ids.length) return;
        return withStore('readwrite', store => ids.forEach(id => store.delete(id)));
    },

    async clear() {
        return withStore('readwrite', store => store.clear());
    },

    /**
     * Migration unique : déplace les data URLs des collections localStorage
     * vers IndexedDB, en utilisant l'id de l'item comme clé.
     */
    async migrateFromLocalStorage() {
        if (localStorage.getItem(MIGRATION_FLAG)) return;

        const targets = [
            { key: 'pcTacPhotos', field: 'data' },
            { key: 'pcTacAdversaries', field: 'photo' },
            { key: 'pcTacHostages', field: 'photo' }
        ];

        for (const { key, field } of targets) {
            let list;
            try {
                list = JSON.parse(localStorage.getItem(key) || '[]');
            } catch (e) {
                continue;
            }
            if (!Array.isArray(list) || !list.length) continue;

            let changed = false;
            for (const item of list) {
                const val = item[field];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    try {
                        await this.put(item.id, val);
                        delete item[field];
                        item.hasImage = true;
                        changed = true;
                    } catch (e) {
                        console.error('[ImageStore] migration échec pour', key, item.id, e);
                    }
                }
            }
            if (changed) {
                try {
                    localStorage.setItem(key, JSON.stringify(list));
                } catch (e) {
                    console.error('[ImageStore] resave localStorage échec:', e);
                }
            }
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
    },

    /**
     * Hydrate une liste d'items en remettant le data URL dans le champ donné.
     * Retourne une nouvelle liste, sans muter l'originale.
     */
    async hydrate(items, field = 'data') {
        if (!items || !items.length) return items || [];
        const ids = items.map(i => i.id);
        const imgs = await this.getMany(ids);
        return items.map(i => imgs[i.id] ? { ...i, [field]: imgs[i.id] } : i);
    }
};

window.ImageStore = ImageStore;
