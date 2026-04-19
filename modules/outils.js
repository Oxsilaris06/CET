// ==================== Utils.js ====================

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function cleanupObjectUrls() {
    for (const urlId in Store.state.objectUrlsCache) {
        if (Store.state.objectUrlsCache[urlId]) {
            URL.revokeObjectURL(Store.state.objectUrlsCache[urlId]);
        }
    }
    Store.state.objectUrlsCache = {};
}
window.cleanupObjectUrls = cleanupObjectUrls;

function getEventPos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    // Utiliser une vérification plus robuste pour l'événement tactile
    const clientX = evt.touches && evt.touches.length > 0 ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches && evt.touches.length > 0 ? evt.touches[0].clientY : evt.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function getRotatedPoint(x, y, centerX, centerY, angle) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const translatedX = x - centerX;
    const translatedY = y - centerY;
    return {
        x: translatedX * cos - translatedY * sin + centerX,
        y: translatedX * sin + translatedY * cos + centerY
    };
}

function getAnnotationAtPosition(x, y) {
    for (let i = Store.state.annotations.length - 1; i >= 0; i--) {
        const annotation = Store.state.annotations[i];
        const angle = annotation.rotation || 0;
        let centerX, centerY;

        if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') { centerX = annotation.x; centerY = annotation.y; }
        else if (annotation.type === 'box') { centerX = annotation.x + annotation.width / 2; centerY = annotation.y + annotation.height / 2; }
        else if (annotation.type === 'arrow') { centerX = (annotation.startX + annotation.endX) / 2; centerY = (annotation.startY + annotation.endY) / 2; }

        // Pour des Store.state.annotations simples, le centre de rotation est le centre de l'objet
        const rotatedPos = getRotatedPoint(x, y, centerX, centerY, angle);
        const testX = rotatedPos.x;
        const testY = rotatedPos.y;

        const tolerance = 15;
        let isInside = false;

        switch (annotation.type) {
            case 'location':
                isInside = Math.sqrt(Math.pow(testX - annotation.x, 2) + Math.pow(testY - annotation.y, 2)) <= annotation.radius + tolerance / 2;
                break;
            case 'box':
                isInside = testX >= annotation.x - tolerance && testX <= annotation.x + annotation.width + tolerance &&
                    testY >= annotation.y - tolerance && testY <= annotation.y + annotation.height + tolerance;
                break;
            case 'text':
                // Simple bounding box approx
                const size = annotation.size || 30;
                ctx.font = `bold ${size}px Oswald`;
                const w = ctx.measureText(annotation.text).width;
                const h = size;
                isInside = testX >= annotation.x && testX <= annotation.x + w && testY >= annotation.y - h && testY <= annotation.y;
                break;
            case 'member':
                const mSize = annotation.size || 20;
                ctx.font = `bold ${mSize}px Oswald`;
                const mPadX = mSize * 0.8;
                const mPadY = mSize * 0.4;
                const mW = ctx.measureText(annotation.text).width + mPadX * 2;
                const mH = mSize + mPadY * 2;
                isInside = testX >= annotation.x - mW / 2 && testX <= annotation.x + mW / 2 && testY >= annotation.y - mH / 2 && testY <= annotation.y + mH / 2;
                break;
            case 'arrow':
                const dx = annotation.endX - annotation.startX;
                const dy = annotation.endY - annotation.startY;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) break;
                const t = ((testX - annotation.startX) * dx + (testY - annotation.startY) * dy) / lenSq;
                const projX = annotation.startX + t * dx;
                const projY = annotation.startY + t * dy;
                if (t >= 0 && t <= 1) {
                    // Vérification de la distance au carré de la position du clic à la ligne projetée
                    const distSq = Math.pow(testX - projX, 2) + Math.pow(testY - projY, 2);
                    isInside = distSq <= Math.pow(annotation.thickness + tolerance, 2);
                } else {
                    // Vérification si l'on est proche des extrémités (pour les flèches courtes)
                    const distStartSq = Math.pow(testX - annotation.startX, 2) + Math.pow(testY - annotation.startY, 2);
                    const distEndSq = Math.pow(testX - annotation.endX, 2) + Math.pow(testY - annotation.endY, 2);
                    const maxDistSq = Math.pow(annotation.thickness + tolerance, 2);
                    isInside = distStartSq <= maxDistSq || distEndSq <= maxDistSq;
                }
                break;
        }

        if (isInside) return annotation;
    }
    return null;
}

