import { Storage } from './storage.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY } from './config.js';

/**
 * Gestionnaire générique pour les collections tactiques
 */
class CollectionManager {
    constructor(key) {
        this.key = key;
    }

    getAll() {
        return Storage.loadCollection(this.key);
    }

    add(item) {
        const items = this.getAll();
        const newItem = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            createdAt: new Date().toISOString(),
            ...item
        };
        items.push(newItem);
        Storage.saveCollection(this.key, items);
        return newItem;
    }

    update(id, updatedData) {
        const items = this.getAll();
        const index = items.findIndex(i => i.id === id);
        if (index !== -1) {
            items[index] = { ...items[index], ...updatedData, updatedAt: new Date().toISOString() };
            Storage.saveCollection(this.key, items);
            return items[index];
        }
        return null;
    }

    delete(id) {
        let items = this.getAll();
        items = items.filter(i => i.id !== id);
        Storage.saveCollection(this.key, items);
        return items;
    }
}

// Instances pour chaque collection
export const AdversaryManager = new CollectionManager(ADVERSARIES_KEY);
export const HostageManager = new CollectionManager(HOSTAGES_KEY);
export const FriendManager = new CollectionManager(FRIENDS_KEY);
export const PhotoManager = new CollectionManager(PHOTOS_KEY);
