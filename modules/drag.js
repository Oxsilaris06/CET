// ==================== DragDrop.js ====================
let touchDragItem = null;
let touchDragClone = null;
let touchStartX = 0;
let touchStartY = 0;

function persistAfterDrag() {
    if (typeof syncDomToStore === 'function') syncDomToStore();
    else if (typeof Store !== 'undefined' && typeof Store.saveToStorage === 'function') Store.saveToStorage();

    // NOUVEAU: Déclenche la mise à jour proactive de l'Articulation (Step 6)
    if (typeof updateArticulationDisplay === 'function') {
        updateArticulationDisplay();
    }
}

function handleTouchStart(e) {
    // Si on touche le bouton de suppression ou d'édition à l'intérieur, on ne drag pas
    if (e.target.classList.contains('remove-btn') || e.target.closest('.remove-btn')) return;

    const target = e.target.closest('.draggable');
    if (!target) return;

    touchDragItem = target;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;

    // Créer un clone visuel pour suivre le doigt
    touchDragClone = target.cloneNode(true);
    touchDragClone.style.position = 'fixed';
    touchDragClone.style.zIndex = '9999';
    touchDragClone.style.opacity = '0.8';
    touchDragClone.style.width = target.offsetWidth + 'px';
    touchDragClone.style.pointerEvents = 'none'; // Important pour détecter l'élément dessous
    touchDragClone.classList.add('dragging');

    // Position initiale hors écran pour éviter le flash
    touchDragClone.style.left = '-9999px';
    touchDragClone.style.top = '-9999px';

    document.body.appendChild(touchDragClone);

    // Feedback visuel sur l'original
    target.style.opacity = '0.4';
}

function handleTouchMove(e) {
    if (!touchDragItem || !touchDragClone) return;

    // Empêcher le scroll de la page pendant le drag
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];

    // Déplacer le clone
    touchDragClone.style.left = (touch.clientX - (touchDragClone.offsetWidth / 2)) + 'px';
    touchDragClone.style.top = (touch.clientY - (touchDragClone.offsetHeight / 2)) + 'px';

    // Identifier la zone de drop sous le doigt
    touchDragClone.style.display = 'none'; // Cacher brièvement pour voir dessous
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    touchDragClone.style.display = 'block';

    if (!elemBelow) return;

    // Trouver le conteneur valide le plus proche (Véhicule, Non assigné ou Poubelle)
    const droppableBelow = elemBelow.closest('.patracdvr-members-container, #unassigned_members_container, #trashCan');

    // Gestion visuelle des bordures (Feedback)
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.patracdvr-members-container, #unassigned_members_container').forEach(el => el.style.border = '1px dashed var(--border-color)');

    if (droppableBelow) {
        if (droppableBelow.id === 'trashCan') {
            droppableBelow.classList.add('drag-over');
        } else {
            droppableBelow.style.border = '2px dashed var(--accent-blue)';
        }
    }
}

