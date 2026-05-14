import { Storage } from './storage.js';
import { ImageStore } from './imageStore.js';
import { PDF_PAX_COLORS, PHOTO_CATEGORIES, FREE_MODE_COLORS } from './config.js';

/**
 * Export PDF pour PC TAC utilisant pdf-lib
 * Structure multi-pages ordonnée et respect du thème (clair/sombre).
 */

export const PdfExport = {
    async buildPdf() {
        try {
            const { PDFDocument, rgb: pdfRgb, StandardFonts, PageSizes } = PDFLib;
            const pdfDoc = await PDFDocument.create();
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

            // Charger les données (les photos sont stockées en IndexedDB, on les hydrate)
            const logData = Storage.loadLogData();
            const adversaries = await ImageStore.hydrate(Storage.loadCollection('pcTacAdversaries'), 'photo');
            const hostages = await ImageStore.hydrate(Storage.loadCollection('pcTacHostages'), 'photo');
            const friends = Storage.loadCollection('pcTacFriends');
            const photos = await ImageStore.hydrate(Storage.loadCollection('pcTacPhotos'), 'data');

            // Détection du thème
            const isDarkMode = document.body.classList.contains('dark-mode');
            const themeColors = {
                background: isDarkMode ? pdfRgb(0.1, 0.1, 0.1) : pdfRgb(1, 1, 1),
                text: isDarkMode ? pdfRgb(0.9, 0.9, 0.9) : pdfRgb(0, 0, 0),
                line: isDarkMode ? pdfRgb(0.3, 0.3, 0.3) : pdfRgb(0.8, 0.8, 0.8),
                headerBg: isDarkMode ? pdfRgb(0.2, 0.2, 0.2) : pdfRgb(0.95, 0.95, 0.95),
                highlight: isDarkMode ? pdfRgb(0.15, 0.15, 0.15) : pdfRgb(0.98, 0.98, 0.98)
            };

            const context = {
                pdfDoc,
                helveticaFont: font,
                helveticaBoldFont: fontBold,
                fontSize: 9,
                lineHeight: 12,
                margin: 40,
                pageWidth: 0,
                pageHeight: 0,
                y: 0,
                currentPage: null,
                pageNumber: 0,
                colors: themeColors
            };

            // --- FONCTIONS UTILITAIRES ---
            const wrapText = (text, width, font, size) => {
                const words = (text || '').toString().split(' ');
                const lines = [];
                let currentLine = '';
                words.forEach(word => {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    if (font.widthOfTextAtSize(testLine, size) < width) {
                        currentLine = testLine;
                    } else {
                        lines.push(currentLine);
                        currentLine = word;
                    }
                });
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            const addNewPage = (title, isLandscape = false) => {
                context.currentPage = pdfDoc.addPage(isLandscape ? PageSizes.A4.slice().reverse() : PageSizes.A4);
                context.pageWidth = context.currentPage.getWidth();
                context.pageHeight = context.currentPage.getHeight();
                context.y = context.pageHeight - context.margin;
                context.pageNumber++;

                context.currentPage.drawRectangle({
                    x: 0, y: 0, width: context.pageWidth, height: context.pageHeight, color: themeColors.background
                });

                if (title) {
                    context.currentPage.drawText(title, {
                        x: context.margin, y: context.y, size: 14, font: fontBold, color: themeColors.text
                    });
                    context.y -= 30;
                }
            };

            const drawImageSafe = async (page, dataUrl, x, y, maxWidth, maxHeight) => {
                try {
                    if (!dataUrl || !dataUrl.startsWith('data:image')) return y;
                    const imgBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
                    
                    // Validation simple du header JPEG/PNG
                    const uint8 = new Uint8Array(imgBytes.slice(0, 4));
                    const isPng = uint8[0] === 0x89 && uint8[1] === 0x50;
                    const isJpeg = uint8[0] === 0xFF && uint8[1] === 0xD8;

                    let img;
                    if (isPng) img = await pdfDoc.embedPng(imgBytes);
                    else if (isJpeg) img = await pdfDoc.embedJpg(imgBytes);
                    else throw new Error("Format image non supporté ou corrompu");

                    const dims = img.scale(1);
                    const ratio = Math.min(maxWidth / dims.width, maxHeight / dims.height);
                    const finalWidth = dims.width * ratio;
                    const finalHeight = dims.height * ratio;

                    page.drawImage(img, { x, y: y - finalHeight, width: finalWidth, height: finalHeight });
                    return y - finalHeight - 10;
                } catch (e) {
                    console.error("PDF Image Embed Error:", e);
                    page.drawText("[Image Erreur]", { x, y: y - 15, size: 8, font, color: pdfRgb(0.7, 0, 0) });
                    return y - 20;
                }
            };

            // --- 1. MAIN COURANTE ---
            addNewPage("MAIN COURANTE - JOURNAL D'INTERVENTION");
            const colWidths = [50, 70, 150, 245]; // Heure, Pax, Localisation, Remarques
            const headers = ["Heure", "Pax", "Localisation", "Remarques"];

            const drawTableHeader = () => {
                context.currentPage.drawRectangle({
                    x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg
                });
                let currentX = context.margin + 5;
                headers.forEach((h, i) => {
                    context.currentPage.drawText(h, { x: currentX, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                    currentX += colWidths[i];
                });
                context.y -= 25;
            };

            drawTableHeader();

            for (const entry of logData) {
                const remarksLines = wrapText(entry.remarques, colWidths[3] - 10, font, 9);
                const rowHeight = Math.max(1, remarksLines.length) * context.lineHeight + 10;

                if (context.y - rowHeight < context.margin) {
                    addNewPage("MAIN COURANTE (SUITE)");
                    drawTableHeader();
                }

                let currentX = context.margin + 5;
                context.currentPage.drawText(entry.heure || '', { x: currentX, y: context.y, size: 9, font, color: themeColors.text });
                currentX += colWidths[0];
                
                // Style Pax (Couleur)
                let pColor = pdfRgb(0.5, 0.5, 0.5);
                let pText = entry.pax || '';
                if (entry.paxMode === 'standard') {
                    const cfg = PDF_PAX_COLORS[entry.pax] || PDF_PAX_COLORS['Autre'];
                    const hex = cfg.color;
                    pColor = pdfRgb(parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255);
                } else {
                    const hex = entry.paxColor || '#888888';
                    pColor = pdfRgb(parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255);
                }
                context.currentPage.drawRectangle({ x: currentX - 2, y: context.y - 2, width: colWidths[1] - 5, height: 12, color: pColor });
                context.currentPage.drawText(pText.substring(0, 12), { x: currentX, y: context.y, size: 8, font: fontBold, color: pdfRgb(1,1,1) });
                currentX += colWidths[1];

                context.currentPage.drawText((entry.lieu || '').substring(0, 25), { x: currentX, y: context.y, size: 9, font, color: themeColors.text });
                currentX += colWidths[2];

                remarksLines.forEach((line, idx) => {
                    context.currentPage.drawText(line, { x: currentX, y: context.y - (idx * context.lineHeight), size: 9, font, color: themeColors.text });
                });

                context.currentPage.drawLine({
                    start: { x: context.margin, y: context.y - rowHeight + 12 },
                    end: { x: context.pageWidth - context.margin, y: context.y - rowHeight + 12 },
                    thickness: 0.5, color: themeColors.line, opacity: 0.3
                });

                context.y -= rowHeight;
            }

            // --- 2. ADVERSAIRES ---
            if (adversaries.length > 0) {
                addNewPage("FICHIER ADVERSAIRES");
                for (const adv of adversaries) {
                    if (context.y < 180) addNewPage("FICHIER ADVERSAIRES (SUITE)");
                    
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    context.currentPage.drawText(`${adv.nom} ${adv.prenom}`, { x: context.margin + 5, y: context.y + 2, size: 11, font: fontBold, color: themeColors.text });
                    context.y -= 25;

                    if (adv.photo) {
                        await drawImageSafe(context.currentPage, adv.photo, context.margin, context.y + 20, 120, 120);
                    }

                    let infoY = context.y;
                    const labels = [
                        `Né le: ${adv.dob || 'N/C'}`,
                        `Lien ravisseurs: ${adv.lien || 'N/C'}`,
                        `Antécédents: ${adv.antecedents || 'N/C'}`,
                        `Attitude: ${adv.attitude || 'N/C'}`,
                        `Substance: ${adv.substance || 'N/C'}`,
                        `Armement: ${adv.armes || 'N/C'}`
                    ];
                    labels.forEach(l => {
                        context.currentPage.drawText(l, { x: context.margin + 140, y: infoY, size: 9, font, color: themeColors.text });
                        infoY -= 14;
                    });
                    context.y = Math.min(context.y - 130, infoY - 20);
                }
            }

            // --- 3. OTAGES ---
            if (hostages.length > 0) {
                addNewPage("FICHIER OTAGES / VICTIMES");
                for (const host of hostages) {
                    if (context.y < 180) addNewPage("FICHIER OTAGES (SUITE)");
                    
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    context.currentPage.drawText(`${host.nom} ${host.prenom}`, { x: context.margin + 5, y: context.y + 2, size: 11, font: fontBold, color: themeColors.text });
                    context.y -= 25;

                    if (host.photo) {
                        await drawImageSafe(context.currentPage, host.photo, context.margin, context.y + 20, 120, 120);
                    }

                    let infoY = context.y;
                    const labels = [
                        `Né le: ${host.dob || 'N/C'}`,
                        `Lien ravisseurs: ${host.lien || 'N/C'}`,
                        `État: ${host.etat || 'N/C'}`,
                        `Blessures: ${host.blessures || 'N/C'}`
                    ];
                    labels.forEach(l => {
                        context.currentPage.drawText(l, { x: context.margin + 140, y: infoY, size: 9, font, color: themeColors.text });
                        infoY -= 14;
                    });
                    context.y = Math.min(context.y - 130, infoY - 20);
                }
            }

            // --- 4. AMIS ---
            if (friends.length > 0) {
                addNewPage("FORCES AMIES / UNITÉS");
                const fCols = [150, 150, 215];
                const fHeaders = ["Nom / Prénom", "Unité", "Mission / Contact"];
                
                const drawFHeader = () => {
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    let cx = context.margin + 5;
                    fHeaders.forEach((h, i) => {
                        context.currentPage.drawText(h, { x: cx, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                        cx += fCols[i];
                    });
                    context.y -= 25;
                };
                drawFHeader();

                for (const f of friends) {
                    if (context.y < 50) { addNewPage("FORCES AMIES (SUITE)"); drawFHeader(); }
                    let cx = context.margin + 5;
                    context.currentPage.drawText(`${f.nom} ${f.prenom}`, { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    cx += fCols[0];
                    context.currentPage.drawText(f.unite || '', { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    cx += fCols[1];
                    context.currentPage.drawText(`${f.mission || ''} ${f.tph ? '['+f.tph+']':''}`, { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    context.y -= 20;
                }
            }

            // --- 5. PHOTOS PAR CATÉGORIE ---
            const categories = PHOTO_CATEGORIES.filter(c => c.id !== 'all');
            for (const cat of categories) {
                const catPhotos = photos.filter(p => p.category === cat.id);
                if (catPhotos.length === 0) continue;

                addNewPage(`GALERIE : ${cat.label.toUpperCase()}`, true); // Mode PAYSAGE
                for (let i = 0; i < catPhotos.length; i += 2) {
                    if (context.y < 400) addNewPage(`GALERIE : ${cat.label.toUpperCase()} (SUITE)`, true);
                    
                    const photoWidth = (context.pageWidth - 3 * context.margin) / 2;
                    const photoHeightMax = context.pageHeight - 2 * context.margin - 40; // Presque toute la hauteur

                    const p1 = catPhotos[i];
                    context.currentPage.drawText(p1.title || '', { x: context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
                    const y1 = await drawImageSafe(context.currentPage, p1.data, context.margin, context.y - 10, photoWidth, photoHeightMax);

                    let y2 = context.y;
                    if (i + 1 < catPhotos.length) {
                        const p2 = catPhotos[i+1];
                        context.currentPage.drawText(p2.title || '', { x: context.margin + photoWidth + context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
                        y2 = await drawImageSafe(context.currentPage, p2.data, context.margin + photoWidth + context.margin, context.y - 10, photoWidth, photoHeightMax);
                    }
                    context.y = Math.min(y1, y2) - 30;
                }
            }

            // --- FOOTER : pagination + DIFFUSION RESTREINTE sur toutes les pages ---
            const allPages = pdfDoc.getPages();
            const totalPages = allPages.length;
            const exportStamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
            const footerColor = pdfRgb(0.55, 0.55, 0.55);
            const restrictColor = pdfRgb(0.7, 0.15, 0.15);

            allPages.forEach((page, idx) => {
                const w = page.getWidth();
                const pageNum = `Page ${idx + 1} / ${totalPages}`;
                const numWidth = font.widthOfTextAtSize(pageNum, 8);
                const restrict = 'DIFFUSION RESTREINTE';
                const restrictWidth = fontBold.widthOfTextAtSize(restrict, 8);

                // Ligne fine au-dessus du footer
                page.drawLine({
                    start: { x: context.margin, y: 22 },
                    end: { x: w - context.margin, y: 22 },
                    thickness: 0.3, color: themeColors.line, opacity: 0.5
                });

                // Gauche : mention DIFFUSION RESTREINTE
                page.drawText(restrict, {
                    x: context.margin, y: 10, size: 8, font: fontBold, color: restrictColor
                });
                // Centre : horodatage export
                const center = `PC TAC — Export ${exportStamp}`;
                const centerWidth = font.widthOfTextAtSize(center, 8);
                page.drawText(center, {
                    x: (w - centerWidth) / 2, y: 10, size: 8, font, color: footerColor
                });
                // Droite : pagination
                page.drawText(pageNum, {
                    x: w - context.margin - numWidth, y: 10, size: 8, font, color: footerColor
                });

                // Suppress 'restrictWidth' lint without affecting layout (réservé si bordure ajoutée plus tard)
                void restrictWidth;
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `PC-TAC-EXPORT-${new Date().getTime()}.pdf`;
            link.click();

        } catch (e) {
            console.error("PDF Export Critical Error:", e);
            alert("Erreur lors de la génération du PDF.");
        }
    }
};

window.PdfExport = PdfExport;
