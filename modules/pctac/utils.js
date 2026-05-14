/**
 * Utilitaires globaux pour PC TAC
 */

export const Utils = {
    /**
     * Compresse une image (redimensionnement et qualité JPEG)
     * @param {File|string} source - Fichier image ou Data URL
     * @param {number} maxWidth 
     * @param {number} maxHeight 
     * @param {number} quality 
     * @returns {Promise<string>} Data URL compressée
     */
    async compressImage(source, maxWidth = 1024, maxHeight = 1024, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;

            if (source instanceof File) {
                const reader = new FileReader();
                reader.onload = (e) => img.src = e.target.result;
                reader.onerror = reject;
                reader.readAsDataURL(source);
            } else {
                img.src = source;
            }
        });
    }
};