function getDragAfterElement(container, y) {
    // S'assurer de ne considérer que les éléments qui peuvent être déplacés
    const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging):not(.time-item)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function compressImage(imageBlob, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectURL = URL.createObjectURL(imageBlob);
        img.src = objectURL;

        img.onload = () => {
            URL.revokeObjectURL(objectURL);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const MAX_DIMENSION = 1920;
            let { naturalWidth: width, naturalHeight: height } = img;
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                if (width > height) {
                    height = (MAX_DIMENSION / width) * height;
                    width = MAX_DIMENSION;
                } else {
                    width = (MAX_DIMENSION / height) * width;
                    height = MAX_DIMENSION;
                }
            }
            canvas.width = width;
            canvas.height = height;

            // CORRECTION: Pour les PNG (image de fond ou annotée), ne pas forcer le fond blanc
            if (imageBlob.type !== 'image/png') {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('La conversion du canevas en Blob a échoué.'));
                        return;
                    }
                    // arrayBuffer() est asynchrone sur Blob (navigateurs récents) — ne pas résoudre la Promise.
                    Promise.resolve(blob.arrayBuffer()).then(resolve).catch(reject);
                },
                // Utiliser PNG si le Blob original était PNG (y compris les images annotées), JPEG sinon
                (imageBlob.type === 'image/png' ? 'image/png' : 'image/jpeg'),
                quality
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error("Échec du chargement du Blob de l'image dans l'élément Image."));
        };
    });
}

/** Détecte PNG (signature IHDR) pour choisir embedPng vs embedJpg (pdf-lib). */
function isPngArrayBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) return false;
    const b = new Uint8Array(buffer, 0, 8);
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function isJpegArrayBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 3) return false;
    const b = new Uint8Array(buffer, 0, 3);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * Embarque des octets image (JPEG ou PNG) dans un document pdf-lib.
 * compressImage() émet du PNG pour tout blob source PNG — ne pas supposer du JPEG.
 */
async function embedPdfImageFromBytes(pdfDoc, imageBytes) {
    if (imageBytes && typeof imageBytes.then === 'function') {
        imageBytes = await imageBytes;
    }

    // Protection contre le bug "[object ArrayBuffer]" (exactement 20 octets)
    if (!imageBytes || imageBytes.byteLength === 0 || imageBytes.byteLength === 20) {
        console.error("embedPdfImageFromBytes: Données invalides ou corrompues (20 octets).");
        return null;
    }

    // Logique simplifiée et robuste calquée sur 4.html
    try {
        // Tentative directe PNG (pdf-lib gère les erreurs en interne)
        return await pdfDoc.embedPng(imageBytes);
    } catch (e1) {
        try {
            // Tentative JPEG
            return await pdfDoc.embedJpg(imageBytes);
        } catch (e2) {
            console.warn("embedPdfImageFromBytes: Échec PNG et JPEG directs, tentative Canvas (fallback).");
            // Dernier recours pour les formats comme WebP ou formats mal identifiés
            return reencodeImageViaCanvasForPdf(pdfDoc, imageBytes);
        }
    }
}

/**
 * Dernier recours : décode via <img> + canvas → JPEG pour pdf-lib (WebP, JPEG corrompu, etc.).
 */
