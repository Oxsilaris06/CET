// ==================== MediaManager.js ====================





// Display map: preview container id => display container id (null = no mirrored display)
const displayMap = {
    'adversary_photo_preview_container': 'adversary_photo_display',
    'adversary_extra_photos_preview_container': 'adversary_extra_photos_display',
    'renforts_photo_preview_container': 'renforts_photo_display',
    'adversary_photo_preview_container_2': 'adversary_photo_display_2',
    'adversary_extra_photos_preview_container_2': 'adversary_extra_photos_display_2',
    'photo_container_itineraire_exterieur_preview_container': 'photo_container_itineraire_exterieur_display',
    'photo_container_itineraire_interieur_preview_container': 'photo_container_itineraire_interieur_display',
    'photo_container_bapteme_terrain_preview_container': 'photo_container_bapteme_terrain_display',
    'photo_container_emplacement_ao_preview_container': 'photo_container_emplacement_ao_display',
    'photo_container_transport_pr_preview_container': null,
    'photo_container_transport_domicile_preview_container': null,
    'photo_container_cellule_effraction_preview_container': null,
};

async function handleFileChange(input, previewContainerId, isSingle) {
    const previewContainer = document.getElementById(previewContainerId);

    if (isSingle) {
        const existingImages = previewContainer.querySelectorAll('.image-preview');
        for (const img of existingImages) {
            // Supprimer l'image, en passant l'élément parent pour suppression
            await removeImage(img.id, img.closest('.image-preview-item'));
        }
        previewContainer.innerHTML = '';
    }

    if (input.files.length > 0) {
        for (const file of Array.from(input.files)) {
            const previewImgId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

                    let objectURL = null;
            try {
                await dbManager.putItem(previewImgId, file);
                
                // On utilise FileReader pour obtenir du Base64 (DataURL)
                const base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const interactiveItem = document.createElement('div');
                interactiveItem.className = 'image-preview-item draggable';
                interactiveItem.draggable = true;
                interactiveItem.id = previewImgId + "_item";

                const isEffrac = previewContainerId.includes('effrac');

                interactiveItem.innerHTML = `
                            <img id="${previewImgId}" class="image-preview" src="${base64Data}" style="display:block;" data-annotations="[]" data-tools="[]" data-other-tools="">
                            <input type="text" class="photo-title-input" placeholder="Légende de la photo..." 
                                style="width: 100%; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 4px; padding: 2px 5px; font-size: 0.8em;" 
                                oninput="syncDomToStore()">
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button type="button" class="add-btn" style="background-color: var(--accent-blue); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openAnnotationModal('${previewImgId}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">edit</span></button>
                                ${isEffrac ? `<button type="button" class="add-btn" style="background-color: var(--effraction-gold); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openEffractionToolsModal('${previewImgId}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">hardware</span></button>` : ''}
                                <button type="button" class="remove-btn" style="padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="removeImage('${previewImgId}', this.closest('.image-preview-item'))">&times;</button>
                            </div>`;
                previewContainer.appendChild(interactiveItem);

            } catch (error) {
                console.error("Erreur lors du stockage de l'image (IndexedDB) - Persistance indisponible:", error);
            }
        }
    }
    syncAllThumbnails();
    if (input) input.value = '';
    syncDomToStore();
}

// Export des fonctions au scope global
window.handleFileChange = handleFileChange;
window.removeImage = removeImage;
window.updateCustomBgPreview = updateCustomBgPreview;

async function removeImage(imgId, itemElement) {
    try {
        // Révocation de l'URL de l'objet et suppression du cache
        if (Store.state.objectUrlsCache[imgId]) {
            URL.revokeObjectURL(Store.state.objectUrlsCache[imgId]);
            delete Store.state.objectUrlsCache[imgId];
        }

        await dbManager.deleteItem(imgId);
        if (itemElement) itemElement.remove();
        syncAllThumbnails();
        syncDomToStore();
    } catch (error) {
        console.error("Erreur lors de la suppression de l'image:", error);
        // On n'alerte pas ici, car l'erreur pourrait être liée à IndexedDB,
        // mais on retire quand même l'élément de l'UI si possible.
        if (itemElement) itemElement.remove();
        syncAllThumbnails();
        syncDomToStore();
    }
}

