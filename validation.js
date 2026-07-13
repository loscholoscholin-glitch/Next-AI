/**
 * Nexy AI — Validation Service
 * Centralized validation rules so UI, registration and username-change flows
 * all enforce identical constraints (single source of truth).
 */
const Validation = (() => {
  const USERNAME_MIN = 3;
  const USERNAME_MAX = 20;
  const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
  const PASSWORD_MIN = 8;

  function validateUsername(raw) {
    const value = (raw || "");
    if (Utils.isBlank(value)) return { valid: false, error: "El usuario no puede estar vacío." };
    if (value !== value.trim()) return { valid: false, error: "El usuario no puede tener espacios al inicio o al final." };
    if (value.trim().length !== value.length || /\s/.test(value)) return { valid: false, error: "El usuario no puede contener espacios." };
    const trimmed = value.trim();
    if (trimmed.length < USERNAME_MIN) return { valid: false, error: `El usuario debe tener al menos ${USERNAME_MIN} caracteres.` };
    if (trimmed.length > USERNAME_MAX) return { valid: false, error: `El usuario no puede superar ${USERNAME_MAX} caracteres.` };
    if (!USERNAME_REGEX.test(trimmed)) return { valid: false, error: "Solo se permiten letras, números y guion bajo (_)." };
    return { valid: true, normalized: Utils.normalizeUsername(trimmed) };
  }

  function passwordRuleChecks(password) {
    const value = password || "";
    return {
      length: value.length >= PASSWORD_MIN,
      upper: /[A-Z]/.test(value),
      lower: /[a-z]/.test(value),
      number: /[0-9]/.test(value),
      special: /[^A-Za-z0-9]/.test(value),
    };
  }

  function validatePassword(password) {
    if (Utils.isBlank(password)) return { valid: false, error: "La contraseña no puede estar vacía.", checks: passwordRuleChecks("") };
    const checks = passwordRuleChecks(password);
    const allMet = Object.values(checks).every(Boolean);
    return {
      valid: allMet,
      error: allMet ? null : "La contraseña no cumple todos los requisitos de seguridad.",
      checks,
    };
  }

  /** Returns { score: 0-4, label, color } for live strength UI. */
  function passwordStrength(password) {
    const checks = passwordRuleChecks(password || "");
    const metCount = Object.values(checks).filter(Boolean).length;
    const lengthBonus = (password || "").length >= 12 ? 1 : 0;
    const score = Utils.clamp(metCount - 1 + lengthBonus, 0, 4);
    const map = [
      { label: "Muy débil", color: "var(--danger)" },
      { label: "Débil", color: "var(--danger)" },
      { label: "Media", color: "var(--warning)" },
      { label: "Fuerte", color: "var(--success)" },
      { label: "Muy fuerte", color: "var(--success)" },
    ];
    return { score, ...map[score], checks };
  }

  function validateConfirmPassword(password, confirm) {
    if (Utils.isBlank(confirm)) return { valid: false, error: "Confirma tu contraseña." };
    if (password !== confirm) return { valid: false, error: "Las contraseñas no coinciden." };
    return { valid: true };
  }

  return { validateUsername, validatePassword, passwordStrength, passwordRuleChecks, validateConfirmPassword, USERNAME_MIN, USERNAME_MAX, PASSWORD_MIN };
})();
