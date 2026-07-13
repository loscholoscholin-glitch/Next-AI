/**
 * Nexy AI — Toast Notifications
 * Renders into #toast-container (see index.html + animations.css). Auto-dismisses,
 * supports manual close, and never lets an unclosed timer/leftover DOM node pile up.
 */
const Toast = (() => {
  const ICONS = { success: "✓", error: "⚠", info: "ℹ", warning: "⚠" };
  const DEFAULT_DURATION = 4000;

  function container() {
    return document.getElementById("toast-container");
  }

  function show(message, type = "info", duration = DEFAULT_DURATION) {
    const root = container();
    if (!root) {
      // Toast fired before the DOM/root existed (very early boot). Don't crash — just log it.
      Logger?.warn?.("Toast: #toast-container no existe todavía; mensaje perdido:", message);
      return;
    }

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
      <span class="toast-msg"></span>
      <button class="toast-close" aria-label="Cerrar notificación">✕</button>
    `;
    // Message set via textContent, not innerHTML, so arbitrary error strings can never inject markup.
    el.querySelector(".toast-msg").textContent = message;

    let dismissTimer = null;
    const dismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      if (!el.isConnected) return;
      el.classList.add("leaving");
      el.addEventListener("animationend", () => el.remove(), { once: true });
      // Safety net in case the animationend event never fires (e.g. perf mode sets durations to 0ms).
      setTimeout(() => el.remove(), 500);
    };

    el.querySelector(".toast-close").addEventListener("click", dismiss);
    root.appendChild(el);

    if (duration > 0) {
      dismissTimer = setTimeout(dismiss, duration);
    }

    return { dismiss };
  }

  function success(message, duration) { return show(message, "success", duration); }
  function error(message, duration) { return show(message, "error", duration ?? 6000); }
  function info(message, duration) { return show(message, "info", duration); }
  function warning(message, duration) { return show(message, "warning", duration); }

  return { show, success, error, info, warning };
})();
