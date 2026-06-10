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

/**
 * Catalogue d'icônes pour pings tactiques (modale "Ajouter un point").
 *
 * Structure : id = nom Material Symbols Outlined, label = affichage UI,
 * tags = mots-clés pour la suggestion automatique d'après l'intitulé.
 * Les tags incluent variantes accentuées/abrégées : on normalise à l'appel
 * (suppression diacritiques, lowercase) côté UI pour matcher.
 *
 * Tous les ids ont été vérifiés présents dans la fonte
 * "Material Symbols Outlined" (Google Fonts).
 */
export const PIN_ICONS = [
    // --- Forces de l'ordre ---
    // Police = casquette (local_police = écusson police badge ronde),
    // Gendarmerie = étoile militaire (military_tech) pour la distinguer nettement.
    { id: 'local_police', label: 'Police', cat: 'Forces', tags: ['police','flic','agent','op'] },
    { id: 'military_tech', label: 'Gendarmerie', cat: 'Forces', tags: ['gendarmerie','gendarme','brigade','militaire'] },
    { id: 'security', label: 'Sécurité', cat: 'Forces', tags: ['securite','garde','protection'] },
    { id: 'shield_person', label: 'Inter armé', cat: 'Forces', tags: ['inter','gign','raid','gipn','intervention','swat'] },

    // --- Pompiers / secours ---
    { id: 'local_fire_department', label: 'Pompier', cat: 'Secours', tags: ['pompier','sapeur','sdis','feu','spp'] },
    { id: 'fire_truck', label: 'FPT/VSAV', cat: 'Secours', tags: ['pompier','fpt','vsav','camion pompier','vehicule pompier'] },
    { id: 'medical_services', label: 'SAMU', cat: 'Secours', tags: ['samu','medecin','medical','medic','ambulance','soin','soins'] },
    { id: 'ambulance', label: 'Ambulance', cat: 'Secours', tags: ['ambulance','smur','vsav'] },
    { id: 'health_and_safety', label: 'PMA', cat: 'Secours', tags: ['pma','sante','soin','soins','secours'] },
    { id: 'monitor_heart', label: 'Réa', cat: 'Secours', tags: ['rea','reanimation','urgence'] },

    // --- Cyno ---
    { id: 'pets', label: 'Cyno', cat: 'Cyno', tags: ['cyno','chien','k9','canin'] },

    // --- Négociateur / com ---
    { id: 'record_voice_over', label: 'Négociateur', cat: 'Com', tags: ['negociateur','nego','negoc','dialogue','parole','com'] },
    { id: 'headset_mic', label: 'Opérateur radio', cat: 'Com', tags: ['operateur','radio','com','transmission','tg'] },
    { id: 'forum', label: 'Réunion', cat: 'Com', tags: ['reunion','debrief','meeting','briefing'] },

    // --- Autorité civile ---
    { id: 'account_balance', label: 'Maire / Préfet', cat: 'Autorité', tags: ['maire','prefet','autorite','mairie','prefecture','institution'] },
    { id: 'gavel', label: 'Magistrat', cat: 'Autorité', tags: ['magistrat','procureur','juge','justice'] },
    { id: 'corporate_fare', label: 'Institution', cat: 'Autorité', tags: ['institution','admin','administration'] },

    // --- Adversaire / otage / victime ---
    { id: 'person_alert', label: 'Adversaire', cat: 'Acteurs', tags: ['adversaire','adv','hostile','suspect','forcene','dangereux'] },
    { id: 'person_off', label: 'Otage', cat: 'Acteurs', tags: ['otage','hostage','prisonnier'] },
    { id: 'personal_injury', label: 'Blessé / Victime', cat: 'Acteurs', tags: ['blesse','victime','injury','injury'] },
    { id: 'group', label: 'Groupe / Foule', cat: 'Acteurs', tags: ['groupe','foule','population','public','civils'] },
    { id: 'face', label: 'Témoin', cat: 'Acteurs', tags: ['temoin','witness','riverain'] },
    { id: 'person', label: 'Individu', cat: 'Acteurs', tags: ['individu','personne','pieton','piéton','pax'] },

    // --- Armes / menace ---
    { id: 'swords', label: 'Armes', cat: 'Armes', tags: ['arme','armes','melee','sabre','epee'] },
    { id: 'target', label: 'Cible / Objectif', cat: 'Armes', tags: ['cible','target','objectif','obj'] },
    { id: 'crisis_alert', label: 'Menace', cat: 'Armes', tags: ['menace','danger','alerte','alarm'] },
    { id: 'gps_fixed', label: 'Tireur', cat: 'Armes', tags: ['tireur','sniper','tir','tireur isole'] },

    // --- Explosif / pièges ---
    { id: 'bomb', label: 'Explosif', cat: 'EOD', tags: ['bombe','explosif','ied','engin','tnt','eod','dni'] },
    { id: 'dangerous', label: 'Piège', cat: 'EOD', tags: ['piege','trap','danger','engin piege'] },
    { id: 'warning', label: 'Danger', cat: 'EOD', tags: ['danger','attention','warning','risque','alerte'] },
    { id: 'bolt', label: 'Énergie/Élec', cat: 'EOD', tags: ['electrique','elec','tension','court circuit'] },

    // --- Drogue / produits ---
    { id: 'vaccines', label: 'Drogue', cat: 'Stup', tags: ['drogue','stup','seringue','heroine','cocaine'] },
    { id: 'medication', label: 'Médicament', cat: 'Stup', tags: ['medicament','pilule','medic'] },
    { id: 'science', label: 'Labo', cat: 'Stup', tags: ['labo','chimie','produit','laboratoire'] },

    // --- Surveillance / observation ---
    { id: 'videocam', label: 'Caméra', cat: 'Obs', tags: ['camera','video','surveillance','cctv','videosurveillance'] },
    { id: 'photo_camera', label: 'Photo', cat: 'Obs', tags: ['photo','appareil','cliche'] },
    { id: 'visibility', label: 'Observation', cat: 'Obs', tags: ['observation','vue','watch','spotter','jumelles','obs'] },
    { id: 'remove_red_eye', label: 'Surveillance', cat: 'Obs', tags: ['surveillance','vue','vigie','planque'] },

    // --- Véhicules ---
    { id: 'directions_car', label: 'Voiture', cat: 'Véhicule', tags: ['voiture','vl','car','vehicule','vehicule leger'] },
    { id: 'local_taxi', label: 'Taxi', cat: 'Véhicule', tags: ['taxi'] },
    { id: 'directions_bus', label: 'Bus / Car', cat: 'Véhicule', tags: ['bus','car','autocar'] },
    { id: 'local_shipping', label: 'Camion / PL', cat: 'Véhicule', tags: ['camion','poids lourd','pl','truck','remorque'] },
    { id: 'two_wheeler', label: 'Moto', cat: 'Véhicule', tags: ['moto','scooter','2 roues','deux roues'] },
    { id: 'pedal_bike', label: 'Vélo', cat: 'Véhicule', tags: ['velo','bike','cycliste'] },
    { id: 'directions_boat', label: 'Bateau', cat: 'Véhicule', tags: ['bateau','navire','boat','embarcation'] },
    { id: 'flight', label: 'Avion / Hélico', cat: 'Véhicule', tags: ['avion','plane','helico','helicoptere'] },

    // --- Lieux / structures ---
    { id: 'home', label: 'Maison', cat: 'Lieu', tags: ['maison','home','habitation','domicile'] },
    { id: 'apartment', label: 'Immeuble', cat: 'Lieu', tags: ['immeuble','batiment','apartment','residence'] },
    { id: 'dvr', label: 'PC opérationnel', cat: 'Lieu', tags: ['pc','poste','commandement','pc op','pc tac','pco'] },
    { id: 'door_front', label: 'Accès / Porte', cat: 'Lieu', tags: ['porte','entree','acces','door'] },
    { id: 'fence', label: 'Clôture', cat: 'Lieu', tags: ['cloture','barriere','fence','grille'] },
    { id: 'flag', label: 'Repère', cat: 'Lieu', tags: ['repere','flag','marker','drapeau'] }
];

