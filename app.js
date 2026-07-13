/**
 * Nexy AI — App Bootstrapper
 * Wires every module together, decides which screen to show, and owns the
 * top-level enter/exit transitions between the auth screens and the app shell.
 */
const App = (() => {
  function init() {
    Logger.info("Nexy AI iniciando…");

    // Global safety net: never let an uncaught error freeze the UI silently.
    window.addEventListener("error", (e) => {
      Logger.error("Error no capturado:", e.error || e.message);
    });
    window.addEventListener("unhandledrejection", (e) => {
      Logger.error("Promesa rechazada sin manejar:", e.reason);
    });

    ModalUI.init();
    AuthUI.init();
    ChatUI.init();
    SettingsUI.init();

    if (SessionService.isAuthenticated()) {
      enterApp();
    } else {
      showAuthScreen();
    }

    AiUsagePanel.start();
  }

  function showAuthScreen() {
    document.getElementById("auth-root").hidden = false;
    document.getElementById("app-root").hidden = true;
    AuthUI.switchTo("login");
  }

  function enterApp() {
    document.getElementById("auth-root").hidden = true;
    document.getElementById("app-root").hidden = false;
    refreshSidebarUser();
    ChatUI.loadForCurrentUser();
  }

  function refreshSidebarUser() {
    const acc = AccountService.getCurrent();
    if (!acc) return;
    document.getElementById("sidebar-username").textContent = acc.username;
    document.getElementById("sidebar-avatar").src = acc.avatarDataUrl || "assets/img/logo-star.png";
  }

  function logout(skipConfirmToast = false) {
    AccountService.logout();
    document.getElementById("login-form").reset();
    document.getElementById("register-form").reset();
    showAuthScreen();
    if (!skipConfirmToast) Toast.info("Sesión cerrada.");
  }

  return { init, enterApp, showAuthScreen, refreshSidebarUser, logout };
})();

document.addEventListener("DOMContentLoaded", App.init);
