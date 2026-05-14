import { QR_BATCH_SIZE } from './config.js';
import { Storage } from './storage.js';

/**
 * Logique de synchronisation par QR Code
 */

export const QrSync = {
    html5QrCode: null,
    qrChunks: [],
    currentIndex: 0,

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
        return chunks;
    },

    openModal(callback) {
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('transferModal').style.display = 'block';
        this.switchTab('send', callback);
    },

    closeModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('transferModal').style.display = 'none';
        this.stopScanner();
    },

    switchTab(tabName, callback) {
        const tabs = document.querySelectorAll('.transfer-tab-btn');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        
        document.querySelectorAll('.transfer-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`transfer-${tabName}`).classList.add('active');
        
        if (tabName === 'send') {
            this.stopScanner();
            this.preparePagination();
        } else {
            this.startScanner(callback);
        }
    },

    preparePagination() {
        const logs = Storage.loadLogData();
        const container = document.getElementById('qrcode-container');
        const statusText = document.getElementById('qr-status-text');
        const navControls = document.getElementById('qr-nav-controls');
        
        container.innerHTML = '';
        
        if (logs.length === 0) {
            container.textContent = "Aucune donnée à transférer.";
            if (statusText) statusText.textContent = "";
            if (navControls) navControls.style.display = 'none';
            return;
        }

        // Compression des données
        let compressedData = logs.map(l => [l.id, l.heure, l.pax, l.paxMode, l.paxColor, l.lieu, l.fenetrePorte, l.remarques]);
        
        this.qrChunks = this.chunkArray(compressedData, QR_BATCH_SIZE);
        this.currentIndex = 0;
        
        if (navControls) {
            navControls.style.display = this.qrChunks.length > 1 ? 'flex' : 'none';
        }
        
        setTimeout(() => {
            this.showQR(this.currentIndex);
        }, 50);
    },

    showQR(index) {
        const container = document.getElementById('qrcode-container');
        const statusText = document.getElementById('qr-status-text');
        const counter = document.getElementById('qr-counter');
        const prevBtn = document.getElementById('prevQrBtn');
        const nextBtn = document.getElementById('nextQrBtn');
        
        container.innerHTML = '';
        
        let transferPayload = { t: "PC-TAC-V1", d: this.qrChunks[index] };
        let jsonString = JSON.stringify(transferPayload);
        
        if (typeof QRCode !== 'undefined') {
            new QRCode(container, {
                text: jsonString,
                width: 256,
                height: 256,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L,
                typeNumber: 15
            });
        }
        
        if (this.qrChunks.length > 1) {
            if (statusText) statusText.textContent = `Page ${index + 1} sur ${this.qrChunks.length} - ${this.qrChunks[index].length} entrées.`;
            if (counter) counter.textContent = `${index + 1} / ${this.qrChunks.length}`;
            if (prevBtn) prevBtn.disabled = index === 0;
            if (nextBtn) nextBtn.disabled = index === this.qrChunks.length - 1;
        } else {
            if (statusText) statusText.textContent = `${this.qrChunks[0].length} entrées prêtes au transfert.`;
        }
    },

    startScanner(onSuccessCallback) {
        if (this.html5QrCode) return;
        if (typeof Html5Qrcode === 'undefined') return;

        this.html5QrCode = new Html5Qrcode("qr-reader");
        const config = { fps: 20, qrbox: { width: 250, height: 250 } };
        
        this.html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
            this.handleScanSuccess(decodedText, onSuccessCallback);
        })
        .catch(err => {
            document.getElementById('qr-reader').textContent = "Erreur caméra: " + err;
        });
    },

    stopScanner() {
        if (this.html5QrCode) { 
            this.html5QrCode.stop().then(() => {
                this.html5QrCode = null;
            }).catch(err => console.log("Stop failed", err));
        }
    },

    handleScanSuccess(decodedText, callback) {
        try {
            const data = JSON.parse(decodedText);
            if (data.d && Array.isArray(data.d)) {
                const currentLogs = Storage.loadLogData();
                const currentIds = new Set(currentLogs.map(l => l.id));
                let added = 0;
                
                data.d.forEach(item => { 
                    if (!currentIds.has(item[0])) { 
                        currentLogs.push({ 
                            id: item[0], heure: item[1], pax: item[2], paxMode: item[3], 
                            paxColor: item[4], lieu: item[5], fenetrePorte: item[6], remarques: item[7] 
                        }); 
                        added++; 
                    } 
                });

                if (added > 0) {
                    Storage.saveLogData(currentLogs);
                    if (callback) callback(currentLogs);
                    alert(`${added} entrées ajoutées.`);
                }
            }
        } catch (e) {
            console.error("Erreur de décodage QR:", e);
        }
    },

    nextPage() {
        if (this.currentIndex < this.qrChunks.length - 1) {
            this.currentIndex++;
            this.showQR(this.currentIndex);
        }
    },

    prevPage() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.showQR(this.currentIndex);
        }
    }
};

// Exposition globale
window.QrSync = QrSync;
