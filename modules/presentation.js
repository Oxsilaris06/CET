window.openPresentationMode = openPresentationMode;
// window.downloadOiPdf = downloadOiPdf; // Déplacé vers pdf_engine_v2.js

/**
 * Nettoie le texte pour éviter que pdf-lib ne plante avec des caractères non-WinAnsi
 */
function sanitizePdfText(text) {
    if (!text) return '';
    return text.toString()
        .replace(/[\u2192\u2794\u279C\u21D2]/g, '->') // Flèches Unicode -> "->"
        .replace(/[\u2022\u2023\u2043\u2219]/g, '-') // Liste à puces -> "-"
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Caractères de contrôle
        .replace(/[\u2018\u2019]/g, "'") // Quotes simples alternatives
        .replace(/[\u201C\u201D]/g, '"') // Quotes doubles alternatives
        .replace(/[\u2013\u2014]/g, '-') // Tirets longs et cadratins
        .replace(/\u2026/g, '...') // Points de suspension
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Décomposition des accents
        .replace(/[^\x00-\xFF]/g, '?'); // Tout ce qui dépasse l'ASCII étendu -> "?"
}

function openPresentationMode() {
    const presentationContent = document.getElementById('presentation-content');
    const presentationModal = document.getElementById('presentationModal');

    if (!presentationModal) {
        console.error("Modale 'presentationModal' non trouvée.");
        return;
    }

    if (typeof checkCoherence === 'function' && !checkCoherence()) {
        alert("Attention: Des incohérences ont été détectées. Veuillez les vérifier dans la section Finalisation avant de générer.");
    }

    if (typeof presentationModal.showModal === 'function') {
        presentationModal.showModal();
    } else {
        presentationModal.style.display = 'block';
    }

    // Appel du nouveau moteur unifié (V2)
    if (window.PDFEngineV2) {
        PDFEngineV2.openPreview();
    } else {
        if (presentationContent) {
            presentationContent.innerHTML = '<h2>Erreur : Moteur de rendu (V2) non chargé.</h2>';
        }
    }
}
