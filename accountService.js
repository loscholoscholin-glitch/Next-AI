/**
 * Nexy AI — Account Service
 * Single source of truth for accounts. Guarantees:
 *  - No duplicate usernames regardless of capitalization (case-insensitive index).
 *  - No corrupted accounts persisted (every write is schema-validated first).
 *  - Passwords are always hashed before hitting storage (see CryptoService).
 *  - Username changes are rate-limited server-side-equivalent (enforced here, not just in UI).
 */
const AccountService = (() => {
  const ACCOUNTS_KEY = "accounts";           // { [normalizedUsername]: Account }
  const USERNAME_COOLDOWN_DAYS = 7;

  function readAccounts() {
    const data = Storage.get(ACCOUNTS_KEY, {});
    // Defensive: ensure it's a plain object, never an array/null/corrupted primitive.
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  }

  function writeAccounts(accounts) {
    return Storage.set(ACCOUNTS_KEY, accounts);
  }

  function isValidAccountShape(acc) {
    return acc && typeof acc === "object"
      && typeof acc.username === "string"
      && typeof acc.passwordHash === "string"
      && typeof acc.createdAt === "number";
  }

  async function usernameExists(username) {
    const norm = Utils.normalizeUsername(username);
    const accounts = readAccounts();
    return Object.prototype.hasOwnProperty.call(accounts, norm);
  }

  async function register(username, password) {
    const usernameCheck = Validation.validateUsername(username);
    if (!usernameCheck.valid) return { success: false, error: usernameCheck.error };

    const passwordCheck = Validation.validatePassword(password);
    if (!passwordCheck.valid) return { success: false, error: passwordCheck.error };

    const accounts = readAccounts();
    const norm = usernameCheck.normalized;

    if (Object.prototype.hasOwnProperty.call(accounts, norm)) {
      return { success: false, error: "Ese nombre de usuario ya está en uso." };
    }

    let passwordHash;
    try {
      passwordHash = await CryptoService.hashPassword(password);
    } catch (err) {
      Logger.error("Fallo al generar hash de contraseña:", err);
      return { success: false, error: "No se pudo procesar la contraseña de forma segura. Intenta de nuevo." };
    }

    const now = Date.now();
    const account = {
      id: Utils.uid("acc"),
      username: username.trim(),          // display casing preserved
      usernameNormalized: norm,
      passwordHash,
      createdAt: now,
      lastLoginAt: now,
      lastUsernameChangeAt: null,
      avatarDataUrl: null,
      stats: { messagesSent: 0, chatsCreated: 0, loginCount: 1 },
      settings: {
        thinkingLevel: "medium",
        performanceMode: false,
        theme: "dark",
      },
      apiKeys: {},   // { providerId: { obscured, provider, addedAt, lastValidatedAt, valid } }
    };

    if (!isValidAccountShape(account)) {
      Logger.error("Cuenta generada con forma inválida, abortando registro.", account);
      return { success: false, error: "Error interno al crear la cuenta. Intenta de nuevo." };
    }

    accounts[norm] = account;
    const ok = writeAccounts(accounts);
    if (!ok) return { success: false, error: "No se pudo guardar la cuenta (almacenamiento lleno o bloqueado)." };

    SessionService.createSession(account);
    EventBus.emit("account:created", { username: account.username });
    return { success: true, account: sanitize(account) };
  }

  async function login(username, password) {
    if (Utils.isBlank(username) || Utils.isBlank(password)) {
      return { success: false, error: "Usuario y contraseña son obligatorios." };
    }
    const norm = Utils.normalizeUsername(username);
    const accounts = readAccounts();
    const account = accounts[norm];

    if (!account || !isValidAccountShape(account)) {
      // Constant-ish delay to avoid trivially revealing whether the username exists.
      await CryptoService.hashPassword(password).catch(() => {});
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    const valid = await CryptoService.verifyPassword(password, account.passwordHash);
    if (!valid) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    account.lastLoginAt = Date.now();
    account.stats.loginCount = (account.stats.loginCount || 0) + 1;
    accounts[norm] = account;
    writeAccounts(accounts);

    SessionService.createSession(account);
    EventBus.emit("account:login", { username: account.username });
    return { success: true, account: sanitize(account) };
  }

  function logout() {
    const user = SessionService.getCurrentUsername();
    SessionService.destroySession();
    EventBus.emit("account:logout", { username: user });
  }

  function getByNormalized(norm) {
    const accounts = readAccounts();
    return accounts[norm] || null;
  }

  function getCurrent() {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return null;
    const account = getByNormalized(norm);
    return account ? sanitize(account) : null;
  }

  function sanitize(account) {
    // Never leak the password hash into the UI layer.
    const { passwordHash, ...rest } = account;
    return rest;
  }

  function persist(mutatorFn) {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return { success: false, error: "No hay sesión activa." };
    const accounts = readAccounts();
    const account = accounts[norm];
    if (!account) return { success: false, error: "Cuenta no encontrada." };
    const result = mutatorFn(account);
    if (result && result.abort) return result;
    if (!isValidAccountShape(account)) {
      Logger.error("Mutación produjo una cuenta inválida, revirtiendo.", account);
      return { success: false, error: "No se pudo guardar el cambio." };
    }
    accounts[norm] = account;
    const ok = writeAccounts(accounts);
    if (!ok) return { success: false, error: "No se pudo guardar (almacenamiento lleno)." };
    return { success: true, account: sanitize(account) };
  }

  async function changePassword(currentPassword, newPassword, confirmPassword) {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return { success: false, error: "No hay sesión activa." };
    const account = getByNormalized(norm);
    if (!account) return { success: false, error: "Cuenta no encontrada." };

    const currentValid = await CryptoService.verifyPassword(currentPassword, account.passwordHash);
    if (!currentValid) return { success: false, error: "La contraseña actual es incorrecta." };

    const strengthCheck = Validation.validatePassword(newPassword);
    if (!strengthCheck.valid) return { success: false, error: strengthCheck.error };

    const confirmCheck = Validation.validateConfirmPassword(newPassword, confirmPassword);
    if (!confirmCheck.valid) return { success: false, error: confirmCheck.error };

    const newHash = await CryptoService.hashPassword(newPassword);
    return persist((acc) => { acc.passwordHash = newHash; });
  }

  function getUsernameCooldownInfo(account) {
    if (!account.lastUsernameChangeAt) return { onCooldown: false };
    const daysPassed = Utils.daysBetween(account.lastUsernameChangeAt, Date.now());
    const remaining = USERNAME_COOLDOWN_DAYS - daysPassed;
    if (remaining <= 0) return { onCooldown: false };
    const nextAvailable = account.lastUsernameChangeAt + USERNAME_COOLDOWN_DAYS * 86400000;
    return { onCooldown: true, remainingDays: remaining, nextAvailableAt: nextAvailable };
  }

  async function changeUsername(newUsername) {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return { success: false, error: "No hay sesión activa." };
    const account = getByNormalized(norm);
    if (!account) return { success: false, error: "Cuenta no encontrada." };

    // Server-side-equivalent enforcement: never trust the UI to have checked this.
    const cooldown = getUsernameCooldownInfo(account);
    if (cooldown.onCooldown) {
      return { success: false, error: `Debes esperar ${cooldown.remainingDays} día(s) más para cambiar tu usuario de nuevo.`, cooldown };
    }

    const check = Validation.validateUsername(newUsername);
    if (!check.valid) return { success: false, error: check.error };

    const newNorm = check.normalized;
    if (newNorm === norm) return { success: false, error: "Ese ya es tu nombre de usuario actual." };

    const accounts = readAccounts();
    if (Object.prototype.hasOwnProperty.call(accounts, newNorm)) {
      return { success: false, error: "Ese nombre de usuario ya está en uso." };
    }

    // Move the record under the new normalized key atomically.
    delete accounts[norm];
    account.username = newUsername.trim();
    account.usernameNormalized = newNorm;
    account.lastUsernameChangeAt = Date.now();
    accounts[newNorm] = account;

    const ok = writeAccounts(accounts);
    if (!ok) return { success: false, error: "No se pudo guardar el cambio de usuario." };

    SessionService.updateSessionUsername(account);
    EventBus.emit("account:username-changed", { username: account.username });
    return { success: true, account: sanitize(account) };
  }

  async function setAvatar(dataUrl) {
    return persist((acc) => { acc.avatarDataUrl = dataUrl; });
  }

  function updateSettings(partial) {
    return persist((acc) => { acc.settings = { ...acc.settings, ...partial }; });
  }

  function incrementStat(statName, by = 1) {
    return persist((acc) => {
      acc.stats = acc.stats || {};
      acc.stats[statName] = (acc.stats[statName] || 0) + by;
    });
  }

  async function deleteAccount(password) {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return { success: false, error: "No hay sesión activa." };
    const account = getByNormalized(norm);
    if (!account) return { success: false, error: "Cuenta no encontrada." };

    const valid = await CryptoService.verifyPassword(password, account.passwordHash);
    if (!valid) return { success: false, error: "Contraseña incorrecta." };

    const accounts = readAccounts();
    delete accounts[norm];
    writeAccounts(accounts);
    ChatService.deleteAllChatsForUser(norm);
    ApiKeyService.deleteAllForUser(norm);
    SessionService.destroySession();
    EventBus.emit("account:deleted", { username: account.username });
    return { success: true };
  }

  function exportAccountData() {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return null;
    const account = getByNormalized(norm);
    if (!account) return null;
    const { passwordHash, apiKeys, ...safeAccount } = account;
    const chats = ChatService.getAllChatsForUser(norm);
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: Storage.SCHEMA_VERSION,
      account: safeAccount,
      chats,
    };
  }

  function backupAccountData() {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) return null;
    const account = getByNormalized(norm);
    if (!account) return null;
    // Full backup includes hash + keys (obscured) so it can be restored 1:1 locally.
    const chats = ChatService.getAllChatsForUser(norm);
    const apiKeys = ApiKeyService.getAllForUser(norm);
    return {
      backupType: "nexyai-full-backup",
      createdAt: new Date().toISOString(),
      schemaVersion: Storage.SCHEMA_VERSION,
      account,
      chats,
      apiKeys,
    };
  }

  async function importBackup(json) {
    try {
      const data = typeof json === "string" ? JSON.parse(json) : json;
      if (!data || data.backupType !== "nexyai-full-backup" || !isValidAccountShape(data.account)) {
        return { success: false, error: "El archivo de respaldo no es válido o está corrupto." };
      }
      const accounts = readAccounts();
      const norm = data.account.usernameNormalized || Utils.normalizeUsername(data.account.username);
      if (Object.prototype.hasOwnProperty.call(accounts, norm)) {
        return { success: false, error: "Ya existe una cuenta con ese nombre de usuario en este dispositivo." };
      }
      accounts[norm] = data.account;
      writeAccounts(accounts);
      if (Array.isArray(data.chats)) ChatService.restoreChatsForUser(norm, data.chats);
      if (data.apiKeys) ApiKeyService.restoreForUser(norm, data.apiKeys);
      EventBus.emit("account:imported", { username: data.account.username });
      return { success: true };
    } catch (err) {
      Logger.error("Fallo al importar respaldo:", err);
      return { success: false, error: "No se pudo leer el archivo de respaldo (formato inválido)." };
    }
  }

  return {
    register, login, logout, getCurrent, getByNormalized, usernameExists,
    changePassword, changeUsername, getUsernameCooldownInfo, setAvatar,
    updateSettings, incrementStat, deleteAccount, exportAccountData,
    backupAccountData, importBackup, USERNAME_COOLDOWN_DAYS,
  };
})();