async function reencodeImageViaCanvasForPdf(pdfDoc, imageBytes) {
    console.group("fallback re-encoding via canvas");
    
    // Validation des données d'entrée - Sanity check
    if (!imageBytes || imageBytes.byteLength < 100) {
        console.error('reencodeImageViaCanvasForPdf: Données image corrompues ou trop petites (< 100 octets)');
        console.groupEnd();
        throw new Error('Données image corrompues ou incomplètes (trop petites)');
    }

    // Convertir en Blob
    let blob;
    try {
        blob = new Blob([imageBytes]);
    } catch (e) {
        console.error('reencodeImageViaCanvasForPdf: Erreur lors de la création du Blob:', e);
        console.groupEnd();
        throw new Error('Impossible de créer le Blob image');
    }

    // Vérification de base
    if (!blob || blob.size === 0) {
        console.error('reencodeImageViaCanvasForPdf: Blob invalide ou vide');
        throw new Error('Blob image invalide - taille nulle');
    }

    const url = URL.createObjectURL(blob);
    
    try {
        // Vérifier le type de fichier avant d'essayer de décoder
        if (blob.type && !blob.type.startsWith('image/')) {
            console.warn('reencodeImageViaCanvasForPdf: Type d\'image inconnu, tentative de décodage forcé');
        }

        return await new Promise((resolve, reject) => {
            const bitmap = new Image();
            
            // Log détaillé des paramètres
            console.log('Début du décodage image avec parameters:', {
                urlLength: url.length,
                blobSize: blob.size,
                blobType: blob.type || 'inconnu',
                isArrayBuffer: ArrayBuffer.isView(imageBytes),
                imageBytesPreview: typeof imageBytes === 'string' ? imageBytes.substring(0, 100) : 'non-string'
            });

            bitmap.onload = () => {
                console.log('✅ Image décodée avec succès:', {
                    width: bitmap.width,
                    height: bitmap.height,
                    naturalWidth: bitmap.naturalWidth,
                    naturalHeight: bitmap.naturalHeight,
                    complete: bitmap.complete
                });
                
                // Vérifier que l'image a des dimensions valides
                if (bitmap.naturalWidth === 0 || bitmap.naturalHeight === 0) {
                    reject(new Error('Image sans dimensions naturelles - probablement corrompue')); 
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = bitmap.naturalWidth;
                canvas.height = bitmap.naturalHeight;
                
                // Créer un contexte 2D et dessiner l'image
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Impossible d\'obtenir le contexte 2D du canvas')); 
                    return;
                }
                
                // Remplir avec fond blanc pour les formats non PNG
                if (blob.type !== 'image/png') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                
                ctx.drawImage(bitmap, 0, 0);
                
                // Exporter en JPEG avec qualité adaptée
                canvas.toBlob((jpegBlob) => {
                    if (!jpegBlob || jpegBlob.size === 0) {
                        reject(new Error('toBlob JPEG échoué - image vide')); 
                        return;
                    }
                    
                    console.log('✅ Blob JPEG généré, taille:', jpegBlob.size);
                    Promise.resolve(jpegBlob.arrayBuffer()).then(async ab => {
                        try {
                            const embedded = await pdfDoc.embedJpg(ab);
                            resolve(embedded);
                        } catch (e) {
                            console.error('Erreur lors de l\'embedding du JPG:', e);
                            // Fallback: essayer d'abord en PNG si JPEG échoue
                            if (blob.type === 'image/jpeg') {
                                throw new Error('Embedding JPEG échoué et blob type est déjà JPEG'); 
                            }
                            // Essayer de convertir en PNG pour l'embedding
                            canvas.toBlob((pngBlob) => {
                                if (!pngBlob || pngBlob.size === 0) {
                                    reject(new Error('toBlob PNG échoué')); 
                                    return;
                                }
                                Promise.resolve(pngBlob.arrayBuffer()).then(ab2 => {
                                    pdfDoc.embedPng(ab2).then(resolve).catch(reject);
                                }).catch(reject);
                            }, 'image/png', 0.92);
                        }
                    }).catch(reject);
                }, 'image/jpeg', 0.85); // Qualité légèrement réduite pour les images complexes
            };

            bitmap.onerror = (e) => {
                console.error('❌ Erreur de décodage image:', e, 'URL préfixe:', url.substring(0, 100));
                reject(new Error(`Échec du décodage d'image: ${e.message || 'unknown error'}`));
            };

            bitmap.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ==================== UI.js ====================

function isFullscreen() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
}

function toggleFullscreen() {
    if (!isFullscreen()) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        } else if (document.documentElement.mozRequestFullScreen) { /* Firefox */
            document.documentElement.mozRequestFullScreen();
        } else if (document.documentElement.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
            document.documentElement.webkitRequestFullscreen();
        } else if (document.documentElement.msRequestFullscreen) { /* IE/Edge */
            document.documentElement.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) { /* Firefox */
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE/Edge */
            document.msExitFullscreen();
        }
    }
}

function updateFullscreenIcon() {
    const icon = document.getElementById('fullscreenIcon');
    if (icon) {
        if (isFullscreen()) {
            icon.textContent = 'fullscreen_exit';
            icon.title = 'Quitter le plein écran';
        } else {
            icon.textContent = 'fullscreen';
            icon.title = 'Plein écran';
        }
    }
}

function handleThemeToggle() {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    const icon = document.getElementById('darkModeIcon');
    if (icon) {
        icon.textContent = isDarkMode ? 'nightlight' : 'clear_day';
    }
}

function toggleDock() {
    const dock = document.getElementById('dockMenu');
    if (!dock) return;
    const dockCollapsed = dock.classList.toggle('collapsed');
    localStorage.setItem('dockCollapsed', dockCollapsed);

    // Mise à jour de l'icône de toggle
    const icon = document.querySelector('#dockToggleBtn .material-symbols-outlined');
    if (icon) {
        // Inverser l'icône : expand_more (pointe vers le bas/ouvert) -> expand_less (pointe vers le haut/fermé)
        icon.textContent = dockCollapsed ? 'expand_less' : 'expand_more';
    }
}


