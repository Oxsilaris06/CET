/**
 * navigation.js — Navigation de l'assistant (wizard) : affichage et changement d'étape.
 * Chargé par : 4.html
 * Fonctions principales : showStep, goToStep, changeStep
 */
// ==================== Wizard.js ====================


function showStep(n) {
    steps.forEach((step, index) => step.classList.toggle('active', index === n));
    progressSteps.forEach((pStep, index) => {
        pStep.classList.toggle('active', index === n);
        if (visitedSteps.has(index) && index !== n) pStep.classList.add('completed');
        else pStep.classList.remove('completed');
    });
    prevBtn.style.display = n === 0 ? "none" : "inline-block";
    // 8 étapes au total (index 0 à 7). La dernière étape est l'index steps.length - 1.
    const isLastStep = n === (steps.length - 1);
    nextBtn.style.display = isLastStep ? "none" : "inline-block";

    if (isLastStep) {
        previewBtn.style.display = "inline-block";
        // OI1 — flush immédiat pour que checkCoherence lise la dernière frappe.
        if (typeof window.flushFormData === 'function') window.flushFormData();
        checkCoherence();
    } else {
        previewBtn.style.display = "none";
    }

    // Repositionne en haut à chaque changement d'étape (supprime le re-scroll manuel).
    try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
}

function goToStep(n) {
    if (n >= 0 && n < steps.length) {
        const from = Store.state.currentStep;
        visitedSteps.add(from);
        // Saut via une puce : marque visitées toutes les étapes de l'intervalle parcouru.
        const lo = Math.min(from, n), hi = Math.max(from, n);
        for (let i = lo; i < hi; i++) visitedSteps.add(i);
        Store.state.currentStep = n;
        localStorage.setItem('oiWizardStep', String(n));
        try { localStorage.setItem('oiVisitedSteps', JSON.stringify(Array.from(visitedSteps))); } catch (e) { /* quota */ }
        showStep(n);
    }
}

function changeStep(n) { goToStep(Store.state.currentStep + n); }

