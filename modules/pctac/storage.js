import { LOCAL_STORAGE_KEY, TP_ASSOC_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY } from './config.js';

/**
 * Gestion du stockage LocalStorage pour PC TAC
 */

export const Storage = {
    /**
     * Sauvegarde les données du journal
     * @param {Array} logData 
     */
    saveLogData(logData) {
        try {
            // Tri par heure avant de sauvegarder
            logData.sort((a, b) => {
                if (a.heure === b.heure) return 0;
                return a.heure < b.heure ? -1 : 1;
            });
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logData));
        } catch (e) {
            console.error("Erreur de sauvegarde des données:", e);
        }
    },

    /**
     * Charge les données du journal
     * @returns {Array}
     */
    loadLogData() {
        try {
            const dataString = localStorage.getItem(LOCAL_STORAGE_KEY);
            return dataString ? JSON.parse(dataString) : [];
        } catch (e) {
            console.error("Erreur de chargement des données:", e);
            return [];
        }
    },

    /**
     * Récupère les associations TP (Pax Libre)
     * @returns {Object}
     */
    getTpAssociations() {
        try {
            return JSON.parse(localStorage.getItem(TP_ASSOC_KEY)) || {};
        } catch (e) {
            return {};
        }
    },

    /**
     * Sauvegarde une association TP
     * @param {string} label 
     * @param {string} color 
     */
    saveTpAssociation(label, color) {
        const assoc = this.getTpAssociations();
        assoc[color] = label;
        localStorage.setItem(TP_ASSOC_KEY, JSON.stringify(assoc));
    },

    /**
     * Sauvegarde une collection générique
     * @param {string} key 
     * @param {Array} data 
     */
    saveCollection(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`Erreur de sauvegarde collection ${key}:`, e);
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                alert("Mémoire saturée ! Impossible d'enregistrer plus de photos. Veuillez supprimer des anciennes photos ou réinitialiser les données via le dock.");
            }
        }
    },

    /**
     * Charge une collection générique
     * @param {string} key 
     * @returns {Array}
     */
    loadCollection(key) {
        try {
            const dataString = localStorage.getItem(key);
            return dataString ? JSON.parse(dataString) : [];
        } catch (e) {
            console.error(`Erreur de chargement collection ${key}:`, e);
            return [];
        }
    },

    /**
     * Réinitialise toutes les données
     */
    clearAllData() {
        const keys = [
            LOCAL_STORAGE_KEY, 
            TP_ASSOC_KEY, 
            ADVERSARIES_KEY, 
            HOSTAGES_KEY, 
            FRIENDS_KEY, 
            PHOTOS_KEY,
            CUSTOM_PAX_KEY
        ];
        keys.forEach(k => localStorage.removeItem(k));
    }
};

// Exposition globale pour compatibilité
window.saveLogData = Storage.saveLogData.bind(Storage);
window.loadLogData = Storage.loadLogData.bind(Storage);
window.getTpAssociations = Storage.getTpAssociations.bind(Storage);
window.saveTpAssociation = Storage.saveTpAssociation.bind(Storage);