/**
 * Normalise un texte pour matching (sans accents, lowercase, trim).
 */
export function normalizeForMatch(s) {
    return (s || '').toString()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();
}

/**
 * Renvoie les icônes les plus pertinentes pour un libellé donné.
 * Score = somme des correspondances de tokens (label ∩ tags).
 */
export function suggestPinIcons(label, max = 6) {
    const txt = normalizeForMatch(label);
    if (!txt) return [];
    const tokens = txt.split(/\s+/).filter(t => t.length >= 2);
    if (!tokens.length) return [];

    const scored = PIN_ICONS.map(ic => {
        let score = 0;
        const haystacks = [normalizeForMatch(ic.label), ...ic.tags.map(normalizeForMatch)];
        tokens.forEach(tok => {
            for (const h of haystacks) {
                if (h.includes(tok)) { score += (h === tok ? 3 : 1); break; }
            }
        });
        return { ic, score };
    }).filter(x => x.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map(x => x.ic);
}

window.PIN_ICONS = PIN_ICONS;
window.suggestPinIcons = suggestPinIcons;

// Exposition globale
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
window.PHOTO_CATEGORIES = PHOTO_CATEGORIES;
window.FREE_MODE_COLORS = FREE_MODE_COLORS;
window.PDF_PAX_COLORS = PDF_PAX_COLORS;
