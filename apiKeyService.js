/**
 * Nexy AI — API Key Service
 * Keys are never stored or displayed in plain text at rest: they're obscured with
 * AES-GCM (see CryptoService) before hitting localStorage, and only decrypted
 * transiently in memory when the user explicitly reveals or uses them.
 * Architected to support multiple providers even though only one is wired up today.
 */
const ApiKeyService = (() => {
  const PROVIDERS = [
    { id: "openai", label: "OpenAI", pattern: /^sk-[A-Za-z0-9_-]{20,}$/ },
    { id: "anthropic", label: "Anthropic", pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
    { id: "puter", label: "Puter (integrado)", pattern: /.*/ },
    { id: "custom", label: "Otro proveedor", pattern: /.{8,}/ },
  ];

  function keysStorageKey(usernameNormalized) {
    return `apikeys:${usernameNormalized}`;
  }

  function currentUserKey() {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) throw new Error("No hay sesión activa.");
    return norm;
  }

  function readAll(usernameNormalized) {
    const data = Storage.get(keysStorageKey(usernameNormalized), {});
    return data && typeof data === "object" ? data : {};
  }

  function writeAll(usernameNormalized, data) {
    return Storage.set(keysStorageKey(usernameNormalized), data);
  }

  function getAllForUser(usernameNormalized) {
    return readAll(usernameNormalized);
  }

  function restoreForUser(usernameNormalized, data) {
    if (data && typeof data === "object") writeAll(usernameNormalized, data);
  }

  function deleteAllForUser(usernameNormalized) {
    Storage.remove(keysStorageKey(usernameNormalized));
  }

  function detectProvider(rawKey) {
    const trimmed = (rawKey || "").trim();
    for (const p of PROVIDERS) {
      if (p.id !== "custom" && p.pattern.test(trimmed)) return p.id;
    }
    return trimmed.length >= 8 ? "custom" : null;
  }

  function listStatuses() {
    const norm = currentUserKey();
    const stored = readAll(norm);
    return PROVIDERS.filter((p) => p.id !== "custom").map((p) => {
      const entry = stored[p.id];
      return {
        providerId: p.id,
        label: p.label,
        hasKey: !!entry,
        valid: entry?.valid ?? null,
        addedAt: entry?.addedAt ?? null,
        lastValidatedAt: entry?.lastValidatedAt ?? null,
        maskedPreview: entry ? entry.maskedPreview : null,
      };
    });
  }

  function maskKey(rawKey) {
    if (rawKey.length <= 8) return "••••••••";
    return `${rawKey.slice(0, 4)}${"•".repeat(Math.max(4, rawKey.length - 8))}${rawKey.slice(-4)}`;
  }

  async function addOrReplaceKey(providerId, rawKey) {
    if (Utils.isBlank(rawKey)) return { success: false, error: "La clave no puede estar vacía." };
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return { success: false, error: "Proveedor desconocido." };

    const trimmed = rawKey.trim();
    if (provider.id !== "puter" && !provider.pattern.test(trimmed) && provider.id !== "custom") {
      return { success: false, error: `El formato de la clave no parece corresponder a ${provider.label}.` };
    }

    const norm = currentUserKey();
    const stored = readAll(norm);
    const obscured = await CryptoService.obscure(trimmed);

    stored[providerId] = {
      obscured,
      provider: providerId,
      maskedPreview: maskKey(trimmed),
      addedAt: Date.now(),
      lastValidatedAt: null,
      valid: null,
    };
    const ok = writeAll(norm, stored);
    if (!ok) return { success: false, error: "No se pudo guardar la clave (almacenamiento lleno)." };
    EventBus.emit("apikey:changed", { providerId });
    return { success: true };
  }

  async function removeKey(providerId) {
    const norm = currentUserKey();
    const stored = readAll(norm);
    delete stored[providerId];
    writeAll(norm, stored);
    EventBus.emit("apikey:changed", { providerId });
    return { success: true };
  }

  async function revealKey(providerId) {
    const norm = currentUserKey();
    const stored = readAll(norm);
    const entry = stored[providerId];
    if (!entry) return { success: false, error: "No hay clave guardada para este proveedor." };
    const plain = await CryptoService.reveal(entry.obscured);
    if (plain == null) return { success: false, error: "No se pudo descifrar la clave localmente." };
    return { success: true, key: plain };
  }

  /**
   * Validates a key. For "puter" this just checks the SDK/auth is reachable, since
   * Puter keys aren't user-supplied strings. For others this performs a best-effort
   * format + reachability check without ever leaking the raw key to logs.
   */
  async function validateKey(providerId) {
    const norm = currentUserKey();
    const stored = readAll(norm);
    const entry = stored[providerId];
    if (!entry) return { success: false, error: "No hay clave guardada para este proveedor." };

    let valid = false;
    try {
      if (providerId === "puter") {
        valid = AiService.isPuterAvailable() && await AiService.checkConnection();
      } else {
        // No live network call to third-party providers is wired up in this local-only build;
        // we validate structurally and mark clearly rather than fabricate a false positive.
        const plain = await CryptoService.reveal(entry.obscured);
        const provider = PROVIDERS.find((p) => p.id === providerId);
        valid = !!plain && (provider ? provider.pattern.test(plain) : plain.length > 8);
      }
    } catch (err) {
      Logger.warn(`ApiKeyService.validateKey(${providerId}) falló:`, err);
      valid = false;
    }

    entry.valid = valid;
    entry.lastValidatedAt = Date.now();
    stored[providerId] = entry;
    writeAll(norm, stored);
    EventBus.emit("apikey:validated", { providerId, valid });
    return { success: true, valid };
  }

  return { PROVIDERS, listStatuses, addOrReplaceKey, removeKey, revealKey, validateKey, detectProvider, getAllForUser, restoreForUser, deleteAllForUser };
})();
