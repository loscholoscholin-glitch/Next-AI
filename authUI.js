/**
 * Nexy AI — Auth UI
 * Wires the login/register forms to AccountService with live validation,
 * password-strength feedback, and clear inline error handling.
 */
const AuthUI = (() => {
  function init() {
    document.getElementById("go-to-register").addEventListener("click", (e) => { e.preventDefault(); switchTo("register"); });
    document.getElementById("go-to-login").addEventListener("click", (e) => { e.preventDefault(); switchTo("login"); });

    document.querySelectorAll(".toggle-visibility").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        target.type = target.type === "password" ? "text" : "password";
        btn.textContent = target.type === "password" ? "👁" : "🙈";
      });
    });

    initLoginForm();
    initRegisterForm();
  }

  function switchTo(which) {
    document.getElementById("login-card").hidden = which !== "login";
    document.getElementById("register-card").hidden = which !== "register";
    hideBanner("login-banner");
    hideBanner("register-banner");
  }

  function showBanner(id, message, type = "error") {
    const el = document.getElementById(id);
    el.textContent = message;
    el.className = `form-banner ${type}`;
    el.hidden = false;
  }
  function hideBanner(id) {
    document.getElementById(id).hidden = true;
  }

  function setFieldError(inputId, errorId, message) {
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (message) {
      input.classList.add("invalid");
      errorEl.textContent = message;
    } else {
      input.classList.remove("invalid");
      errorEl.textContent = "";
    }
  }

  function setLoading(buttonId, loading) {
    const btn = document.getElementById(buttonId);
    btn.disabled = loading;
    btn.querySelector(".btn-label").style.opacity = loading ? "0" : "1";
    btn.querySelector(".btn-spinner").hidden = !loading;
  }

  function initLoginForm() {
    const form = document.getElementById("login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("login-banner");
      const username = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;

      setFieldError("login-username", "login-username-error", Utils.isBlank(username) ? "Requerido." : "");
      setFieldError("login-password", "login-password-error", Utils.isBlank(password) ? "Requerido." : "");
      if (Utils.isBlank(username) || Utils.isBlank(password)) return;

      setLoading("login-submit", true);
      try {
        const result = await AccountService.login(username, password);
        if (!result.success) {
          showBanner("login-banner", result.error, "error");
          form.closest(".auth-card").classList.add("shake");
          setTimeout(() => form.closest(".auth-card").classList.remove("shake"), 400);
          return;
        }
        Toast.success(`Bienvenido de nuevo, ${result.account.username}.`);
        App.enterApp();
      } catch (err) {
        Logger.error("Login falló inesperadamente:", err);
        showBanner("login-banner", "Ocurrió un error inesperado. Intenta de nuevo.", "error");
      } finally {
        setLoading("login-submit", false);
      }
    });
  }

  function initRegisterForm() {
    const form = document.getElementById("register-form");
    const passwordInput = document.getElementById("register-password");
    const usernameInput = document.getElementById("register-username");
    const confirmInput = document.getElementById("register-confirm");

    usernameInput.addEventListener("input", Utils.debounce(() => {
      const check = Validation.validateUsername(usernameInput.value);
      setFieldError("register-username", "register-username-error", check.valid ? "" : check.error);
    }, 250));

    passwordInput.addEventListener("input", () => {
      updateStrengthUI(passwordInput.value);
      if (confirmInput.value) {
        const c = Validation.validateConfirmPassword(passwordInput.value, confirmInput.value);
        setFieldError("register-confirm", "register-confirm-error", c.valid ? "" : c.error);
      }
    });

    confirmInput.addEventListener("input", () => {
      const c = Validation.validateConfirmPassword(passwordInput.value, confirmInput.value);
      setFieldError("register-confirm", "register-confirm-error", c.valid ? "" : c.error);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("register-banner");

      const username = usernameInput.value;
      const password = passwordInput.value;
      const confirm = confirmInput.value;

      const uCheck = Validation.validateUsername(username);
      const pCheck = Validation.validatePassword(password);
      const cCheck = Validation.validateConfirmPassword(password, confirm);

      setFieldError("register-username", "register-username-error", uCheck.valid ? "" : uCheck.error);
      setFieldError("register-password", "register-password-error", pCheck.valid ? "" : pCheck.error);
      setFieldError("register-confirm", "register-confirm-error", cCheck.valid ? "" : cCheck.error);

      if (!uCheck.valid || !pCheck.valid || !cCheck.valid) return;

      setLoading("register-submit", true);
      try {
        const exists = await AccountService.usernameExists(username);
        if (exists) {
          setFieldError("register-username", "register-username-error", "Ese nombre de usuario ya está en uso.");
          return;
        }
        const result = await AccountService.register(username, password);
        if (!result.success) {
          showBanner("register-banner", result.error, "error");
          return;
        }
        showBanner("register-banner", "¡Cuenta creada con éxito!", "success");
        Toast.success(`Cuenta creada. ¡Bienvenido, ${result.account.username}!`);
        setTimeout(() => App.enterApp(), 500);
      } catch (err) {
        Logger.error("Registro falló inesperadamente:", err);
        showBanner("register-banner", "Ocurrió un error inesperado. Intenta de nuevo.", "error");
      } finally {
        setLoading("register-submit", false);
      }
    });
  }

  function updateStrengthUI(password) {
    const { score, label, color, checks } = Validation.passwordStrength(password);
    const fill = document.getElementById("strength-fill");
    const labelEl = document.getElementById("strength-label");
    const pct = password ? ((score + 1) / 5) * 100 : 0;
    fill.style.width = `${pct}%`;
    fill.style.background = color;
    labelEl.textContent = password ? label : "";

    document.querySelectorAll("#password-rules li").forEach((li) => {
      const rule = li.dataset.rule;
      li.classList.toggle("met", !!checks[rule]);
    });

    setFieldError("register-password", "register-password-error", "");
  }

  return { init, switchTo };
})();
