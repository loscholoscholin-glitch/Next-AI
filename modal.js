/**
 * Nexy AI — Confirm Modal
 * Promise-based wrapper around the single #confirm-overlay markup in index.html.
 * Usage:
 *   const ok = await ModalUI.open({ title, message, confirmLabel, danger });
 *   const result = await ModalUI.open({ title, message, requirePassword: true, confirmLabel });
 *   if (result?.password) { ... }
 *
 * Only one confirm dialog can be open at a time by design (it's a single shared
 * overlay) — opening a second one while one is pending auto-resolves the first
 * as cancelled so no listener/promise is ever left dangling.
 */
const ModalUI = (() => {
  let pendingResolve = null;

  function els() {
    return {
      overlay: document.getElementById("confirm-overlay"),
      title: document.getElementById("confirm-title"),
      message: document.getElementById("confirm-message"),
      passwordField: document.getElementById("confirm-password-field"),
      passwordInput: document.getElementById("confirm-password-input"),
      cancelBtn: document.getElementById("confirm-cancel"),
      acceptBtn: document.getElementById("confirm-accept"),
    };
  }

  function init() {
    const { overlay, cancelBtn, acceptBtn } = els();
    cancelBtn.addEventListener("click", () => settle(false));
    acceptBtn.addEventListener("click", onAccept);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) settle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) settle(false);
      if (e.key === "Enter" && !overlay.hidden && document.activeElement !== els().passwordInput) onAccept();
    });
  }

  function onAccept() {
    const { passwordField, passwordInput } = els();
    if (!passwordField.hidden) {
      if (Utils.isBlank(passwordInput.value)) {
        passwordInput.focus();
        passwordInput.classList.add("invalid");
        return;
      }
      settle({ password: passwordInput.value });
      return;
    }
    settle(true);
  }

  function settle(value) {
    const { overlay, passwordInput } = els();
    overlay.hidden = true;
    passwordInput.value = "";
    passwordInput.classList.remove("invalid");
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(value);
    }
  }

  /**
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string} [opts.confirmLabel="Confirmar"]
   * @param {boolean} [opts.danger=false]
   * @param {boolean} [opts.requirePassword=false]
   * @returns {Promise<boolean|{password:string}|false>}
   */
  function open({ title = "¿Estás seguro?", message = "", confirmLabel = "Confirmar", danger = false, requirePassword = false } = {}) {
    // If a previous dialog is somehow still pending (shouldn't normally happen
    // since this is a single shared overlay), resolve it as cancelled first
    // rather than leaking its promise forever.
    if (pendingResolve) settle(false);

    const { overlay, title: titleEl, message: messageEl, passwordField, passwordInput, acceptBtn } = els();
    titleEl.textContent = title;
    messageEl.textContent = message;
    passwordField.hidden = !requirePassword;
    passwordInput.value = "";
    passwordInput.classList.remove("invalid");
    acceptBtn.textContent = confirmLabel;
    acceptBtn.className = danger ? "btn btn-danger" : "btn btn-primary";
    overlay.hidden = false;

    if (requirePassword) {
      setTimeout(() => passwordInput.focus(), 50);
    }

    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  }

  return { init, open };
})();
