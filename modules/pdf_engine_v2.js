/**
 * pdf_engine_v2.js — Moteur de rendu PDF et d'aperçu, collectant les données du Store et des photos pour produire un document structuré.
 * Chargé par : 4.html
 * Fonctions principales : PDFEngineV2.openPreview, PDFEngineV2.downloadOiPdf, PDFEngineV2.collectAllData, PDFEngineV2.generateHTML
 */
/**
 * ============================================================
 * PDF ENGINE V2 - GSTART PROJECT
 * ============================================================
 * Moteur de rendu PDF et Aperçu basé sur HTML.
 */

// Parse JSON tolérant : retourne le fallback si la donnée est corrompue
function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (e) { console.warn('[PDF] JSON corrompu ignoré:', e); return fallback; }
}

const PDFEngineV2 = {
    // --- CONFIGURATION ---
    options: {
        margin: 0,
        filename: 'Ordre_Initial.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            logging: true, // Activé pour diagnostic
            allowTaint: true
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    },

    /**
     * Lance l'aperçu dans la modale de présentation.
     */
    async openPreview() {
        const presentationContent = document.getElementById('presentation-content');
        if (!presentationContent) return;

        try {
            presentationContent.innerHTML = '<div style="text-align:center; padding: 40px;"><h3>Génération de l\'aperçu...</h3><p>Veuillez patienter.</p></div>';

            // 1. Collecter les données
            const data = await this.collectAllData();

            // 2. Générer le HTML (on respecte le format choisi pour un aperçu fidèle)
            const is169 = (window.pdfOutputFormat === '16:9');
            const pageOpts = is169 ? { pageW: 338, pageH: 190.125 } : { pageW: 297, pageH: 210 };
            const htmlContent = this.generateHTML(data, true, pageOpts);

            // 3. Injecter
            presentationContent.innerHTML = htmlContent;

            // 4. Anti-débordement : ajuste chaque page pour un aperçu fidèle au PDF
            const pages = Array.from(presentationContent.querySelectorAll('.pdf-page'));
            const imgs = presentationContent.querySelectorAll('img');
            await Promise.all(Array.from(imgs).map(img => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            pages.forEach((pageEl, idx) => this._fitPageToBudget(pageEl, idx));
        } catch (error) {
            console.error("Preview Error:", error);
            presentationContent.innerHTML = '<div style="color:red; padding: 20px;">Erreur lors de la génération de l\'aperçu.</div>';
        }
    },

    /**
     * Télécharge le PDF - Version V4 (Rendu indépendant par page).
     * Cette méthode est la plus robuste : elle capture chaque page séparément dans un canvas dédié.
     */
    async downloadOiPdf() {
        console.group("🚀 [PDF ENGINE V4] - Démarrage de la génération");
        const startTime = Date.now();

        const loader = document.getElementById('pdfLoadingModal');
        const statusText = document.getElementById('pdfLoadingStatus');
        const updateStatus = (msg) => { if (statusText) statusText.textContent = msg; };

        // 0. Fermer l'aperçu si ouvert
        const previewModal = document.getElementById('presentationModal');
        if (previewModal && previewModal.open) {
            previewModal.close();
            document.body.classList.remove('modal-open');
        }

        // Afficher loader
        if (loader) loader.style.display = 'flex';
        updateStatus("Initialisation moteur...");

        try {
            // Détection robuste des librairies (Umd vs Global)
            const jsPDFLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
            const html2canvasLib = window.html2canvas || null;

            if (!jsPDFLib) {
                console.error("❌ Librairie jsPDF non trouvée.");
                throw new Error("Librairie jsPDF manquante.");
            }
            if (!html2canvasLib) {
                console.error("❌ Librairie html2canvas non trouvée.");
                throw new Error("Librairie html2canvas manquante.");
            }

            // 1. Collecte & Préparation
            updateStatus("Collecte des données...");
            const data = await this.collectAllData();

            // --- Format PDF sélectionné ---
            const is169 = (window.pdfOutputFormat === '16:9');
            // A4 landscape: 297×210mm | 16:9: 338×190.125mm (exactement 16/9)
            const PAGE_W = is169 ? 338   : 297;
            const PAGE_H = is169 ? 190.125 : 210;

            updateStatus("Génération du squelette...");
            const htmlContent = this.generateHTML(data, false, { pageW: PAGE_W, pageH: PAGE_H });

            // 2. Injection DOM temporaire
            const tempContainer = document.createElement('div');
            tempContainer.id = 'pdf-render-temp-worker';
            tempContainer.style.cssText = `
                position: fixed; top: 0; left: 0; width: ${PAGE_W}mm; background: white;
                z-index: -9999; visibility: visible !important; display: block !important;
                opacity: 0 !important; pointer-events: none;
            `;
            tempContainer.innerHTML = htmlContent;
            document.body.appendChild(tempContainer);

            // 3. Synchronisation globale (Polices)
            updateStatus("Chargement des polices...");
            if (document.fonts) await document.fonts.ready;

            // Trouver toutes les pages
            const pageElements = Array.from(tempContainer.querySelectorAll('.pdf-page'));
            if (pageElements.length === 0) throw new Error("Aucune page HTML générée.");

            // 4. Initialisation du document PDF
            const doc = new jsPDFLib({
                orientation: 'landscape',
                unit: 'mm',
                format: is169 ? [PAGE_W, PAGE_H] : 'a4',
                compress: true
            });

            // 5. BOUCLE DE RENDU INDÉPENDANTE
            const N = pageElements.length;
            // OI7 — échelle de rendu ADAPTATIVE au nombre de pages : scale 2 × beaucoup
            // de pages sature la mémoire WebKit (crash / pages blanches sur mobile). On
            // réduit progressivement tout en gardant une résolution largement lisible.
            const renderScale = N > 20 ? 1.5 : (N > 10 ? 1.75 : 2);
            let blankPages = 0;

            for (let i = 0; i < N; i++) {
                const isCover = (i === 0);
                updateStatus(isCover ? "Rendu : Couverture..." : `Rendu : Page ${i + 1}/${N}...`);

                const pageEl = pageElements[i];

                // Attendre le décodage des images
                const pageImgs = Array.from(pageEl.querySelectorAll('img'));
                await Promise.all(pageImgs.map(img => {
                    if (img.complete) return Promise.resolve();
                    return img.decode().catch(e => console.warn("Page img fail", e));
                }));

                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

                // Anti-débordement : ajuste le contenu pour qu'il rentre dans la page
                this._fitPageToBudget(pageEl, i);

                // Capture de la page
                const canvas = await html2canvasLib(pageEl, {
                    scale: renderScale,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    width: pageEl.offsetWidth,
                    height: pageEl.offsetHeight,
                    scrollX: 0,
                    scrollY: 0
                });

                let imgData = canvas.toDataURL('image/jpeg', 0.95);

                // OI7 — détecter un rendu VIDE (canvas 0×0 / mémoire insuffisante / tainted)
                // au lieu d'ajouter une page blanche et d'annoncer un faux « succès ».
                if (!imgData || imgData.length < 100) {
                    blankPages++;
                    console.error(`[PDF] Page ${i + 1}/${N} : rendu vide (${imgData ? imgData.length : 0} octets) — mémoire probablement insuffisante.`);
                }

                if (i > 0) doc.addPage();
                doc.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');

                canvas.width = 0;
                canvas.height = 0;
                imgData = null; // libère le dataURL pour le GC entre pages
                // Micro-pause sur les gros documents : laisse le navigateur respirer
                // (et le GC récupérer) avant la page suivante.
                if (N > 8) await new Promise(r => setTimeout(r, 0));
            }

            // 6. Sauvegarde
            updateStatus("Assemblage final...");
            const fileName = `OI_${(data.formData.date_op || 'SANS_DATE').replace(/\//g, '-')}_${data.formData.trigramme_redacteur || 'RED'}.pdf`;
            doc.save(fileName);

            console.log(`✅ [SUCCESS] PDF V4 généré en ${((Date.now() - startTime) / 1000).toFixed(2)}s (échelle ${renderScale}, ${blankPages} page(s) vide(s))`);
            // OI7 — ne pas annoncer un succès si des pages n'ont pas pu être rendues.
            if (typeof toast === 'function') {
                if (blankPages > 0) {
                    toast(`PDF généré, mais ${blankPages} page(s) n'ont pas pu être rendues (mémoire insuffisante). Réduisez le nombre/poids des photos ou scindez l'OI.`, "error");
                } else {
                    toast("PDF généré avec succès !", "success");
                }
            }

        } catch (error) {
            console.error("❌ [CRITICAL V4] PDF Engine Failed:", error);
            if (typeof toast === 'function') toast("Erreur de génération. Veuillez consulter les logs.", "error");
        } finally {
            if (loader) loader.style.display = 'none';
            const el = document.getElementById('pdf-render-temp-worker');
            if (el) el.remove();
            console.groupEnd();
        }
    },

    async collectAllData() {
        console.log("📸 Début collecte exhaustive des données et fusion des annotations...");
        const formData = JSON.parse(JSON.stringify(Store.state.formData));
        const photosBase64 = {};

        if (formData.dynamic_photos) {
            const promises = [];
            for (const category in formData.dynamic_photos) {
                formData.dynamic_photos[category].forEach(photoMeta => {
                    promises.push((async () => {
                        try {
                            const blob = await dbManager.getItem(photoMeta.id);
                            if (blob) {
                                let finalBlob = blob;
                                // Fusion des annotations si présentes
                                const annotations = safeJsonParse(photoMeta.annotations || '[]', []);
                                if (annotations.length > 0 && typeof createAnnotatedImageBlob === 'function') {
                                    console.log(`🎨 Fusion annotations pour ${photoMeta.id}...`);
                                    try {
                                        finalBlob = await createAnnotatedImageBlob(blob, annotations);
                                    } catch (err) {
                                        console.warn(`Échec fusion annotations pour ${photoMeta.id}, utilisation original.`, err);
                                    }
                                }
                                photosBase64[photoMeta.id] = await this.blobToBase64(finalBlob);
                                console.log(`✓ Photo préparée: ${photoMeta.id} (${category})`);
                            } else {
                                console.warn(`⚠ Photo non trouvée dans DB: ${photoMeta.id}`);
                            }
                        } catch (e) { console.error(`✗ Erreur préparation photo ${photoMeta.id}`, e); }
                    })());
                });
            }
            await Promise.all(promises);
        }

        // --- NOUVEAU: Collecte du fond personnalisé ---
        try {
            const customBg = await dbManager.getItem('custom_pdf_background');
            if (customBg) {
                photosBase64['custom_pdf_background'] = await this.blobToBase64(customBg);
                console.log("✓ Fond personnalisé chargé (DB).");
            }
        } catch (e) { console.warn("Erreur chargement fond personnalisé (PDF Engine):", e); }

        console.log(`📸 Fin collecte. ${Object.keys(photosBase64).length} photos prêtes pour le rendu.`);
        return {
            formData, photosBase64,
            isDark: formData.pdf_theme === 'dark' || (formData.pdf_theme !== 'light' && document.body.classList.contains('dark-mode'))
        };
    },

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    /**
     * Anti-débordement d'une page PDF.
     * Mesure la hauteur réelle du contenu en flux ; s'il dépasse la hauteur
     * disponible de la page, enveloppe le contenu et applique un scale()
     * pour le faire rentrer (jamais en dessous de MIN_SCALE — au-delà on
     * journalise un avertissement). Les éléments en position absolue
     * (filigrane, pied de page) sont laissés en place et non mis à l'échelle.
     * Idempotent : un 2e appel sur la même page ne refait pas le wrapping.
     * @param {HTMLElement} pageEl - l'élément .pdf-page
     * @param {number} pageIndex - index de la page (pour le message d'avertissement)
     * @returns {boolean} true si la page a dû être réduite
     */
    _fitPageToBudget(pageEl, pageIndex) {
        if (!pageEl) return false;
        const MIN_SCALE = 0.62;

        let inner = pageEl.querySelector(':scope > .pdf-page-fit');
        if (!inner) {
            inner = document.createElement('div');
            inner.className = 'pdf-page-fit';
            inner.style.cssText = 'display:flex; flex-direction:column; width:100%; flex-shrink:0; transform-origin: top left;';
            // Déplacer uniquement le contenu EN FLUX dans le wrapper ;
            // on laisse les éléments absolus (filigrane, footer) en place.
            Array.from(pageEl.childNodes).forEach(node => {
                if (node.nodeType === 1) {
                    const pos = getComputedStyle(node).position;
                    if (pos === 'absolute' || pos === 'fixed') return;
                }
                inner.appendChild(node);
            });
            pageEl.appendChild(inner);
        }

        const cs = getComputedStyle(pageEl);
        const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const avail = pageEl.clientHeight - padV;
        const needed = inner.scrollHeight;

        if (avail > 0 && needed > avail + 1) {
            const scale = Math.max(MIN_SCALE, avail / needed);
            inner.style.transform = `scale(${scale})`;
            inner.style.width = (100 / scale) + '%';
            if (scale <= MIN_SCALE + 0.001) {
                console.warn(`[PDF] Page ${pageIndex + 1} : contenu très dense (réduit à ${Math.round(scale * 100)}%). Envisagez d'alléger ou de scinder ce bloc.`);
            }
            return true;
        }
        return false;
    },

    /**
     * @param {Boolean} isPreview Si true, adapte le CSS pour un affichage web sans marges mm strictes.
     */
    generateHTML(data, isPreview = false, pageOptions = {}) {
        const { formData, photosBase64, isDark } = data;
        const PAGE_W_MM = pageOptions.pageW || 297;
        const PAGE_H_MM = pageOptions.pageH || 210;
        const is169 = PAGE_W_MM > 300;

        // --- BUDGETS VERTICAUX DYNAMIQUES ---
        const MAX_GALLERY_IMG_H = is169 ? '108mm' : '130mm';
        const MAX_ADV_PORTRAIT_H = is169 ? '75mm' : '90mm';
        const CARD_MARGIN_B = is169 ? '8px' : '15px';
        const H2_MARGIN_T = is169 ? '12px' : '20px';
        const H2_MARGIN_B = is169 ? '10px' : '15px';

        const colors = isDark ? {
            bg: '#0a0a0c', bgCard: '#121214', text: '#ffffff', textMuted: '#a1a1aa',
            accent: '#3b82f6', border: '#3f3f46', danger: '#ef4444', header: '#1a1a1a',
            warning: '#eab308'
        } : {
            bg: '#ffffff', bgCard: '#ffffff', text: '#000000', textMuted: '#71717a',
            accent: '#2563eb', border: '#e4e4e7', danger: '#dc2626', header: '#f8fafc',
            warning: '#eab308'
        };

        const pageStyle = isPreview
            ? `width: 100%; max-width: 1000px; margin: 0 auto 30px auto; aspect-ratio: ${PAGE_W_MM} / ${PAGE_H_MM}; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border-radius: 12px;`
            : `width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; page-break-after: always;`;
        // En 16:9, on réduit légèrement les marges pour maximiser le contenu
        const pagePadding = PAGE_W_MM > 300 ? '10mm 16mm' : '15mm 20mm';

        const css = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Oswald:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap');
                
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
                
                .pdf-export-container { 
                    font-family: 'Inter', system-ui, sans-serif; 
                    margin: 0; padding: ${isPreview ? '20px' : '0'}; 
                    background: ${colors.bg}; 
                    color: ${colors.text} !important; 
                    font-size: ${is169 ? '10pt' : '11pt'}; line-height: 1.4; 
                    width: 100%;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }
                .pdf-page { 
                    ${pageStyle}
                    padding: ${pagePadding}; position: relative; display: flex !important; flex-direction: column; 
                    background: ${colors.bg}; border: 1px solid ${colors.border};
                    overflow: hidden;
                    box-sizing: border-box;
                }
                .pdf-page:last-child { page-break-after: auto; }
                h1, h2, h3 { 
                    font-family: 'Oswald', sans-serif; 
                    text-transform: uppercase; 
                    margin: 0; 
                    font-weight: 700;
                    -webkit-text-fill-color: initial !important;
                    -webkit-background-clip: initial !important;
                    background-clip: initial !important;
                }
                h1 { font-size: ${is169 ? '28pt' : '32pt'}; color: ${colors.accent} !important; background: transparent !important; }
                h2 { font-size: ${is169 ? '17pt' : '20pt'}; border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px; margin-bottom: ${H2_MARGIN_B}; margin-top: ${H2_MARGIN_T}; color: ${colors.accent} !important; }
                h3 { font-size: ${is169 ? '12pt' : '14pt'}; margin-bottom: 8px; color: ${colors.accent} !important; }
                .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; align-items: start; }
                /* min-width:0 indispensable : sans lui une chaîne sans espace ne peut pas
                   rétrécir sous sa largeur min-content et DÉBORDE la colonne/la carte. */
                .grid > * { min-width: 0; }
                .card {
                    background: ${isDark ? 'rgba(18, 18, 20, 0.85)' : 'rgba(255, 255, 255, 0.95)'};
                    border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)'};
                    border-radius: 16px;
                    padding: ${is169 ? '10px' : '15px'};
                    margin-bottom: ${CARD_MARGIN_B};
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
                    position: relative;
                    page-break-inside: avoid;
                    min-width: 0;
                    overflow-wrap: anywhere;
                }
                .patracdvr-table th { 
                    background: ${colors.header}; 
                    color: ${colors.accent}; 
                    font-size: 7.5pt; 
                    padding: 4px 2px; 
                    text-align: center;
                    border: 1px solid ${colors.border};
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .patracdvr-table td {
                    padding: 4px 3px;
                    border: 1px solid ${colors.border};
                    font-size: 7.5pt;
                    vertical-align: top;
                    word-break: break-word;
                    overflow-wrap: anywhere;
                }
                .label { font-weight: bold; color: ${colors.accent}; font-size: 9pt; text-transform: uppercase; display: block; margin-bottom: 3px; }
                .value { margin-bottom: 8px; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-size: 10pt; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; background: ${colors.bgCard}; table-layout: fixed; }
                th, td { border: 1px solid ${colors.border}; padding: 8px; text-align: left; word-wrap: break-word; overflow-wrap: break-word; overflow: hidden; }
                th { background: ${colors.header}; font-weight: bold; color: ${colors.accent}; font-size: 8pt; }
                tr { page-break-inside: avoid; }
                .photo-gallery-grid { display: grid; grid-template-columns: 1fr; gap: 15px; flex: 1; align-content: center; justify-items: center; }
                .photo-gallery-item { border: 2px solid ${colors.accent}; border-radius: 12px; overflow: hidden; background: #000; display: flex; flex-direction: column; width: 100%; max-width: 250mm; }
                .photo-item.landscape { height: 160mm; }
                .photo-item.portrait { height: auto; max-height: 180mm; }
                .photo-item img { width: 100%; height: 100%; object-fit: contain; }
                .photo-caption { 
                    padding: 8px 15px; font-size: 11pt; font-weight: bold; 
                    color: ${colors.accent}; background: ${isDark ? 'rgba(18,18,20,0.85)' : 'rgba(255,255,255,0.95)'}; 
                    text-align: center; border: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
                    border-radius: 8px; margin-top: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                }
                .photo-tools { padding: 6px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 100%; }
                .tool-badge { 
                    background: ${colors.warning}; 
                    color: ${isDark ? '#000000' : '#000000'}; 
                    padding: 4px 10px; border-radius: 6px; font-size: 10pt; 
                    font-weight: bold; border: 1px solid rgba(0,0,0,0.1);
                    display: inline-block; white-space: normal; line-height: 1.2;
                }
                .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
                .logo-container { width: 60mm; height: 30mm; display: flex; align-items: center; justify-content: center; }
                .logo-container img { max-width: 100%; max-height: 100%; }
                .header-info { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 10pt; line-height: 1.4; }
                .bg-watermark { 
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    width: 100%; height: 100%; object-fit: contain; 
                    opacity: 0.7; z-index: -1; 
                }
                .pdf-footer { 
                    position: absolute; bottom: 10mm; left: 15mm; right: 15mm; 
                    z-index: 10;
                }
                .footer-card {
                    background: ${isDark ? 'rgba(18, 18, 20, 0.85)' : 'rgba(255, 255, 255, 0.95)'}; 
                    border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)'}; 
                    border-radius: 12px;
                    padding: 8px 15px;
                    text-align: center;
                    font-size: 9pt;
                    font-family: 'JetBrains Mono', monospace;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 8pt; margin-right: 4px; background: ${colors.accent}; color: white; }
                .monospaced { font-family: 'JetBrains Mono', monospace; }
                .no-break { page-break-inside: avoid; }
                .cell-group { border: 1px solid ${colors.accent}; border-radius: 6px; padding: 8px; background: rgba(59, 130, 246, 0.05); margin-bottom: 8px; page-break-inside: avoid; }
                .cell-name { font-size: 0.7em; font-weight: bold; color: ${colors.accent}; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1px solid rgba(59, 130, 246, 0.2); }
                .cell-members { display: flex; flex-wrap: wrap; gap: 5px; }
                .patracdvr-table { font-size: 7.5pt !important; width: 100%; table-layout: fixed; }
                /* Spécifications techniques EFFRACTION : grille rétrécissable (min-width:0)
                   pour que les valeurs longues s'enroulent DANS la case au lieu de déborder. */
                .effrac-specs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .effrac-specs > div { min-width: 0; overflow-wrap: anywhere; }
                .effrac-specs .label { margin-bottom: 1px; }
            </style>
        `;

        const logoId = formData.dynamic_photos?.photo_logo_unite?.[0]?.id;
        let bgSrc = photosBase64['custom_pdf_background'] || (logoId ? photosBase64[logoId] : null);

        // --- MAPPING TRIGRAMME -> CELLULE ---
        const memberToCell = {};
        (formData.patracdvr_rows || []).forEach(row => {
            (row.members || []).forEach(m => {
                if (m.trigramme) memberToCell[m.trigramme] = m.cellule || 'NON ASSIGNÉ';
            });
        });

        // Helper regroupement par cellule
        const regroupByCell = (trigrammes) => {
            const groups = {};
            trigrammes.forEach(t => {
                const c = memberToCell[t] || 'SANS CELLULE';
                if (!groups[c]) groups[c] = [];
                groups[c].push(t);
            });
            return groups;
        };

        // Suppression du header global pour éviter le doublon d'image
        const headerHtml = '';

        const footerHtml = `
            <div class="pdf-footer">
                <div class="footer-card" style="color: ${isDark ? colors.textMuted : '#000000'}">
                    OI - ${formData.trigramme_redacteur || 'N/A'} - ${formData.unite_redacteur || 'N/A'} - <span style="color:${colors.danger}; font-weight: bold;">CONFIDENTIEL</span>
                </div>
            </div>
        `;
        let pages = '';

        // --- PAGE 1: GARDE ---
        pages += `
            <div class="pdf-page" style="border:none;">
                ${bgSrc ? `<img src="${bgSrc}" class="bg-watermark">` : ''}
                
                <!-- Metadata OP/DATE - Top Right Absolute Extreme -->
                <div style="position: absolute; top: 2mm; right: 2mm; z-index: 20;">
                    <div class="card" style="font-family: 'JetBrains Mono', monospace; font-size: 11pt; color: ${isDark ? colors.text : '#000000'}; text-align: right; padding: 5px 12px; margin:0; border-radius: 8px;">
                        <div style="font-weight: bold;">OP: ${formData.nom_operation || '-'}</div>
                        <div style="font-size: 0.9em; opacity: 0.8;">DATE: ${formData.date_op || '-'}</div>
                    </div>
                </div>

                <div style="margin-top: 35mm; display: flex; flex-direction: column; align-items: center; width: 100%;">
                    <div class="card" style="text-align: center; margin-bottom: 20mm; padding: 40px; width: 85%; background: ${isDark ? 'rgba(18,18,20,0.9)' : 'rgba(255,255,255,0.98)'};">
                        <h1 style="font-size: 42pt; color: ${colors.accent}; border:none; margin: 0; line-height: 1.1; background: transparent !important;">ORDRE INITIAL</h1>
                        <div style="width: 140mm; height: 3px; background: ${colors.accent}; margin: 25px auto; opacity: 0.2;"></div>
                    </div>
                </div>

                <div class="grid" style="margin-top: 0;">
                    <div class="card" style="background: ${colors.bgCard};">
                        <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px;">1. SITUATION GLOBALE</h3>
                        <div class="label" style="font-weight: bold; color: ${colors.accent}; margin-top: 10px;">SITUATION GÉNÉRALE</div>
                        <div class="value" style="margin-bottom: 10px; font-weight: bold;">${formData.situation_generale || '-'}</div>
                        <div class="label" style="font-weight: bold; color: ${colors.accent};">SITUATION PARTICULIÈRE</div>
                        <div class="value" style="font-weight: bold;">${formData.situation_particuliere || '-'}</div>
                    </div>
                    <div class="card" style="background: ${colors.bgCard};">
                        <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px;">CIBLES(S)</h3>
                        ${(formData.adversaries || []).length > 0 ? formData.adversaries.map(adv => `
                            <div style="border-bottom: 1px solid ${colors.border}; margin-bottom: 10px; padding-bottom: 10px; margin-top: 10px;">
                                <strong style="color: ${colors.accent}; font-size: 1.25em;">${adv.nom_adversaire || 'Inconnu'}</strong><br>
                                <span style="font-size: 1em; color:${colors.textMuted}; font-weight: bold;">${adv.stature_adversaire || ''} ${adv.ethnie_adversaire || ''}</span>
                            </div>
                        `).join('') : '<div class="value" style="margin-top: 10px; font-weight: bold;">Aucune cible renseignée.</div>'}
                    </div>
                </div>
            </div>
        `;

        // --- Helper: Galerie Photos (Une photo par page pour éviter les coupures) ---
        const renderGallery = (photoMetas, sectionTitle) => {
            if (!photoMetas || photoMetas.length === 0) return '';
            let galleryPages = '';

            photoMetas.forEach((p, idx) => {
                const tools = safeJsonParse(p.tools || '[]', []);

                // Calcul du ratio pour l'image
                const imgSrc = photosBase64[p.id] || '';

                galleryPages += `
                    <div class="pdf-page" style="display: flex; flex-direction: column; justify-content: flex-start; padding: ${pagePadding};">
                        <h2>${sectionTitle} (Photo ${idx + 1}/${photoMetas.length})</h2>
                        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; border: 2px solid ${colors.border}; border-radius: 12px; background: ${isDark ? 'rgba(18,18,20,0.8)' : 'rgba(255,255,255,0.8)'}; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
                            
                            <div style="display: flex; justify-content: center; align-items: center; width: 100%; height: ${MAX_GALLERY_IMG_H}; max-height: ${MAX_GALLERY_IMG_H};">
                                <img src="${imgSrc}" style="max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: 6px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); display: block; margin: 0 auto;">
                            </div>

                            <div class="photo-caption" style="margin-top: ${is169 ? '8px' : '15px'}; width: 95%; text-align: center; font-weight: bold; font-size: ${is169 ? '11pt' : '12pt'};">
                                ${p.customTitle || (sectionTitle + ' - Détail')}
                            </div>
                            ${(tools.length > 0 || p.other_tools) ? `
                                <div class="photo-tools" style="margin-top: ${is169 ? '5px' : '10px'}; text-align: center;">
                                    ${tools.map(t => `<span class="tool-badge" style="font-size: ${is169 ? '8pt' : '9pt'};">${t}</span>`).join('')}
                                    ${p.other_tools ? `<span class="tool-badge" style="border-style: dashed; font-size: ${is169 ? '8pt' : '9pt'};">${p.other_tools}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            return galleryPages;
        };

        // --- PAGE 2: ADVERSAIRES (DÉTAILLÉS) ---
        if (formData.adversaries && formData.adversaries.length > 0) {
            formData.adversaries.forEach((adv, idx) => {
                const mainPhotoId = formData.dynamic_photos?.[`photo_main_${adv.id}`]?.[0]?.id;
                const mainPhotoSrc = mainPhotoId ? photosBase64[mainPhotoId] : null;

                pages += `
                    <div class="pdf-page">
                        <h2>2.${idx + 1} FICHE ADVERSAIRE : ${adv.nom_adversaire || 'Inconnu'}</h2>
                        <div style="display: flex; gap: 15px; align-items: start;">
                            ${mainPhotoSrc ? `
                                <div style="width: 70mm; max-height: ${MAX_ADV_PORTRAIT_H}; border: 2px solid ${colors.accent}; border-radius: 8px; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #000;">
                                    <img src="${mainPhotoSrc}" style="max-width: 100%; max-height: ${MAX_ADV_PORTRAIT_H}; width: auto; height: auto; display: block;">
                                </div>
                            ` : ''}
                            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;">
                                <div class="card" style="padding: 10px; margin-bottom: 0;">
                                    <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 3px; margin: 0 0 5px 0; font-size: 11pt;">IDENTITÉ</h3>
                                    <div class="grid" style="gap: 5px;">
                                        <div>
                                            <span class="label">Naissance</span>
                                            <div class="value" style="font-size: 9pt;">${adv.date_naissance || '-'} @ ${adv.lieu_naissance || '-'}</div>
                                            <span class="label">Profession</span>
                                            <div class="value" style="font-size: 9pt;">${adv.profession_adversaire || '-'}</div>
                                            <span class="label">Situation familiale</span>
                                            <div class="value" style="font-size: 9pt;">${adv.situation_familiale || '-'}</div>
                                        </div>
                                        <div>
                                            <span class="label">Signalement</span>
                                            <div class="value" style="font-size: 9pt;">${adv.stature_adversaire || '-'} | ${adv.ethnie_adversaire || '-'}</div>
                                            <span class="label">Signes particuliers</span>
                                            <div class="value" style="font-size: 9pt;">${adv.signes_particuliers || 'Ras'}</div>
                                            <span class="label">Substances</span>
                                            <div class="value" style="font-size: 9pt;">${adv.substances_adversaire || '-'}</div>
                                        </div>
                                    </div>
                                    ${(adv.me_list && adv.me_list.length > 0) ? `<span class="label" style="margin-top:5px;">Moyens Employés</span><div class="value" style="font-size:9pt;">${adv.me_list.join(' / ')}</div>` : ''}
                                </div>
                                <div class="card" style="padding: 10px; margin-bottom: 0;">
                                    <h3 style="border-bottom: 2px solid ${colors.danger}; padding-bottom: 3px; margin: 0 0 5px 0; font-size: 11pt;">DANGEROSITÉ</h3>
                                    <span class="label">Armes Connues</span>
                                    <div class="value" style="color:${colors.danger}; font-weight:bold; font-size: 10pt;">${adv.armes_connues || '-'}</div>
                                    <span class="label">Dangerosité / ATCD</span>
                                    <div class="value" style="font-size: 9pt;">${adv.antecedents_adversaire || '-'}</div>
                                </div>
                            </div>
                        </div>
                        <div class="grid" style="margin-top: 5px; gap: 10px;">
                            <div class="card" style="padding: 10px;">
                                <h3 style="font-size: 10pt; margin:0 0 5px 0;">LOCALISATION</h3>
                                <div class="label">Domicile</div>
                                <div class="value" style="font-size: 9pt;">${adv.domicile_adversaire || '-'}</div>
                                <div class="label">Volume / Esprit</div>
                                <div class="value" style="font-size: 9pt;">${(adv.volume_list || []).join(', ')} | ${(adv.etat_esprit_list || []).join(', ')}</div>
                            </div>
                            <div class="card" style="padding: 10px;">
                                <h3 style="font-size: 10pt; margin:0 0 5px 0;">MOBILITÉ</h3>
                                <div class="label">Véhicules / Plaques</div>
                                <div class="value monospaced" style="font-size: 9pt;">${(adv.vehicules_list || []).join(' | ') || '-'}</div>
                                <div class="label">Attitude Attendue</div>
                                <div class="value" style="font-size: 9pt;">${adv.attitude_adversaire || '-'}</div>
                            </div>
                        </div>
                    </div>
                `;

                // Galerie Photos Supplémentaires (Extra + Renforts) pour cet adversaire
                const extraPhotos = formData.dynamic_photos?.[`photo_extra_${adv.id}`] || [];
                const renfortPhotos = formData.dynamic_photos?.[`photo_renforts_${adv.id}`] || [];

                if (extraPhotos.length > 0) {
                    pages += renderGallery(extraPhotos, `Adversaire : ${adv.nom_adversaire || 'Individu'} (Photos annexes)`);
                }
                if (renfortPhotos.length > 0) {
                    pages += renderGallery(renfortPhotos, `Adversaire : ${adv.nom_adversaire || 'Individu'} (Renfort possible)`);
                }
            });
        }

        pages += `
            <div class="pdf-page">
                <h2>3. ENVIRONNEMENT ET AMIS</h2>
                <div class="grid">
                    <div class="card">
                        <div class="label">Forces Amies / Concours</div><div class="value">${formData.amies || '-'}</div>
                        <div class="label">Terrain / Météo</div><div class="value">${formData.terrain_info || '-'}</div>
                        <div class="label">Éclairage</div><div class="value">${formData.eclairage || '-'}</div>
                        <div class="label">Lever du soleil</div><div class="value">${formData.lever_soleil || '-'}</div>
                    </div>
                    <div class="card">
                        <div class="label">Population / Voisinage</div><div class="value">${formData.population || '-'}</div>
                        <div class="label">Faune / Animaux</div><div class="value">${formData.faune_animaux || '-'}</div>
                        <div class="label">Cadre Juridique</div><div class="value">${formData.cadre_juridique || '-'}</div>
                    </div>
                </div>
                <div class="grid" style="margin-top: 10px;">
                    <div class="card">
                        <div class="label">Accès Principal</div><div class="value">${formData.acces_principal || '-'}</div>
                    </div>
                    <div class="card">
                        <div class="label">Cheminement Initial</div><div class="value">${formData.cheminement_initial || '-'}</div>
                    </div>
                </div>
            </div>

            <div class="pdf-page">
                <h2>4. MISSION DE L'UNITÉ</h2>
                <div class="card" style="border-left: 10px solid ${colors.accent}; padding: ${is169 ? '25px 30px' : '40px'}; background: ${colors.header}; min-height: ${is169 ? '65mm' : '80mm'};">
                    <div class="value" style="font-size: ${is169 ? '1.5em' : '1.8em'}; font-weight: 800; font-family: 'Inter', sans-serif; text-align: left; line-height: 1.6; white-space: pre-wrap;">${formData.missions_psig || '-'}</div>
                </div>
            </div>
        `;

        // --- PAGE 4: EXÉCUTION ---
        pages += `
            <div class="pdf-page">
                <h2>5. EXÉCUTION</h2>
                <div style="display: flex; gap: 20px; margin-bottom: 10px;">
                    <div><span class="label">Date d'exécution</span><span class="value monospaced">${formData.date_execution || '-'}</span></div>
                    <div><span class="label">Heure H</span><span class="value monospaced" style="font-size:1.2em; font-weight:bold; color:${colors.accent};">${formData.heure_execution || '-'}</span></div>
                </div>
                <div class="label">Idée de Manœuvre / Action</div><div class="value">${formData.action_body_text || '-'}</div>
                <div class="grid">
                    <div class="card"><h3>Chronologie Prévisionnelle</h3><table><thead><tr><th style="width:80px;">Heure</th><th>Événement</th></tr></thead><tbody>
                        ${(formData.time_events || []).length > 0 ? formData.time_events.map(ev => `<tr><td class="monospaced">${ev.hour || ''}</td><td><strong>${ev.type || ''}</strong> : ${ev.description || ''}</td></tr>`).join('') : '<tr><td colspan="2">N/A</td></tr>'}
                    </tbody></table></div>
                    <div class="card"><h3>Hypothèses d'ensemble</h3>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${(formData.hypotheses || []).length > 0 ? formData.hypotheses.map((h, i) => `
                                <div style="background: ${colors.bg}; border-left: 4px solid ${colors.accent}; padding: 8px; border-radius: 4px;">
                                    <span style="font-size: 0.8em; color: ${colors.textMuted}; font-weight: bold;">H${i + 1} :</span> ${h}
                                </div>
                            `).join('') : '<div class="value">-</div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // --- SECTION NOUVELLE: LOGISTIQUE & TRANSPORTS (Entre 5 et 6) ---
        const log_photos = [
            ...(formData.dynamic_photos?.['photo_container_transport_pr_preview_container'] || []),
            ...(formData.dynamic_photos?.['photo_container_transport_domicile_preview_container'] || [])
        ];
        if (log_photos.length > 0) {
            pages += renderGallery(log_photos, "6. LOGISTIQUE & TRANSPORTS (Cheminement)");
        }

        // --- PAGE 5: ARTICULATION (Désormais 7) ---
        pages += `
            <div class="pdf-page">
                <h2>7. ARTICULATION & ORDRES DE MOUVEMENT</h2>
                <div class="grid">
                    <div class="card"><h3>Ordre Rame VL</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.rame_vl_order || []).length > 0 ? formData.rame_vl_order.map((vl, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i + 1}</strong> ${vl}</div>`).join('') : '-'}
                    </div></div>
                    <div class="card"><h3>Colonne Progression</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.colonne_progression_order || []).length > 0 ? formData.colonne_progression_order.map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i + 1}</strong> ${m}</div>`).join('') : '-'}
                    </div></div>
                </div>
                <div class="card no-break"><h3>Ordre de Pénétration</h3><div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${(formData.ordre_penetration_order || []).length > 0 ? formData.ordre_penetration_order.map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 10px 15px; font-size: 1.2em; font-weight: bold; background: ${colors.header};"><span style="font-size: 0.8em; color: ${colors.textMuted}; display: block;">${i + 1}</span> ${m}</div>`).join('') : '-'}
                </div><div style="margin-top: 15px; font-weight: bold;">PLACE DU CHEF : <span style="color:${colors.accent}">${formData.place_chef || '-'}</span></div></div>
            </div>
        `;

        // --- BLOCS ARTICULATION GROUPÉS PAR INDEX (ZMSPCP[i] + MOICP[i] + EFFRAC[i]) ---
        // Ordre par bloc ZMSPCP : Baptême Terrain → page ZMSPCP → Emplacement AO
        const moicpBlocks = formData.moicp_blocks || [];
        const zmspcpBlocks = formData.zmspcp_blocks || [];
        const effracBlocks = formData.effraction_blocks || [];
        const maxBlocks = Math.max(moicpBlocks.length, zmspcpBlocks.length, effracBlocks.length);

        for (let i = 0; i < maxBlocks; i++) {
            // --- ZMSPCP[i] ---
            const zmspcpBlock = zmspcpBlocks[i];
            if (zmspcpBlock) {
                const cellGroups = regroupByCell(zmspcpBlock.members || []);
                // Photos « Baptême Terrain » — placées JUSTE AU-DESSUS de la page ZMSPCP
                // (quel que soit leur nombre), avant le bloc d'articulation.
                const bapteme = formData.dynamic_photos?.['photo_bapteme_' + zmspcpBlock.id] || [];
                pages += renderGallery(bapteme, `Baptême Terrain — ${zmspcpBlock.title || '-'}`);
                pages += `
                    <div class="pdf-page"><h2>Articulation : ZMSPCP - ${zmspcpBlock.title || '-'}</h2><div class="grid">
                        <div class="card"><h3>ZMSPCP</h3>
                            <div class="label">Z zone</div><div class="value">${zmspcpBlock.zone || '-'}</div>
                            <div class="label">M mission</div><div class="value">${zmspcpBlock.mission || '-'}</div>
                            <div class="label">S secteur</div><div class="value">${zmspcpBlock.secteur || '-'}</div>
                            <div class="label">P points particuliers</div><div class="value">${zmspcpBlock.points_particuliers || '-'}</div>
                            <div class="label">C conduite à tenir</div><div class="value">${zmspcpBlock.cat || '-'}</div>
                        </div>
                        <div class="card"><h3>Composition par Cellule</h3>
                            ${Object.entries(cellGroups).map(([cell, items]) => `
                                <div class="cell-group">
                                    <div class="cell-name">${cell}</div>
                                    <div class="cell-members">${items.map(m => `<span class="badge">${m}</span>`).join('')}</div>
                                </div>
                            `).join('')}
                            <div style="margin-top: 10px;"><span class="label">Place du Chef</span> ${zmspcpBlock.place_chef || '-'}</div>
                        </div>
                    </div></div>
                `;
                // Photos « Emplacement AO » — placées JUSTE EN DESSOUS de la page ZMSPCP
                const empl_ao = formData.dynamic_photos?.['photo_empl_ao_' + zmspcpBlock.id] || [];
                pages += renderGallery(empl_ao, `ZMSPCP : ${zmspcpBlock.title || '-'} (Emplacement AO)`);
            }

            // --- MOICP[i] ---
            const moicpBlock = moicpBlocks[i];
            if (moicpBlock) {
                const cellGroups = regroupByCell(moicpBlock.members || []);
                pages += `
                    <div class="pdf-page"><h2>Articulation : MOICP - ${moicpBlock.title || '-'}</h2><div class="grid">
                        <div class="card"><h3>MOICP</h3>
                            <div class="label">M mission</div><div class="value">${moicpBlock.mission || '-'}</div>
                            <div class="label">O objectif</div><div class="value">${moicpBlock.objectif || '-'}</div>
                            <div class="label">I itinéraire</div><div class="value">${moicpBlock.itineraire || '-'}</div>
                            <div class="label">P points particuliers</div><div class="value">${moicpBlock.points_particuliers || '-'}</div>
                            <div class="label">C conduite à tenir</div><div class="value">${moicpBlock.cat || '-'}</div>
                        </div>
                        <div class="card"><h3>Composition par Cellule</h3>
                            ${Object.entries(cellGroups).map(([cell, items]) => `
                                <div class="cell-group">
                                    <div class="cell-name">${cell}</div>
                                    <div class="cell-members">${items.map(m => `<span class="badge">${m}</span>`).join('')}</div>
                                </div>
                            `).join('')}
                            <div style="margin-top: 10px;"><span class="label">Place du Chef</span> ${moicpBlock.place_chef || '-'}</div>
                        </div>
                    </div></div>
                `;
                // Photos MOICP: Extérieur d'abord, puis Intérieur
                const photoExt = formData.dynamic_photos?.['photo_itin_ext_' + moicpBlock.id] || [];
                const photoInt = formData.dynamic_photos?.['photo_itin_int_' + moicpBlock.id] || [];
                pages += renderGallery([...photoExt, ...photoInt], `MOICP : ${moicpBlock.title || '-'}`);
            }

            // --- EFFRAC[i] ---
            const effracBlock = effracBlocks[i];
            if (effracBlock) {
                const photoMeta = formData.dynamic_photos?.['photo_effrac_' + effracBlock.id]?.[0];
                const doorPhotoSrc = photoMeta ? photosBase64[photoMeta.id] : null;
                const tools = photoMeta ? safeJsonParse(photoMeta.tools || '[]', []) : [];
                const EFFRAC_TOP_H = is169 ? '65mm' : '75mm';

                pages += `
                    <div class="pdf-page" style="overflow: hidden;">
                        <h2 style="margin-bottom: ${is169 ? '5px' : '8px'};">Articulation : EFFRACTION - ${effracBlock.title || '-'}</h2>
                        <div style="display: flex; gap: 15px; align-items: start; margin-bottom: ${is169 ? '5px' : '10px'};">
                            ${doorPhotoSrc ? `
                                <div style="width: 70mm; height: ${EFFRAC_TOP_H}; border: 2px solid ${colors.accent}; border-radius: 12px; overflow: hidden; flex-shrink: 0; background: #000; display:flex; align-items:center; justify-content:center; position: relative;">
                                    <img src="${doorPhotoSrc}" style="max-width: 100%; max-height: 100%; width: auto; height: auto; display: block;">
                                    <div style="position:absolute; bottom:0; left:0; right:0; display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; padding: 4px; background: rgba(0,0,0,0.8); border-top: 1px solid ${colors.accent};">
                                        ${tools.length > 0 ? tools.map(t => `<span class="tool-badge" style="padding: 2px 6px; font-size: 8pt;">${t}</span>`).join('') : '<span style="color:#fff; font-size: 7pt; font-weight:bold;">PORTE</span>'}
                                    </div>
                                </div>
                            ` : ''}
                            <div style="flex: 1; min-width: 0;">
                                <div class="card" style="padding: ${is169 ? '8px' : '10px'}; min-height: ${EFFRAC_TOP_H};">
                                    <h3 style="margin-top:0; font-size: ${is169 ? '11pt' : '13pt'};">Caractéristiques Techniques</h3>
                                    <div class="effrac-specs" style="gap: ${is169 ? '4px' : '8px'}; font-size: ${is169 ? '0.8em' : '0.85em'};">
                                        <div><span class="label">Structure</span> ${effracBlock.structure || '-'}</div>
                                        <div><span class="label">Serrurerie</span> ${effracBlock.serrurerie || '-'}</div>
                                        <div><span class="label">Environnement</span> ${effracBlock.environnement || '-'}</div>
                                        <div><span class="label">Bâti à Bâti</span> ${effracBlock.bati_a_bati || '-'} mm</div>
                                        <div><span class="label">Dormant à Dormant</span> ${effracBlock.dormant_a_dormant || '-'} mm</div>
                                        <div><span class="label">Prof. Linteaux</span> ${effracBlock.prof_linteaux || '-'} mm</div>
                                        <hr style="grid-column: span 2; border: 0; border-top: 1px dashed ${colors.border}; margin: 4px 0;">
                                        <div><span class="label">H. Porte</span> ${effracBlock.h_porte || '-'}</div>
                                        <div><span class="label">H. Marche</span> ${effracBlock.h_marche || '-'}</div>
                                        <div style="grid-column: span 2;"><span class="label">Prof. Bâti</span> ${effracBlock.prof_bati || '-'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="card" style="margin-top: 0; padding: ${is169 ? '8px' : '12px'};">
                            <h3 style="margin: 5px 0; font-size: ${is169 ? '11pt' : '13pt'};">Hypothèses d'Effraction</h3>
                            <table style="font-size: ${is169 ? '0.75em' : '0.8em'}; table-layout: fixed; width: 100%;">
                                <thead><tr><th style="width:20%;">Hypothèse</th><th style="width:30%;">Technique / Moyen</th><th style="width:25%;">Dégagement</th><th style="width:25%;">Assaut</th></tr></thead>
                                <tbody>
                                    ${(effracBlock.hypotheses || []).length > 0 ? effracBlock.hypotheses.map(h => `
                                        <tr>
                                            <td style="font-weight: bold; color:${colors.accent}; word-wrap: break-word;">${h.title || h.id}</td>
                                            <td style="word-wrap: break-word;">${h.effrac || '-'}</td>
                                            <td style="word-wrap: break-word;">${h.degag || '-'}</td>
                                            <td style="word-wrap: break-word;">${h.assaut || '-'}</td>
                                        </tr>
                                    `).join('') : '<tr><td colspan="4">Aucune hypothèse saisie</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                const allEffracPhotos = formData.dynamic_photos?.['photo_effrac_' + effracBlock.id] || [];
                pages += renderGallery(allEffracPhotos, `Effraction : ${effracBlock.title || '-'}`);
            }
        }

        // (Baptême Terrain & Emplacement AO sont désormais rendus dans la boucle,
        //  respectivement juste au-dessus et juste en dessous de chaque page ZMSPCP.)

        // --- PAGE: CONDUITES GÉNÉRALES / NO-GO / LIAISON ---
        const hasCatPage = formData.cat_generales || formData.no_go || formData.cat_liaison;
        if (hasCatPage) {
            pages += `
                <div class="pdf-page">
                    <h2>8. CONDUITES À TENIR GÉNÉRALES</h2>
                    <div class="grid">
                        <div class="card" style="border-left: 4px solid ${colors.accent};">
                            <h3>CAT Générales</h3>
                            <div class="value" style="white-space: pre-wrap;">${formData.cat_generales || '-'}</div>
                        </div>
                        <div class="card" style="border-left: 4px solid ${colors.danger};">
                            <h3 style="color: ${colors.danger};">Conditions de Désengagement (NO-GO)</h3>
                            <div class="value" style="color:${colors.danger}; font-weight:bold; white-space: pre-wrap;">${formData.no_go || '-'}</div>
                        </div>
                    </div>
                    <div class="card" style="margin-top: 10px; border-left: 4px solid ${colors.warning};">
                        <h3>Liaison</h3>
                        <div class="value" style="white-space: pre-wrap;">${formData.cat_liaison || '-'}</div>
                    </div>
                </div>
            `;
        }

        // --- PAGE PATRACDVR ---
        const renderPatracdvr = () => {
            const allMembers = (formData.patracdvr_rows || []).flatMap(row =>
                row.members.map((m, idx) => ({ ...m, vehicle: idx === 0 ? row.vehicle : '', count: row.members.length, isFirst: idx === 0 }))
            );

            if (allMembers.length === 0) return '';

            // Calcul dynamique de la pagination pour séparer en deux si trop dense
            const hasDir = allMembers.some(m => m.dir && m.dir.trim() !== '');
            const hasLongEqpt = allMembers.some(m => [m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].join('').length > 40);

            let MAX_MEMBERS_PER_PAGE = 12;
            if (hasDir || hasLongEqpt) {
                // Si le tableau est lourd, on réduit les lignes pour ne pas écraser la hauteur lors du wrap textuel
                MAX_MEMBERS_PER_PAGE = 8;
            }

            let patracPages = '';

            for (let i = 0; i < allMembers.length; i += MAX_MEMBERS_PER_PAGE) {
                const batch = allMembers.slice(i, i + MAX_MEMBERS_PER_PAGE);
                patracPages += `
                    <div class="pdf-page">
                        <h2>7. RÉCAPITULATIF PATRACDVR ${allMembers.length > MAX_MEMBERS_PER_PAGE ? `(Partie ${Math.floor(i / MAX_MEMBERS_PER_PAGE) + 1})` : ''}</h2>
                        <div class="card" style="padding: 2px; min-height: 170mm; display: flex; flex-direction: column;">
                            <table class="patracdvr-table" style="width: 100%; table-layout: fixed;">
                                <thead>
                                    <tr>
                                        <th style="width:7%;">VL</th>
                                        <th style="width:7%;">PAX</th>
                                        <th style="width:10%;">CELLULE</th>
                                        <th style="width:14%;">FONCTION</th>
                                        <th style="width:10%;">PPALE</th>
                                        <th style="width:10%;">SEC.</th>
                                        <th style="width:8%;">AFIS</th>
                                        <th style="width:${hasDir ? '28%' : '34%'};">EQPT/GREN.</th>
                                        ${hasDir ? '<th style="width:6%;">DIR</th>' : ''}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${batch.map(m => `
                                        <tr>
                                            <td style="font-weight: bold; background: ${m.vehicle ? colors.header : 'transparent'}; text-align: center; font-size: 1em;">${m.vehicle || ''}</td>
                                            <td style="font-weight: bold;">${m.trigramme || '-'}</td>
                                            <td>${m.cellule || '-'}</td>
                                            <td>${m.fonction || '-'}</td>
                                            <td>${m.principales || '-'}</td>
                                            <td>${m.secondaires || '-'}</td>
                                            <td>${m.afis || '-'}</td>
                                            <td style="font-size: 0.8em; word-wrap: break-word;">${[m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].filter(v => v && v !== 'Sans').join(', ') || '-'}</td>
                                            ${hasDir ? `<td class="monospaced" style="font-weight: bold; text-align: center;">${m.dir || ''}</td>` : ''}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
            return patracPages;
        };
        pages += renderPatracdvr();

        // --- DERNIÈRE PAGE: QUESTIONS ---
        pages += `
            <div class="pdf-page" style="border:none;">
                ${bgSrc ? `<img src="${bgSrc}" class="bg-watermark">` : ''}
                <div style="flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; width: 100%;">
                    <div class="card" style="padding: 50px 80px; text-align: center; width: 85%; background: ${isDark ? 'rgba(18,18,20,0.9)' : 'rgba(255,255,255,0.98)'};">
                        <h1 style="font-size: 44pt; margin:0; line-height: 1.1; color: ${colors.accent}; background: transparent !important;">AVEZ-VOUS DES QUESTIONS ?</h1>
                        <div style="width: 160mm; height: 4px; background: ${colors.accent}; margin: 35px auto; opacity: 0.15;"></div>
                    </div>
                </div>
                ${footerHtml}
            </div>
        `;

        return `
            <div class="pdf-export-container">
                ${css}
                <div class="pdf-content">
                    ${pages}
                </div>
            </div>
        `;
    }
};

window.PDFEngineV2 = PDFEngineV2;
window.downloadOiPdf = function () { PDFEngineV2.downloadOiPdf(); };
