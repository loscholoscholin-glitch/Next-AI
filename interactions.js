/**
 * Nexy AI - UI Interactions & Shortcuts by Brahyan2021
 */
document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Efecto 3D de la tarjeta que mira al cursor (Auth y Chat)
    document.addEventListener("mousemove", (e) => {
        const glow = document.getElementById("cursor-glow");
        if (glow) {
            glow.style.left = `${e.clientX}px`;
            glow.style.top = `${e.clientY}px`;
        }

        const cards = document.querySelectorAll('.tilt-card');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            // Calcula la inclinación (suave)
            const tiltX = ((x - centerX) / centerX) * 5; // Max 5 grados
            const tiltY = ((y - centerY) / centerY) * -5;
            
            card.style.setProperty('--tilt-x', `${tiltX}deg`);
            card.style.setProperty('--tilt-y', `${tiltY}deg`);
        });
    });

    // Restaurar posición al salir del elemento
    document.querySelectorAll('.tilt-card').forEach(card => {
        card.addEventListener('mouseleave', () => {
            card.style.setProperty('--tilt-x', `0deg`);
            card.style.setProperty('--tilt-y', `0deg`);
        });
    });

    // 2. ATAJOS DE TECLADO GLOBALES
    document.addEventListener("keydown", (e) => {
        const input = document.getElementById("composer-input");
        const sendBtn = document.getElementById("composer-send");

        // [Ctrl + Enter] para enviar el mensaje rápidamente
        if (e.ctrlKey && e.key === "Enter") {
            e.preventDefault();
            if (sendBtn && !sendBtn.disabled) sendBtn.click();
        }

        // [Esc] para cerrar el modal de ajustes (si está abierto)
        if (e.key === "Escape") {
            const settings = document.getElementById("settings-overlay");
            if (settings && !settings.hidden) {
                settings.hidden = true;
            }
        }
        
        // Enfocar el chat rápidamente al escribir en cualquier lado (si no estás en un input)
        if (e.key.length === 1 && document.activeElement !== input && document.getElementById("app-root").hidden === false) {
             // Opcional: auto-focus
        }
    });

    // 3. LÓGICA DE SUBIDA DE ARCHIVOS / FOTOS
    const attachBtn = document.getElementById("attach-btn");
    const fileInput = document.getElementById("file-upload");
    const previewContainer = document.getElementById("attachment-preview-container");

    if (attachBtn && fileInput) {
        attachBtn.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                previewContainer.hidden = false;
                Array.from(files).forEach(file => {
                    // Si es imagen, crear miniatura
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const img = document.createElement('img');
                            img.src = ev.target.result;
                            img.className = 'img-preview-thumb avatar-cropped';
                            previewContainer.appendChild(img);
                        };
                        reader.readAsDataURL(file);
                    } else {
                        // Icono de documento para texto/pdf
                        const docDiv = document.createElement('div');
                        docDiv.className = 'img-preview-thumb';
                        docDiv.style.background = '#333';
                        docDiv.style.display = 'flex';
                        docDiv.style.alignItems = 'center';
                        docDiv.style.justifyContent = 'center';
                        docDiv.textContent = file.name.split('.').pop().toUpperCase();
                        previewContainer.appendChild(docDiv);
                    }
                });
            }
        });
    }
});
