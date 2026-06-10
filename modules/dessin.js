/**
 * dessin.js — Système d'annotation et de dessin sur les photos (outils, sélection, historique undo/redo).
 * Chargé par : 4.html
 * Fonctions principales : pushAnnotationHistory, commitAnnotationHistory, undoAnnotation, redoAnnotation, getSelectionBBox
 */
// --- Annotation / Drawing Globals ---
let longPressTimer = null;
const LONG_PRESS_DURATION = 500; // ms
let currentAnnotationZoom = 1.0;

// ===== Historique annotation — undo / redo (Lot B1) =====
let annotationHistory = [];
let annotationRedoStack = [];
const ANNOTATION_HISTORY_MAX = 50;

// ===== Manipulation directe — poignées resize / rotation (Lot B2) =====
let isResizing = false;
let isRotating = false;
let gestureSnapshot = null;   // snapshot JSON pris au début d'un geste move/resize/rotate
let gestureStart = null;      // { cx, cy, dist0, metric0 } pour le redimensionnement

/** Empile l'état courant des annotations (à appeler AVANT une mutation discrète). */
function pushAnnotationHistory() {
    annotationHistory.push(JSON.stringify(Store.state.annotations));
    if (annotationHistory.length > ANNOTATION_HISTORY_MAX) annotationHistory.shift();
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

/** Valide un snapshot pré-geste dans l'historique (uniquement si l'état a changé). */
function commitAnnotationHistory(snapshot) {
    if (!snapshot || snapshot === JSON.stringify(Store.state.annotations)) return;
    annotationHistory.push(snapshot);
    if (annotationHistory.length > ANNOTATION_HISTORY_MAX) annotationHistory.shift();
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

function undoAnnotation() {
    if (!annotationHistory.length) return;
    annotationRedoStack.push(JSON.stringify(Store.state.annotations));
    try { Store.state.annotations = JSON.parse(annotationHistory.pop()); } catch (e) {}
    selectedAnnotation = null;
    setContextualTools(null);
    redrawCanvas();
    persistAnnotationsToPreview();
    refreshAnnotationUndoRedo();
}

function redoAnnotation() {
    if (!annotationRedoStack.length) return;
    annotationHistory.push(JSON.stringify(Store.state.annotations));
    try { Store.state.annotations = JSON.parse(annotationRedoStack.pop()); } catch (e) {}
    selectedAnnotation = null;
    setContextualTools(null);
    redrawCanvas();
    persistAnnotationsToPreview();
    refreshAnnotationUndoRedo();
}

function refreshAnnotationUndoRedo() {
    const u = document.getElementById('annotation_undo');
    const r = document.getElementById('annotation_redo');
    if (u) { u.disabled = !annotationHistory.length; u.style.opacity = annotationHistory.length ? '1' : '0.4'; }
    if (r) { r.disabled = !annotationRedoStack.length; r.style.opacity = annotationRedoStack.length ? '1' : '0.4'; }
}

function resetAnnotationHistory() {
    annotationHistory = [];
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

/** Snapshot avant / commit après pour les sliders contextuels (input continu). */
function bindHistorySlider(el) {
    if (!el) return;
    let snap = null;
    const take = () => { snap = JSON.stringify(Store.state.annotations); };
    el.addEventListener('pointerdown', take);
    el.addEventListener('keydown', take);
    el.addEventListener('change', () => { commitAnnotationHistory(snap); snap = null; });
}

window.undoAnnotation = undoAnnotation;
window.redoAnnotation = redoAnnotation;

/** Boîte englobante non pivotée d'une annotation : {x, y, width, height, centerX, centerY}. */
function getSelectionBBox(annotation) {
    let x, y, width, height;
    if (annotation.type === 'location') {
        x = annotation.x - annotation.radius; y = annotation.y - annotation.radius;
        width = annotation.radius * 2; height = annotation.radius * 2;
    } else if (annotation.type === 'box') {
        x = annotation.x; y = annotation.y; width = annotation.width; height = annotation.height;
    } else if (annotation.type === 'arrow') {
        const minX = Math.min(annotation.startX, annotation.endX);
        const minY = Math.min(annotation.startY, annotation.endY);
        const maxX = Math.max(annotation.startX, annotation.endX);
        const maxY = Math.max(annotation.startY, annotation.endY);
        x = minX - 10; y = minY - 10; width = (maxX - minX) + 20; height = (maxY - minY) + 20;
    } else { // text / member
        const size = annotation.size || 30;
        ctx.save();
        ctx.font = `bold ${size}px Oswald`;
        const tw = ctx.measureText(annotation.text || '').width;
        ctx.restore();
        if (annotation.type === 'member') {
            const padX = size * 0.8, padY = size * 0.4;
            width = tw + padX * 2; height = size + padY * 2;
            x = annotation.x - width / 2; y = annotation.y - height / 2;
        } else {
            width = tw + 20; height = size + 10;
            x = annotation.x - 10; y = annotation.y - size;
        }
    }
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

/** Positions des poignées (repère canvas non pivoté) de la sélection. */
function getSelectionHandles(annotation) {
    const bb = getSelectionBBox(annotation);
    const rotOffset = 34 / currentAnnotationZoom;
    return {
        bbox: bb,
        rotate: { x: bb.centerX, y: bb.y - rotOffset },
        resize: { x: bb.x + bb.width, y: bb.y + bb.height }
    };
}

/** Teste si (ux,uy) — déjà ramené dans le repère non pivoté — touche une poignée.
 *  Retourne 'rotate' | 'resize' | null. */
function hitSelectionHandle(annotation, ux, uy) {
    const h = getSelectionHandles(annotation);
    const tol = 18 / currentAnnotationZoom;
    if (Math.hypot(ux - h.rotate.x, uy - h.rotate.y) <= tol) return 'rotate';
    if (Math.hypot(ux - h.resize.x, uy - h.resize.y) <= tol) return 'resize';
    return null;
}

/** Métrique de taille d'une annotation, utilisée pour le redimensionnement uniforme. */
function getAnnotationMetric(a) {
    if (a.type === 'location') return a.radius || 1;
    if (a.type === 'box') return Math.max(a.width || 1, a.height || 1);
    if (a.type === 'arrow') return Math.hypot(a.endX - a.startX, a.endY - a.startY) || 1;
    return a.size || 30; // text / member
}

function setContextualTools(selection) {
    const contextualTools = document.getElementById('contextual_tools');
    if (!contextualTools) return;

    if (!selection) {
        contextualTools.classList.remove('active');
        return;
    }
    contextualTools.classList.add('active');

    // Rotation : refléter l'angle dans le slider visible + l'input caché.
    // (Le redimensionnement passe désormais par les poignées du canvas — Lot B2.)
    let deg = Math.round((selection.rotation || 0) * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const rotationInput = document.getElementById('rotation_input');
    const rotationSlider = document.getElementById('rotation_input_slider');
    if (rotationInput) rotationInput.value = deg;
    if (rotationSlider) rotationSlider.value = deg;

    // Épaisseur de trait (box / arrow)
    const strokeSlider = document.getElementById('stroke_width_edit');
    if (strokeSlider) {
        strokeSlider.value = selection.thickness || 5;
        strokeSlider.parentElement.style.display =
            (selection.type === 'box' || selection.type === 'arrow') ? 'flex' : 'none';
    }

    // Taille de texte (text / member)
    const textSizeControl = document.getElementById('text_size_control');
    if (textSizeControl) {
        const isText = selection.type === 'text' || selection.type === 'member';
        textSizeControl.style.display = isText ? 'flex' : 'none';
        if (isText) {
            const textSizeSlider = document.getElementById('text_size_edit');
            if (textSizeSlider) textSizeSlider.value = selection.size || 30;
        }
    }

    // Réglages de zone (location)
    const zoneSettings = document.getElementById('zone_settings');
    if (zoneSettings) {
        zoneSettings.style.display = selection.type === 'location' ? 'flex' : 'none';
        if (selection.type === 'location') {
            const ct = document.getElementById('circle_text');
            const co = document.getElementById('circle_opacity');
            if (ct) ct.value = selection.text || '';
            if (co) co.value = selection.opacity || 0.5;
        }
    }
}

function persistAnnotationsToPreview() {
    if (!annotationModal || !annotationModal.dataset.targetPreviewId) return;
    const previewEl = document.getElementById(annotationModal.dataset.targetPreviewId);
    if (!previewEl) return;
    previewEl.dataset.annotations = JSON.stringify(Store.state.annotations);
    if (typeof saveToStorage === 'function') saveToStorage();
}

function updateStrokeWidth(val) {
    if (selectedAnnotation) {
        selectedAnnotation.thickness = parseInt(val);
        redrawCanvas();
        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
    }
}

function updateTextSize(val) {
    if (selectedAnnotation && (selectedAnnotation.type === 'text' || selectedAnnotation.type === 'member')) {
        selectedAnnotation.size = parseInt(val);
        redrawCanvas();
        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
    }
}

function updateZoneText(val) {
    if (selectedAnnotation && selectedAnnotation.type === 'location') {
        selectedAnnotation.text = val;
        redrawCanvas();
        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
    }
}

function updateZoneOpacity(val) {
    if (selectedAnnotation && selectedAnnotation.type === 'location') {
        selectedAnnotation.opacity = parseFloat(val);
        redrawCanvas();
        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
    }
}

function updateAnnotationRotation() {
    if (selectedAnnotation) {
        const rotationInput = document.getElementById('rotation_input');
        const degrees = parseFloat(rotationInput.value) || 0;
        selectedAnnotation.rotation = degrees * Math.PI / 180;
        redrawCanvas();
        // CONFORMITÉ: Sauvegarde après rotation
        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
    }
}
window.updateAnnotationRotation = updateAnnotationRotation;

function setActiveTool(toolId) {
    currentTool = toolId;
    document.querySelectorAll('.tool-btn.active, .tool-controls.active').forEach(el => el.classList.remove('active'));
    const toolButton = document.getElementById(`tool_${toolId}`);
    if (toolButton) toolButton.classList.add('active');
    const toolControls = document.getElementById(`controls_${toolId}`);
    if (toolControls) toolControls.classList.add('active');
    
    // Gestion du curseur et du touch-action
    canvas.style.cursor = toolId === 'move' ? 'grab' : 'crosshair';
    
    // Sur mobile, l'outil 'move' autorise le zoom/pan natif
    if (window.innerWidth <= 768) {
        canvas.style.touchAction = toolId === 'move' ? 'manipulation' : 'none';
    } else {
        canvas.style.touchAction = 'none';
    }

    selectedAnnotation = null;
    setContextualTools(null);

    const activeToolDisplay = document.getElementById('active_tool_display');
    if (activeToolDisplay) activeToolDisplay.innerText = "Outil: " + (toolId === 'move' ? 'Déplacer' : toolId);
}

function setAnnotationColor(color, element) {
    currentAnnotationColor = color;
    document.querySelectorAll('.color-circle').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    if (selectedAnnotation && selectedAnnotation.color !== color) {
        pushAnnotationHistory();
        selectedAnnotation.color = color; // Appliquer la couleur à la sélection
        redrawCanvas();
        persistAnnotationsToPreview();
    }
}

async function openAnnotationModal(previewImgId) {
    // Robust initialization
    if (!canvas) canvas = document.getElementById('annotationCanvas');
    if (!ctx && canvas) ctx = canvas.getContext('2d');
    if (!annotationModal) annotationModal = document.getElementById('annotationModal');

    const previewImg = document.getElementById(previewImgId);
    if (!previewImg) return;

    let objectURL = Store.state.objectUrlsCache[previewImgId];
    annotationModal.dataset.targetPreviewId = previewImgId;

    if (!objectURL) {
        // Fallback: Essayer de récupérer l'URL depuis l'élément img s'il s'agit d'un blob existant
        if (previewImg.src && previewImg.src.startsWith('blob:')) {
            objectURL = previewImg.src;
            Store.state.objectUrlsCache[previewImgId] = objectURL;
        } else {
            // Tenter de recharger le blob depuis la DB
            try {
                const imageBlob = await dbManager.getItem(previewImgId);
                if (imageBlob) {
                    objectURL = URL.createObjectURL(imageBlob);
                    Store.state.objectUrlsCache[previewImgId] = objectURL;
                    previewImg.src = objectURL;
                } else {
                    alert("Impossible de charger l'image pour l'annotation. Données non trouvées.");
                    return;
                }
            } catch (e) {
                console.error("Erreur DB:", e);
                alert("Erreur lors de la récupération de l'image.");
                return;
            }
        }
    }

    // Reset baseImage to ensure onload fires every time
    baseImage = new Image();

    baseImage.onload = () => {
        console.log("Image d'annotation chargée (onload):", baseImage.naturalWidth, "x", baseImage.naturalHeight);
        
        // Rafraîchir les références DOM pour éviter les éléments détachés
        canvas = document.getElementById('annotationCanvas');
        ctx = canvas.getContext('2d');
        
        // AFFICHER LA MODALE D'ABORD (Sinon drawImage peut échouer sur un canevas masqué sur PC)
        if (!annotationModal.open) {
            document.body.classList.add('modal-open');
            annotationModal.showModal();
        }

        // Fermer les accordéons sur mobile par défaut
        if (window.innerWidth <= 767) {
            document.querySelectorAll('.mobile-accordion').forEach(details => {
                details.removeAttribute('open');
            });
        }

        // Attendre que le navigateur ait calculé le layout de la modale montrée
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                console.log("Layout modale prêt, initialisation canevas. offsetWidth:", canvas.offsetWidth);
                
                // Fixer dimensions du buffer de dessin
                canvas.width = baseImage.naturalWidth;
                canvas.height = baseImage.naturalHeight;
                
                try {
                    const rawAnnotations = previewImg.dataset.annotations;
                    Store.state.annotations = rawAnnotations ? JSON.parse(rawAnnotations) : [];
                } catch (e) {
                    console.error("Erreur parsing annotations:", e);
                    Store.state.annotations = [];
                }
                Store.state.annotations.forEach(a => { if (!a.color) a.color = '#c0392b'; });

                // Nouvelle session d'édition : on repart d'un historique vierge.
                resetAnnotationHistory();

                // GESTION AFFICHAGE INITIAL (RESET ZOOM / FIT)
                resetZoom();
                
                annotationModal.dataset.targetPreviewId = previewImgId;
                
                // Sécurité : Ré-initialiser l'espace de travail si nécessaire
                if (typeof initAnnotationWorkspace === 'function') {
                    initAnnotationWorkspace();
                }
            });
        });
    };

    baseImage.onerror = async (e) => {
        console.warn("Erreur de chargement baseImage, tentative de regénération du blob...", e);
        // Si l'URL a expiré ou a été révoquée, on tente de la recréer
        try {
            const imageBlob = await dbManager.getItem(previewImgId);
            if (imageBlob) {
                const newUrl = URL.createObjectURL(imageBlob);
                Store.state.objectUrlsCache[previewImgId] = newUrl;
                previewImg.src = newUrl;
                baseImage.src = newUrl; // Ré-essayer
            } else {
                alert("Impossible de charger l'image. Données corrompues.");
            }
        } catch (err) {
            console.error("Échec définitif du chargement image:", err);
            alert("Erreur critique de chargement d'image.");
        }
    };

    baseImage.src = objectURL;
}

/**
 * Calcule et applique le zoom 'Fit' pour que l'image soit entièrement visible
 */
function resetZoom() {
    if (!canvas || !baseImage) return;
    
    const container = document.querySelector('.annotation-canvas-container');
    if (!container) return;

    // Dimensions disponibles
    const availableW = container.clientWidth - 40; // padding
    const availableH = container.clientHeight - 40;

    // Calcul du scale pour fitter
    const scaleW = availableW / baseImage.naturalWidth;
    const scaleH = availableH / baseImage.naturalHeight;
    const fitScale = Math.min(scaleW, scaleH, 1.0); // Pas plus de 100% par défaut

    currentAnnotationZoom = fitScale;
    applyCanvasTransform();
    
    // S'assurer que les dimensions de rendu CSS correspondent à l'image
    canvas.style.width = baseImage.naturalWidth + 'px';
    canvas.style.height = baseImage.naturalHeight + 'px';
    
    setActiveTool('move');
    redrawCanvas();
}

function changeZoom(delta) {
    currentAnnotationZoom = Math.max(0.1, Math.min(5, currentAnnotationZoom + delta));
    applyCanvasTransform();
}

function applyCanvasTransform() {
    if (canvas) {
        canvas.style.transform = `scale(${currentAnnotationZoom})`;
    }
}

window.changeZoom = changeZoom;
window.resetZoom = resetZoom;

function redrawCanvas() {
    if (!ctx || !canvas) return;
    if (!baseImage || !baseImage.complete || baseImage.naturalWidth === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    Store.state.annotations.forEach(drawAnnotation);
    if (isDrawing && currentAnnotation) {
        drawAnnotation(currentAnnotation);
    }
    if (selectedAnnotation) {
        drawSelectionBorder(selectedAnnotation);
    }
}

function drawSelectionBorder(annotation) {
    const bb = getSelectionBBox(annotation);
    const angle = annotation.rotation || 0;
    // Tailles constantes à l'écran : on divise par le zoom courant du canvas.
    const z = currentAnnotationZoom || 1;
    const lw = 2 / z;
    const hr = 9 / z;             // demi-côté / rayon des poignées
    const rotOffset = 34 / z;

    ctx.save();
    if (angle) {
        ctx.translate(bb.centerX, bb.centerY);
        ctx.rotate(angle);
        ctx.translate(-bb.centerX, -bb.centerY);
    }

    // Cadre pointillé
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.strokeRect(bb.x, bb.y, bb.width, bb.height);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // Tige + poignée de rotation (au-dessus du cadre)
    const rotX = bb.centerX, rotY = bb.y - rotOffset;
    ctx.beginPath();
    ctx.moveTo(bb.centerX, bb.y);
    ctx.lineTo(rotX, rotY);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotX, rotY, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Poignée de redimensionnement (coin bas-droit)
    const rsX = bb.x + bb.width, rsY = bb.y + bb.height;
    ctx.beginPath();
    ctx.rect(rsX - hr, rsY - hr, hr * 2, hr * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    ctx.restore();
}

function drawAnnotation(annotation) {
    ctx.save();
    // Utilisation de la couleur stockée ou rouge par défaut
    const color = annotation.color || '#c0392b';

            let centerX, centerY;
    if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
        centerX = annotation.x;
        centerY = annotation.y;
    } else if (annotation.type === 'box') {
        centerX = annotation.x + annotation.width / 2;
        centerY = annotation.y + annotation.height / 2;
    } else if (annotation.type === 'arrow') {
        centerX = (annotation.startX + annotation.endX) / 2;
        centerY = (annotation.startY + annotation.endY) / 2;
    }

    if (annotation.rotation) {
        ctx.translate(centerX, centerY);
        ctx.rotate(annotation.rotation);
        ctx.translate(-centerX, -centerY);
    }

    switch (annotation.type) {
        case 'location': {
            const radius = annotation.radius || 0;
            if (radius < 2) { ctx.restore(); return; }
            ctx.beginPath();
            ctx.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
            const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${annotation.opacity || 0.5})`;
            ctx.fill();
            ctx.strokeStyle = color; // Couleur personnalisée pour le bord
            ctx.lineWidth = 3;
            ctx.stroke();
            if (annotation.text) {
                ctx.fillStyle = 'black';
                ctx.font = `bold ${Math.max(12, radius / 2)}px Oswald, Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'black';
                ctx.fillText(annotation.text, annotation.x, annotation.y);
            }
            break;
        }
        case 'arrow': {
            drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5, color);
            break;
        }
        case 'box': {
            ctx.strokeStyle = color;
            ctx.lineWidth = annotation.thickness || 5;
            ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
            break;
        }
        case 'text': {
            const size = annotation.size || 30;
            ctx.font = `bold ${size}px Oswald, Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.strokeText(annotation.text, annotation.x, annotation.y);
            ctx.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
        case 'member': {
            const size = annotation.size || 30;
            ctx.font = `bold ${size}px Oswald, Arial, sans-serif`;
            const paddingX = size * 0.8;
            const paddingY = size * 0.4;
            const textWidth = ctx.measureText(annotation.text).width;
            const boxW = textWidth + paddingX * 2;
            const boxH = size + paddingY * 2;

            const rectX = annotation.x - boxW / 2;
            const rectY = annotation.y - boxH / 2;
            const radius = boxH / 3;

            ctx.beginPath();
            ctx.moveTo(rectX + radius, rectY);
            ctx.lineTo(rectX + boxW - radius, rectY);
            ctx.quadraticCurveTo(rectX + boxW, rectY, rectX + boxW, rectY + radius);
            ctx.lineTo(rectX + boxW, rectY + boxH - radius);
            ctx.quadraticCurveTo(rectX + boxW, rectY + boxH, rectX + boxW - radius, rectY + boxH);
            ctx.lineTo(rectX + radius, rectY + boxH);
            ctx.quadraticCurveTo(rectX, rectY + boxH, rectX, rectY + boxH - radius);
            ctx.lineTo(rectX, rectY + radius);
            ctx.quadraticCurveTo(rectX, rectY, rectX + radius, rectY);
            ctx.closePath();

            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = Math.max(2, size / 15);
            ctx.stroke();

            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
    }
    ctx.restore();
}

function drawArrow(fromx, fromy, tox, toy, lineWidth, color) {
    if (fromx === tox && fromy === toy) return;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    const headlen = Math.max(lineWidth * 3, 10);
    const arrowLength = Math.sqrt(dx * dx + dy * dy);

    const lineToX = tox - (headlen * 0.7) * Math.cos(angle);
    const lineToY = toy - (headlen * 0.7) * Math.sin(angle);

    if (arrowLength < headlen * 1.5) {
        ctx.beginPath();
        ctx.moveTo(fromx, fromy);
        ctx.lineTo(tox, toy);
        ctx.stroke();
        return;
    }

    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(lineToX, lineToY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
}

function handleDrawStart(e) {
    // Multi-touch sur mobile : on laisse le navigateur gérer le zoom natif
    if (e.touches && e.touches.length > 1) {
        cancelLongPress();
        return;
    }

    const pos = getEventPos(canvas, e);
    startX = pos.x;
    startY = pos.y;

    // --- Poignées de manipulation directe (resize / rotation) — Lot B2 ---
    // Prioritaire sur tout le reste : si une annotation est sélectionnée et qu'on
    // saisit une de ses poignées, on entre en mode redimensionnement ou rotation.
    if (selectedAnnotation) {
        const bb = getSelectionBBox(selectedAnnotation);
        const angle = selectedAnnotation.rotation || 0;
        const u = getRotatedPoint(pos.x, pos.y, bb.centerX, bb.centerY, angle);
        const handle = hitSelectionHandle(selectedAnnotation, u.x, u.y);
        if (handle) {
            e.preventDefault();
            cancelLongPress();
            gestureSnapshot = JSON.stringify(Store.state.annotations);
            if (handle === 'resize') {
                isResizing = true;
                gestureStart = {
                    cx: bb.centerX, cy: bb.centerY,
                    dist0: Math.hypot(u.x - bb.centerX, u.y - bb.centerY) || 1,
                    metric0: getAnnotationMetric(selectedAnnotation),
                    box0: {
                        width: selectedAnnotation.width, height: selectedAnnotation.height
                    },
                    arrow0: {
                        startX: selectedAnnotation.startX, startY: selectedAnnotation.startY,
                        endX: selectedAnnotation.endX, endY: selectedAnnotation.endY
                    }
                };
            } else {
                isRotating = true;
                gestureStart = { cx: bb.centerX, cy: bb.centerY };
            }
            document.body.style.overflow = 'hidden';
            return;
        }
    }

    // Détection d'appui long pour éditer une annotation existante (comportement d'app de retouche)
    if (e.touches && e.touches.length === 1) {
        const hit = getAnnotationAtPosition(pos.x, pos.y);
        if (hit) {
            longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                setActiveTool('move');
                selectedAnnotation = hit;
                isMovingAnnotation = true;
                gestureSnapshot = JSON.stringify(Store.state.annotations);
                setContextualTools(selectedAnnotation);
                redrawCanvas();
            }, LONG_PRESS_DURATION);
        }
    }

    if (currentTool === 'move') {
        e.preventDefault();
        selectedAnnotation = getAnnotationAtPosition(pos.x, pos.y);
        setContextualTools(selectedAnnotation);
        if (selectedAnnotation) {
            isMovingAnnotation = true;
            gestureSnapshot = JSON.stringify(Store.state.annotations);
            document.body.style.overflow = 'hidden';
            redrawCanvas();
        }
    } else if (currentTool === 'text') {
        e.preventDefault();
        const text = prompt("Texte à insérer :");
        if (text) {
            const sizeInput = document.getElementById('text_size_tool');
            const size = sizeInput ? parseInt(sizeInput.value) : 30;
            pushAnnotationHistory();
            Store.state.annotations.push({
                id: Date.now() + Math.random(),
                type: 'text',
                x: startX,
                y: startY,
                text: text,
                color: currentAnnotationColor,
                rotation: 0,
                size: size
            });
            redrawCanvas();
        }
    } else if (currentTool === 'member') {
        e.preventDefault();
        populateMemberCanvasModal(startX, startY);
    } else {
        isDrawing = true;
        selectedAnnotation = null;
        setContextualTools(null);
        currentAnnotation = {
            id: Date.now() + Math.random(),
            type: currentTool,
            startX: startX,
            startY: startY,
            endX: startX,
            endY: startY,
            rotation: 0,
            color: currentAnnotationColor // Store color
        };
    }
}

function handleDrawMove(e) {
    if (e.touches && e.touches.length > 1) return; // Zoom natif en cours

    const pos = getEventPos(canvas, e);

    // Si on bouge trop, on annule l'appui long
    if (longPressTimer && (Math.abs(pos.x - startX) > 10 || Math.abs(pos.y - startY) > 10)) {
        cancelLongPress();
    }

    // --- Redimensionnement uniforme via la poignée (Lot B2) ---
    if (isResizing && selectedAnnotation && gestureStart) {
        e.preventDefault();
        const a = selectedAnnotation;
        const angle = a.rotation || 0;
        const u = getRotatedPoint(pos.x, pos.y, gestureStart.cx, gestureStart.cy, angle);
        let scale = Math.hypot(u.x - gestureStart.cx, u.y - gestureStart.cy) / gestureStart.dist0;
        if (!isFinite(scale) || scale <= 0) scale = 0.01;
        if (a.type === 'box') {
            a.width = Math.max(5, gestureStart.box0.width * scale);
            a.height = Math.max(5, gestureStart.box0.height * scale);
            a.x = gestureStart.cx - a.width / 2;
            a.y = gestureStart.cy - a.height / 2;
        } else if (a.type === 'location') {
            a.radius = Math.max(3, gestureStart.metric0 * scale);
        } else if (a.type === 'arrow') {
            const g = gestureStart.arrow0;
            a.startX = gestureStart.cx + (g.startX - gestureStart.cx) * scale;
            a.startY = gestureStart.cy + (g.startY - gestureStart.cy) * scale;
            a.endX = gestureStart.cx + (g.endX - gestureStart.cx) * scale;
            a.endY = gestureStart.cy + (g.endY - gestureStart.cy) * scale;
        } else { // text / member
            a.size = Math.max(8, Math.min(400, gestureStart.metric0 * scale));
        }
        redrawCanvas();
        return;
    }

    // --- Rotation via la poignée (Lot B2) ---
    if (isRotating && selectedAnnotation && gestureStart) {
        e.preventDefault();
        selectedAnnotation.rotation =
            Math.atan2(pos.y - gestureStart.cy, pos.x - gestureStart.cx) + Math.PI / 2;
        redrawCanvas();
        return;
    }

    if (!isDrawing && !isMovingAnnotation) return;

    // On bloque le scroll natif SEULEMENT si on est en train de dessiner ou bouger une annotation
    e.preventDefault();

    if (isMovingAnnotation && selectedAnnotation) {
        const deltaX = pos.x - startX;
        const deltaY = pos.y - startY;

        if (selectedAnnotation.type === 'arrow') {
            selectedAnnotation.startX += deltaX;
            selectedAnnotation.startY += deltaY;
            selectedAnnotation.endX += deltaX;
            selectedAnnotation.endY += deltaY;
        } else {
            // Pour box, location et text
            selectedAnnotation.x += deltaX;
            selectedAnnotation.y += deltaY;
        }

        startX = pos.x;
        startY = pos.y;
        redrawCanvas();

    } else if (isDrawing && currentAnnotation) {
        currentAnnotation.endX = pos.x;
        currentAnnotation.endY = pos.y;
        redrawCanvas();
    }
}

function handleDrawEnd(e) {
    cancelLongPress();
    if (e.touches && e.touches.length > 0) return; // Toujours un doigt posé

    document.body.style.overflow = '';

    // Fin d'un geste de redimensionnement / rotation via poignée
    if (isResizing || isRotating) {
        isResizing = false;
        isRotating = false;
        gestureStart = null;
        commitAnnotationHistory(gestureSnapshot);
        gestureSnapshot = null;
        setContextualTools(selectedAnnotation);
        const targetId = annotationModal.dataset.targetPreviewId;
        const targetPreview = targetId ? document.getElementById(targetId) : null;
        if (targetPreview) targetPreview.dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
        redrawCanvas();
        return;
    }

    if (isMovingAnnotation) {
        isMovingAnnotation = false;
        // Historique : on valide le snapshot pris au début du déplacement.
        commitAnnotationHistory(gestureSnapshot);
        gestureSnapshot = null;
        // CONFORMITÉ: Sauvegarde après déplacement/modification d'une annotation
        const targetId = annotationModal.dataset.targetPreviewId;
        const targetPreview = document.getElementById(targetId);
        if (targetPreview) targetPreview.dataset.annotations = JSON.stringify(Store.state.annotations);
        saveToStorage();
        redrawCanvas();
    } else if (isDrawing) {
        isDrawing = false;
        if (!currentAnnotation) return;

        const final = { ...currentAnnotation };
        const strokeWidthInput = document.getElementById('stroke_width_edit');
        const thickness = strokeWidthInput ? parseInt(strokeWidthInput.value) : 5;

        if (final.type === 'box') {
            // Normaliser les coordonnées pour la boîte
            final.x = Math.min(final.startX, final.endX);
            final.y = Math.min(final.startY, final.endY);
            final.width = Math.abs(final.startX - final.endX);
            final.height = Math.abs(final.startY - final.endY);
            final.thickness = thickness;
            if (final.width < 5 || final.height < 5) return;
        } else if (final.type === 'arrow') {
            final.thickness = thickness;
            if (Math.abs(final.startX - final.endX) < 5 && Math.abs(final.startY - final.endY) < 5) return;
        } else if (final.type === 'location') {
            final.x = final.startX;
            final.y = final.startY;
            final.radius = Math.sqrt(Math.pow(final.endX - final.startX, 2) + Math.pow(final.endY - final.startY, 2));
            final.text = document.getElementById('circle_text')?.value || 'Zone';
            final.opacity = document.getElementById('circle_opacity')?.value || 0.5;
            final.color = currentAnnotationColor;
            if (final.radius < 5) return;
        }

        // Historique : on empile l'état AVANT l'ajout (après les retours anticipés
        // pour ne pas créer d'entrée pour un tracé trop petit, ignoré).
        pushAnnotationHistory();
        if (final.type !== 'text') Store.state.annotations.push(final);

        currentAnnotation = null;
        selectedAnnotation = final;
        setContextualTools(selectedAnnotation);
        redrawCanvas();
        persistAnnotationsToPreview();
    }
}

async function closeAnnotationModal() {
    if (annotationModal) {
        document.body.classList.remove('modal-open');
        if (typeof annotationModal.close === 'function') annotationModal.close();
        else annotationModal.style.display = 'none';
        
        persistAnnotationsToPreview();
        // REMOVED: cleanupObjectUrls() - Trop agressif, révoque tout le cache UI.
    }
}

function cancelLongPress() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

async function createAnnotatedImageBlob(imageBlob, annotationsData) {
    if (!imageBlob || !(imageBlob instanceof Blob) || imageBlob.size === 0) {
        console.warn("createAnnotatedImageBlob: Blob invalide ou manquant, contournement.");
        return imageBlob;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectURL = URL.createObjectURL(imageBlob);
        img.src = objectURL;

        img.onload = () => {
            URL.revokeObjectURL(objectURL);
            
            // On crée un canvas local pour éviter les race conditions lors de la génération parallèle
            const localCanvas = document.createElement('canvas');
            const localCtx = localCanvas.getContext('2d');
            
            localCanvas.width = img.naturalWidth;
            localCanvas.height = img.naturalHeight;
            localCtx.clearRect(0, 0, localCanvas.width, localCanvas.height);
            localCtx.drawImage(img, 0, 0);

            // Appliquer chaque annotation sur le contexte local
            annotationsData.forEach(annotation => drawAnnotationOnContext(localCtx, localCanvas.width, localCanvas.height, annotation));

            // Exportation en PNG pour conserver la qualité et la transparence des annotations
            localCanvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('La conversion du canevas en Blob a échoué.'));
                }
            }, 'image/png');
        };

        img.onerror = (e) => {
            console.error("createAnnotatedImageBlob: Erreur de chargement d'image pour annotation", e);
            URL.revokeObjectURL(objectURL);
            // Retourne le blob original au lieu de rejeter pour éviter de bloquer tout le PDF
            resolve(imageBlob); 
        };
    });
}

function drawAnnotationOnContext(context, canvasWidth, canvasHeight, annotation) {
    context.save();
    const color = annotation.color || '#c0392b';
            let centerX, centerY;
    if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
        centerX = annotation.x;
        centerY = annotation.y;
    } else if (annotation.type === 'box') {
        centerX = annotation.x + annotation.width / 2;
        centerY = annotation.y + annotation.height / 2;
    } else if (annotation.type === 'arrow') {
        centerX = (annotation.startX + annotation.endX) / 2;
        centerY = (annotation.startY + annotation.endY) / 2;
    }

    if (annotation.rotation) {
        context.translate(centerX, centerY);
        context.rotate(annotation.rotation);
        context.translate(-centerX, -centerY);
    }

    switch (annotation.type) {
        case 'location': {
            const radius = annotation.radius || 0;
            if (radius < 2) { context.restore(); return; }
            context.beginPath(); context.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
            const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
            context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${annotation.opacity || 0.5})`; context.fill();
            context.strokeStyle = color; context.lineWidth = 3; context.stroke();
            if (annotation.text) {
                context.fillStyle = 'black'; context.font = `bold ${Math.max(12, radius / 2)}px Oswald, Arial, sans-serif`;
                context.textAlign = 'center'; context.textBaseline = 'middle';
                context.fillText(annotation.text, annotation.x, annotation.y);
            }
            break;
        }
        case 'arrow': {
            const drawArrowLocal = (fromx, fromy, tox, toy, lineWidth) => {
                if (fromx === tox && fromy === toy) return;
                context.strokeStyle = color; context.fillStyle = color; context.lineWidth = lineWidth;
                const headlen = Math.max(lineWidth * 3, 10);
                const dx = tox - fromx; const dy = toy - fromy;
                const angle = Math.atan2(dy, dx);
                const lineToX = tox - (headlen * 0.7) * Math.cos(angle);
                const lineToY = toy - (headlen * 0.7) * Math.sin(angle);

                context.beginPath(); context.moveTo(fromx, fromy); context.lineTo(lineToX, lineToY); context.stroke();
                context.beginPath(); context.moveTo(tox, toy);
                context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
                context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
                context.closePath(); context.fill();
            };
            drawArrowLocal(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5);
            break;
        }
        case 'box': {
            context.strokeStyle = color; context.lineWidth = annotation.thickness || 5;
            context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
            break;
        }
        case 'text': {
            const size = annotation.size || 30;
            context.font = `bold ${size}px Oswald, Arial, sans-serif`;
            context.fillStyle = color;
            context.strokeStyle = "black";
            context.lineWidth = 2;
            context.strokeText(annotation.text, annotation.x, annotation.y);
            context.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
        case 'member': {
            const size = annotation.size || 30;
            context.font = `bold ${size}px Oswald, Arial, sans-serif`;
            const paddingX = size * 0.8;
            const paddingY = size * 0.4;
            const textWidth = context.measureText(annotation.text).width;
            const boxW = textWidth + paddingX * 2;
            const boxH = size + paddingY * 2;

            const rectX = annotation.x - boxW / 2;
            const rectY = annotation.y - boxH / 2;
            const radius = boxH / 3;

            context.beginPath();
            context.moveTo(rectX + radius, rectY);
            context.lineTo(rectX + boxW - radius, rectY);
            context.quadraticCurveTo(rectX + boxW, rectY, rectX + boxW, rectY + radius);
            context.lineTo(rectX + boxW, rectY + boxH - radius);
            context.quadraticCurveTo(rectX + boxW, rectY + boxH, rectX + boxW - radius, rectY + boxH);
            context.lineTo(rectX + radius, rectY + boxH);
            context.quadraticCurveTo(rectX, rectY + boxH, rectX, rectY + boxH - radius);
            context.lineTo(rectX, rectY + radius);
            context.quadraticCurveTo(rectX, rectY, rectX + radius, rectY);
            context.closePath();

            context.fillStyle = color;
            context.fill();
            context.strokeStyle = "white";
            context.lineWidth = Math.max(2, size / 15);
            context.stroke();

            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
    }
    context.restore();
}

window.populateMemberCanvasModal = function (x, y) {
    const listContainer = document.getElementById('member_canvas_list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const patracBtn = document.querySelectorAll('.patracdvr-member-btn');
    const validBtns = Array.from(patracBtn).filter(b => b.dataset.trigramme && b.dataset.trigramme !== 'N/A');
    if (validBtns.length === 0) {
        listContainer.innerHTML = '<p style="color:var(--text-muted)">Aucun membre configuré.</p>';
    } else {
        validBtns.forEach(btn => {
            const tri = btn.dataset.trigramme;
            const fonc = btn.dataset.fonction && btn.dataset.fonction !== 'Sans' ? ` - ${btn.dataset.fonction}` : '';
            const button = document.createElement('button');
            button.className = 'add-btn';
            button.style.background = 'var(--bg-container)';
            button.style.color = 'var(--text-primary)';
            button.style.border = '1px solid var(--border-color)';
            button.textContent = tri + fonc;
            button.onclick = () => {
                document.getElementById('memberSelectionModalCanvas').close();
                // Taille un peu plus petite par défaut pour les puces membres
                const size = document.getElementById('text_size_edit') ? parseInt(document.getElementById('text_size_edit').value) : 20;
                pushAnnotationHistory();
                Store.state.annotations.push({
                    id: Date.now() + Math.random(), type: 'member', x, y, text: tri, color: currentAnnotationColor, rotation: 0, size: size
                });
                redrawCanvas();
                syncDomToStore(); // Optionnel : Déclencher manuellement saveFormData si nécessaire
                // Remettre l'outil sur deplacement
                setActiveTool('move');
            };
            listContainer.appendChild(button);
        });
    }
    document.getElementById('memberSelectionModalCanvas').showModal();
}


// --- GLOBAL EXPOSURE ---
window.setActiveTool = setActiveTool;
window.updateStrokeWidth = updateStrokeWidth;
window.updateTextSize = updateTextSize;
window.updateZoneText = updateZoneText;
window.updateZoneOpacity = updateZoneOpacity;
window.updateAnnotationRotation = updateAnnotationRotation;
window.setAnnotationColor = setAnnotationColor;
window.openAnnotationModal = openAnnotationModal;

function toggleMobileDock() {
    const fab = document.getElementById('mobile-dock-fab');
    const panel = document.getElementById('annotation-toolbar-panel');
    const wrapper = document.querySelector('.annotation-wrapper');
    if (!fab || !panel || !wrapper) return;
    
    if (wrapper.classList.contains('show-triple-dock')) {
        wrapper.classList.remove('show-triple-dock');
        panel.classList.remove('expanded');
        fab.style.display = 'flex';
        setTimeout(() => { if (typeof resetZoom === 'function') resetZoom(); }, 50);
    } else {
        wrapper.classList.add('show-triple-dock');
        panel.classList.add('expanded');
        fab.style.display = 'none';
        setTimeout(() => { if (typeof resetZoom === 'function') resetZoom(); }, 50);
    }
}
window.toggleMobileDock = toggleMobileDock;

/**
 * Ferme le bottom-sheet contextuel mobile : désélectionne l'annotation courante
 * et masque les réglages. Le sheet se referme via la classe .active de
 * #contextual_tools (cf. setContextualTools), pilotée par le CSS mobile.
 */
function closeMobileSheet() {
    selectedAnnotation = null;
    setContextualTools(null);
    if (typeof redrawCanvas === 'function') redrawCanvas();
}
window.closeMobileSheet = closeMobileSheet;

/**
 * Branche le canvas et la barre d'outils d'annotation (équivalent monolithique 4.html).
 * À appeler une fois le canvas initialisé (ex. après getElementById dans presentation.js).
 */
let annotationWorkspaceInitialized = false;
function initAnnotationWorkspace() {
    if (annotationWorkspaceInitialized || !canvas || !ctx || !annotationModal) return;
    annotationWorkspaceInitialized = true;
    
    // Initialiser le workspace (le triple dock mobile est géré via CSS Grid et toggleMobileDock)

    // Enveloppe : une exception dans un handler canvas ne doit pas casser
    // silencieusement l'annotation (le filet global de 4.html journalise aussi).
    const safeAnnot = (fn, label) => function (ev) {
        try { return fn(ev); }
        catch (e) { console.error('[Annotation] ' + label + ' a échoué:', e); }
    };
    canvas.addEventListener('mousedown', safeAnnot(handleDrawStart, 'drawStart'));
    canvas.addEventListener('mousemove', safeAnnot(handleDrawMove, 'drawMove'));
    canvas.addEventListener('mouseup', safeAnnot(handleDrawEnd, 'drawEnd'));
    canvas.addEventListener('mouseout', safeAnnot(handleDrawEnd, 'drawEnd'));
    canvas.addEventListener('touchstart', safeAnnot(handleDrawStart, 'drawStart'), { passive: false });
    canvas.addEventListener('touchmove', safeAnnot(handleDrawMove, 'drawMove'), { passive: false });
    canvas.addEventListener('touchend', safeAnnot(handleDrawEnd, 'drawEnd'));

    const drawingTools = ['tool_move', 'tool_location', 'tool_arrow', 'tool_box', 'tool_text', 'tool_member'];
    drawingTools.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                const toolId = id.replace(/^tool_/, '');
                setActiveTool(toolId);
                if (toolId === 'location') {
                    const txt = prompt("Texte personnalisé de la zone :", document.getElementById('circle_text')?.value || "Z");
                    if (txt !== null) {
                        const circleInput = document.getElementById('circle_text');
                        if (circleInput) circleInput.value = txt;
                        if (typeof updateZoneText === 'function') updateZoneText(txt);
                    }
                }
            });
        }
    });

    const toolReset = document.getElementById('tool_reset');
    if (toolReset) {
        toolReset.addEventListener('click', () => {
            if (Store.state.annotations.length) pushAnnotationHistory();
            Store.state.annotations = [];
            selectedAnnotation = null;
            setContextualTools(null);
            redrawCanvas();
            if (annotationModal.dataset.targetPreviewId) {
                const previewImg = document.getElementById(annotationModal.dataset.targetPreviewId);
                if (previewImg) previewImg.dataset.annotations = JSON.stringify(Store.state.annotations);
            }
            if (typeof saveToStorage === 'function') saveToStorage();
        });
    }

    const annCancel = document.querySelectorAll('#annotation_cancel, #annotation_cancel_header');
    annCancel.forEach(btn => btn.addEventListener('click', closeAnnotationModal));

    const annSave = document.querySelectorAll('#annotation_save, #annotation_save_header');
    annSave.forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetId = annotationModal.dataset.targetPreviewId;
            const previewImg = targetId ? document.getElementById(targetId) : null;
            if (previewImg) {
                previewImg.dataset.annotations = JSON.stringify(Store.state.annotations);
                if (Store.state.annotations.length > 0) {
                    selectedAnnotation = null;
                    setContextualTools(null);
                    redrawCanvas();
                    const blob = await new Promise(resolve => canvas.toBlob(resolve));
                    if (blob) {
                        const newUrl = URL.createObjectURL(blob);
                        if (previewImg.src.startsWith('blob:') && previewImg.src !== Store.state.objectUrlsCache[targetId]) {
                            URL.revokeObjectURL(previewImg.src);
                        }
                        previewImg.src = newUrl;
                    }
                } else if (Store.state.objectUrlsCache[targetId]) {
                    previewImg.src = Store.state.objectUrlsCache[targetId];
                }
            }
            if (typeof saveToStorage === 'function') saveToStorage();
            await closeAnnotationModal();
        });
    });

    const rotInput = document.getElementById('rotation_input');
    if (rotInput) {
        rotInput.addEventListener('change', updateAnnotationRotation);
        rotInput.addEventListener('input', updateAnnotationRotation);
    }

    const delBtn = document.getElementById('delete_btn');
    if (delBtn) {
        delBtn.addEventListener('click', () => {
            if (!selectedAnnotation) return;
            pushAnnotationHistory();
            // Support backward compatibility if old annotations don't have an ID
            if (selectedAnnotation.id) {
                Store.state.annotations = Store.state.annotations.filter((ann) => ann.id !== selectedAnnotation.id);
            } else {
                Store.state.annotations = Store.state.annotations.filter((ann) => ann !== selectedAnnotation);
            }
            selectedAnnotation = null;
            setContextualTools(null);
            redrawCanvas();
            persistAnnotationsToPreview();
        });
    }

    const editTextBtn = document.getElementById('edit_text_btn');
    if (editTextBtn) {
        editTextBtn.addEventListener('click', () => {
            if (!selectedAnnotation) return;
            if (selectedAnnotation.type !== 'location' && selectedAnnotation.type !== 'text' && selectedAnnotation.type !== 'member') {
                return;
            }
            const cur = selectedAnnotation.text != null ? String(selectedAnnotation.text) : '';
            const newText = prompt('Modifier texte :', cur);
            if (newText !== null && newText !== cur) {
                pushAnnotationHistory();
                selectedAnnotation.text = newText;
                redrawCanvas();
                persistAnnotationsToPreview();
            }
        });
    }

    // Boutons Annuler / Rétablir (Lot B1)
    const undoBtn = document.getElementById('annotation_undo');
    if (undoBtn) undoBtn.addEventListener('click', undoAnnotation);
    const redoBtn = document.getElementById('annotation_redo');
    if (redoBtn) redoBtn.addEventListener('click', redoAnnotation);
    refreshAnnotationUndoRedo();

    // Raccourcis clavier Ctrl+Z / Ctrl+Y (uniquement quand la modale est ouverte)
    document.addEventListener('keydown', (e) => {
        if (!annotationModal || !annotationModal.open) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAnnotation(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redoAnnotation(); }
    });

    const strokeSlider = document.getElementById('stroke_width_edit');
    if (strokeSlider) strokeSlider.addEventListener('input', (e) => updateStrokeWidth(e.target.value));
    const textSizeEdit = document.getElementById('text_size_edit');
    if (textSizeEdit) textSizeEdit.addEventListener('input', (e) => updateTextSize(e.target.value));

    const circleText = document.getElementById('circle_text');
    const circleOpacity = document.getElementById('circle_opacity');
    if (circleText) circleText.addEventListener('input', (e) => updateZoneText(e.target.value));
    if (circleOpacity) circleOpacity.addEventListener('input', (e) => updateZoneOpacity(e.target.value));

    // Historique : snapshot avant / commit après pour les sliders contextuels
    bindHistorySlider(strokeSlider);
    bindHistorySlider(textSizeEdit);
    bindHistorySlider(circleOpacity);
    bindHistorySlider(document.getElementById('rotation_input_slider'));
}

window.initAnnotationWorkspace = initAnnotationWorkspace;
