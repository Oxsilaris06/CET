/**
 * Configuration et constantes globales pour PC TAC
 */

// Clés de stockage
export const LOCAL_STORAGE_KEY = 'pcTacLogData';
export const TP_ASSOC_KEY = 'pcTacTpAssociations';
export const ADVERSARIES_KEY = 'pcTacAdversaries';
export const HOSTAGES_KEY = 'pcTacHostages';
export const FRIENDS_KEY = 'pcTacFriends';
export const PHOTOS_KEY = 'pcTacPhotos';
export const CUSTOM_PAX_KEY = 'pcTacCustomPax';

// Catégories de photos
export const PHOTO_CATEGORIES = [
    { id: 'hostage', label: 'Otages' },
    { id: 'location', label: 'Lieu' },
    { id: 'trap', label: 'Piégeages' },
    { id: 'neutralized', label: 'Adversaire' },
    { id: 'target', label: 'VL target' },
    { id: 'all', label: 'Toutes' }
];

// Couleurs pour le mode libre (Pax Libre) - Couleurs distinctes des boutons natifs
export const FREE_MODE_COLORS = [
    { hex: '#a855f7', name: 'Violet' },       
    { hex: '#ec4899', name: 'Rose' },         
    { hex: '#f97316', name: 'Orange' }, 
    { hex: '#8b4513', name: 'Marron' },    
    { hex: '#db2777', name: 'Framboise' },    
    { hex: '#0ea5e9', name: 'Bleu Ocean' },       
    { hex: '#6366f1', name: 'Indigo' },         
    { hex: '#d946ef', name: 'Fuchsia' },
    { hex: '#84cc16', name: 'Lime' },
    { hex: '#14b8a6', name: 'Teal' },
    { hex: '#f43f5e', name: 'Rose Rouge' },
    { hex: '#ffffff', name: 'Blanc' }           
];

// Couleurs statiques pour le PDF et l'affichage (Mode Standard)
export const PDF_PAX_COLORS = {
    'Adversaire': { text: 'Adversaire', color: '#be1b09', fontColor: '#ffffff' },
    'Otage': { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' }, 
    'Civil': { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' }, 
    'Inter': { text: 'Inter', color: '#3498db', fontColor: '#ffffff' },
    'Nego': { text: 'Nego', color: '#2ecc71', fontColor: '#000000' },
    'Oscar': { text: 'Oscar', color: '#10b981', fontColor: '#000000' },
    'Autre': { text: 'Autre', color: '#2d2d2d', fontColor: '#e0e0e0' }
};

// Paramètres QR Code
export const QR_BATCH_SIZE = 5;
export const LONG_PRESS_DELAY = 700;

// Exposition globale
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
window.PHOTO_CATEGORIES = PHOTO_CATEGORIES;
window.FREE_MODE_COLORS = FREE_MODE_COLORS;
window.PDF_PAX_COLORS = PDF_PAX_COLORS;
