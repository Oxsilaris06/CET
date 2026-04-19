/**
 * Notification System (Toast)
 * Replace disruptive alert() calls with non-intrusive UI feedback.
 */

const NotificationSystem = {
    container: null,

    init() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);

        // Inject standard styles if not present
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                .toast {
                    min-width: 250px;
                    padding: 12px 20px;
                    background: var(--bg-card, #2a2a2a);
                    color: var(--text-primary, #ffffff);
                    border-left: 5px solid var(--accent-blue, #3b82f6);
                    border-radius: 8px;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
                    font-family: 'Oswald', sans-serif;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    pointer-events: auto;
                    animation: toast-in 0.3s ease forwards;
                    transition: all 0.3s ease;
                }
                .toast.success { border-left-color: var(--success-green, #10b981); }
                .toast.error { border-left-color: var(--danger-red, #ef4444); }
                .toast.warning { border-left-color: var(--effraction-gold, #d4af37); }
                
                @keyframes toast-in {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes toast-out {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    },

    show(message, type = 'info', duration = 4000) {
        this.init();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check_circle';
        if (type === 'error') icon = 'error';
        if (type === 'warning') icon = 'warning';

        toast.innerHTML = `
            <span class="material-symbols-outlined">${icon}</span>
            <span class="toast-message">${message}</span>
        `;

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-out 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

window.showNotification = (msg, type, dur) => NotificationSystem.show(msg, type, dur);
window.toast = window.showNotification; // Alias court