function handleTouchEnd(e) {
    if (!touchDragItem) return;

    const touch = e.changedTouches[0]; // Position finale

    // Nettoyage visuel
    if (touchDragClone) touchDragClone.remove();
    touchDragItem.style.opacity = '1';

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.patracdvr-members-container, #unassigned_members_container').forEach(el => el.style.border = '1px dashed var(--border-color)');

    // Identifier la cible finale
    touchDragClone && (touchDragClone.style.display = 'none'); // Juste au cas où
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);

    // 1. Gestion Drop : POUBELLE
    const trashCan = elemBelow ? elemBelow.closest('#trashCan') : null;
    if (trashCan) {
        if (confirm(`Voulez-vous vraiment SUPPRIMER DÉFINITIVEMENT le membre ${touchDragItem.dataset.trigramme || 'N/A'} ?`)) {
            const memberId = touchDragItem.id;
            touchDragItem.remove();
            if (activeMemberId === memberId) {
                activeMemberId = null;
                document.getElementById('quickEditPanel').style.display = 'none';
            }
            persistAfterDrag();
        }
    }
    // 2. Gestion Drop : CONTENEURS (Véhicules ou Non assigné)
    else {
        const dropContainer = elemBelow ? elemBelow.closest('.patracdvr-members-container, #unassigned_members_container') : null;

        if (dropContainer) {
            // Logique d'insertion (similaire à handleDrop PC)
            dropContainer.appendChild(touchDragItem);

            const isUnassignedZone = dropContainer.id === 'unassigned_members_container';
            if (isUnassignedZone) {
                touchDragItem.dataset.cellule = 'Sans';
                touchDragItem.dataset.fonction = 'Sans';
            } else {
                if (touchDragItem.dataset.cellule === 'Sans') {
                    touchDragItem.dataset.cellule = 'India 1';
                }
            }

            updateMemberButtonVisuals(touchDragItem);
            if (touchDragItem.id === activeMemberId) {
                touchDragItem.classList.remove('member-active');
                activeMemberId = null;
                document.getElementById('quickEditPanel').style.display = 'none';
            }
            persistAfterDrag();
        }
    }

    // Reset variables
    touchDragItem = null;
    touchDragClone = null;
}

function handleDragEnter(e) {
    e.preventDefault();
    const targetContainer = e.currentTarget;

    // FIX: Utilisation de .dragging car dataTransfer.getData n'est pas accessible ici
    const draggedItem = document.querySelector('.dragging');

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        if (targetContainer.id === 'trashCan') {
            targetContainer.classList.add('drag-over');
        } else {
            targetContainer.style.border = '2px dashed var(--accent-blue)';
        }
    }
}

function handleDragOver(e) {
    e.preventDefault();
    const targetContainer = e.currentTarget;
    // FIX: Utilisation de .dragging car dataTransfer.getData n'est pas accessible ici
    const draggedItem = document.querySelector('.dragging');

    if (!draggedItem) return;

    // Gestion Drop Membres
    if (draggedItem.classList.contains('patracdvr-member-btn')) {
        if (targetContainer.id !== 'trashCan') {
            // Pour insérer le membre à l'endroit approprié dans le conteneur
            const afterElement = getDragAfterElement(targetContainer, e.clientY);

            if (afterElement == null) {
                targetContainer.appendChild(draggedItem);
            } else {
                targetContainer.insertBefore(draggedItem, afterElement);
            }
        }
    }
    // NOUVEAU: Gestion Drop Photos (Réorganisation)
    else if (draggedItem.classList.contains('image-preview-item') && targetContainer.classList.contains('image-preview-container')) {
        const draggableElements = [...targetContainer.querySelectorAll('.image-preview-item:not(.dragging)')];
        const afterElement = draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientX - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (afterElement == null) {
            targetContainer.appendChild(draggedItem);
        } else {
            targetContainer.insertBefore(draggedItem, afterElement);
        }
    }
}

function handleDragLeave(e) {
    const targetContainer = e.currentTarget;
    if (targetContainer.id === 'trashCan') {
        targetContainer.classList.remove('drag-over');
    } else {
        targetContainer.style.border = '1px dashed var(--border-color)';
    }
}