function syncAllThumbnails() {
    // Nettoyer UNIQUEMENT les conteneurs qui sont des cibles de synchronisation dans displayMap
    for (const previewId in displayMap) {
        const displayId = displayMap[previewId];
        if (displayId) {
            const displayContainer = document.getElementById(displayId);
            if (displayContainer) displayContainer.innerHTML = '';
        }
    }

    for (const previewId in displayMap) {
        const displayId = displayMap[previewId];
        if (!displayId) continue;

        const previewContainer = document.getElementById(previewId);
        const displayContainer = document.getElementById(displayId);

        if (previewContainer && displayContainer) {
            previewContainer.querySelectorAll('.image-preview-item img').forEach(previewImg => {
                const displayImg = document.createElement('img');
                displayImg.className = 'image-preview';
                // IMPORTANT: Utilisez toujours l'URL de l'objet du DOM, qui est l'URL de l'objet Blob
                displayImg.src = previewImg.src;
                displayImg.dataset.refId = previewImg.id;
                displayContainer.appendChild(displayImg);
            });
        }
    }
}

async function handleCustomBackgroundChange(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
            await dbManager.putItem('custom_pdf_background', file);
            updateCustomBgPreview();
            alert("Fond personnalisé enregistré.");
        } catch (e) {
            console.error(e);
            alert("Erreur lors de l'enregistrement du fond.");
        }
    }
    input.value = '';
}

async function removeCustomBackground() {
    try {
        await dbManager.deleteItem('custom_pdf_background');
        updateCustomBgPreview();
        alert("Fond personnalisé supprimé. Le fond par défaut sera utilisé.");
    } catch (e) {
        console.error(e);
    }
}

async function updateCustomBgPreview() {
    const container = document.getElementById('custom_bg_preview_container');
    if (!container) return;
    container.innerHTML = '';
    try {
        const blob = await dbManager.getItem('custom_pdf_background');
        if (blob) {
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            const img = document.createElement('img');
            img.src = base64Data;
            img.className = 'image-preview';
            img.style.maxWidth = '200px';
            container.appendChild(img);
        } else {
            container.innerHTML = '<p style="font-style:italic; color:var(--text-secondary);">Aucun fond personnalisé. Fond par défaut actif.</p>';
        }
    } catch (e) {
        console.error(e);
    }
}

function loadImageAsBlobViaImageElement(resolvedUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                if (!canvas.width || !canvas.height) {
                    resolve(null);
                    return;
                }
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => resolve(blob || null), 'image/png');
            } catch (err) {
                console.warn('Repli canvas image fond:', err);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = resolvedUrl;
    });
}

async function fetchImageAndCompress(imagePath, quality) {
    try {
        const resolvedUrl = new URL(imagePath, window.location.href).href;
        let blob = null;
        try {
            const response = await fetch(resolvedUrl);
            if (response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.startsWith('image/')) {
                    blob = await response.blob();
                    if (blob.size < 100) {
                        console.warn(`Image blob trop petit (${blob.size}b) pour ${imagePath}`);
                        blob = null;
                    }
                } else {
                    console.warn(`Type de contenu invalide (${contentType}) pour ${imagePath}`);
                }
            }
        } catch (fetchErr) {
            console.warn(`fetch indisponible pour ${imagePath}, repli <img> :`, fetchErr);
        }
        if (!blob) {
            blob = await loadImageAsBlobViaImageElement(resolvedUrl);
        }
        if (!blob) {
            console.error(`Impossible de charger l'image: ${imagePath}`);
            return null;
        }
        return await compressImage(blob, quality);
    } catch (error) {
        console.error(`Erreur de chargement/compression de l'image ${imagePath}:`, error);
        return null;
    }
}

function getAdversaryImageInfo(formData, adversaryIndex = 1) {
    const mainPhotoContainerId = adversaryIndex === 1 ? 'adversary_photo_preview_container' : 'adversary_photo_preview_container_2';
    if (Store.state.formData.dynamic_photos && Store.state.formData.dynamic_photos[mainPhotoContainerId]) {
        const firstImage = Store.state.formData.dynamic_photos[mainPhotoContainerId][0];
        if (firstImage) {
            return {
                id: firstImage.id,
                annotationsJson: firstImage.annotations || '[]'
            };
        }
    }
    return null;
}

