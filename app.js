// js/app.js - Módulo de Conexión a Puter

document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("login-puter-btn");
    const authRoot = document.getElementById("auth-root");
    const appRoot = document.getElementById("app-root");

    // 1. Verificar si Puter está cargado en el navegador
    if (typeof puter === 'undefined') {
        console.error("❌ El SDK de Puter no se ha cargado. Verifica tu conexión a internet o el script en el HTML.");
        alert("No se pudo cargar el motor de Puter. Revisa tu conexión.");
        return;
    }

    console.log("⚡ Puter SDK detectado con éxito.");

    // 2. Comprobar si el usuario ya inició sesión previamente
    if (puter.auth.isSignedIn()) {
        console.log("¡Sesión activa detectada!");
        mostrarApp();
    } else {
        console.log("Usuario no autenticado. Esperando interacción...");
    }

    // 3. Evento para conectar con Puter al hacer clic
    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            loginBtn.disabled = true;
            const originalLabel = loginBtn.innerHTML;
            loginBtn.innerHTML = '<span class="btn-label">Conectando...</span>';

            try {
                // Esto abre la ventana flotante segura de Puter
                await puter.auth.signIn();
                
                if (puter.auth.isSignedIn()) {
                    console.log("✅ Conexión exitosa con Puter.");
                    mostrarApp();
                } else {
                    throw new Error("El usuario canceló la autenticación.");
                }
            } catch (error) {
                console.error("❌ Error al conectar con Puter:", error);
                alert("Error de conexión: " + error.message);
                loginBtn.disabled = false;
                loginBtn.innerHTML = originalLabel;
            }
        });
    }

    // Función para dar paso a la interfaz de Nexy AI
    function mostrarApp() {
        if (authRoot) authRoot.hidden = true;
        if (appRoot) appRoot.hidden = false;
        
        // Obtener datos del usuario de Puter para personalizar la UI
        puter.auth.getUser().then(user => {
            console.log(`Bienvenido, ${user.username}`);
            // Aquí puedes pintar el nombre o el avatar de Puter en tu chat-title o sidebar
            const chatTitle = document.getElementById("chat-title");
            if (chatTitle) {
                chatTitle.textContent = `Sesión de ${user.username}`;
            }
        }).catch(err => {
            console.warn("No se pudieron obtener los datos detallados del usuario:", err);
        });
    }
});