function handleDrop(e) {
    e.preventDefault();
    const targetContainer = e.currentTarget;
    const draggedId = e.dataTransfer.getData('text/plain');
    const draggedItem = document.getElementById(draggedId);

    if (targetContainer.id === 'trashCan') {
        handleDeleteDrop(e);
        return;
    }

    targetContainer.style.border = '1px dashed var(--border-color)';

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        // L'ordre a déjà été géré dans handleDragOver, on s'assure juste du parentage
        targetContainer.appendChild(draggedItem);

        const isUnassignedZone = targetContainer.id === 'unassigned_members_container';

        if (isUnassignedZone) {
            draggedItem.dataset.cellule = 'Sans';
            draggedItem.dataset.fonction = 'Sans';
        } else {
            // Si on déplace vers un véhicule, on réattribue une cellule par défaut si elle était "Sans"
            if (draggedItem.dataset.cellule === 'Sans') {
                draggedItem.dataset.cellule = 'India 1';
            }
        }

        updateMemberButtonVisuals(draggedItem);

        // Désélectionner le membre actif si déplacé
        if (draggedItem.id === activeMemberId) {
            draggedItem.classList.remove('member-active');
            activeMemberId = null;
            if (window.innerWidth >= 768) {
                document.getElementById('quickEditPanel').style.display = 'none';
            }
        }

        // CONFORMITÉ: Sauvegarde après le changement de conteneur/statut
        persistAfterDrag();
    } else if (draggedItem && draggedItem.classList.contains('image-preview-item')) {
        // Pour les photos, le DOM est déjà mis à jour par dragOver
        persistAfterDrag();
    }
}

function handleDeleteDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    // Récupération de l'élément draggé
    const draggedId = e.dataTransfer.getData('text/plain');
    const draggedItem = document.getElementById(draggedId);

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        // Utilisation d'un `confirm` natif
        const confirmation = confirm(`Voulez-vous vraiment SUPPRIMER DÉFINITIVEMENT le membre ${draggedItem.dataset.trigramme || 'N/A'} de la session ?`);

        if (confirmation) {
            const memberId = draggedItem.id;
            draggedItem.remove();

            if (activeMemberId === memberId) {
                activeMemberId = null;
                document.getElementById('quickEditPanel').style.display = 'none';
            }
            // CONFORMITÉ: Sauvegarde après suppression définitive
            persistAfterDrag();
        }
    }
}

function initializeDragDropListeners() {
    // Conteneurs statiques (uniquement ceux qui existent au chargement initial)
    const staticDropContainers = [
        document.getElementById('unassigned_members_container'),
        document.getElementById('trashCan')
    ].filter(Boolean);

    staticDropContainers.forEach(container => {
        container.addEventListener('dragenter', handleDragEnter);
        container.addEventListener('dragleave', handleDragLeave);
        container.addEventListener('dragover', handleDragOver);
        container.addEventListener('drop', handleDrop);
    });

    // Écouteur global pour le dragover des éléments de temps (à l'intérieur de leur conteneur)
    const timeEventsEl = document.getElementById('time_events_container');
    if (timeEventsEl) {
        timeEventsEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggedItem = document.querySelector('.dragging');
            const targetContainer = e.currentTarget;

            if (draggedItem && draggedItem.classList.contains('time-item')) {
                const afterElement = getDragAfterElement(targetContainer, e.clientY);

                if (afterElement == null) {
                    targetContainer.appendChild(draggedItem);
                } else {
                    targetContainer.insertBefore(draggedItem, afterElement);
                }
                persistAfterDrag();
            }
        });
    }

    // NOUVEAU: Écouteurs pour les galeries d'images (dragover pour permettre le drop)
    document.querySelectorAll('.image-preview-container').forEach(container => {
        container.addEventListener('dragover', handleDragOver);
        container.addEventListener('drop', handleDrop);
    });
}

/**
 * Même logique que 4.html : sans dragstart sur document, dataTransfer / .dragging ne sont pas gérés
 * (boutons draggable, items photo, etc.).
 */
let documentDragTransferInitialized = false;
function initDocumentDragTransfer() {
    if (documentDragTransferInitialized) return;
    documentDragTransferInitialized = true;

    document.addEventListener('dragstart', (e) => {
        const target = e.target.closest('.draggable');

        if (!target) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                e.preventDefault();
            }
            return;
        }

        e.dataTransfer.setData('text/plain', target.id);
        setTimeout(() => target.classList.add('dragging'), 0);
    });

    document.addEventListener('dragend', (e) => {
        const draggedItem = e.target.closest('.draggable');
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            persistAfterDrag();
        }
    });
}

window.initializeDragDropListeners = initializeDragDropListeners;
window.initDocumentDragTransfer = initDocumentDragTransfer;

