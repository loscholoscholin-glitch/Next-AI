/**
 * Nexy AI — Storage Service
 * Thin, defensive wrapper around localStorage. This is the ONLY module in the
 * app allowed to touch localStorage directly — every other service (accounts,
 * sessions, chats, API keys) goes through Storage.get/set/remove.
 *
 * Guarantees this module provides (per the account-system requirements):
 *   - A corrupted value (bad JSON, tampered by hand, half-written) can never
 *     crash the app or propagate garbage into a service — it's caught, logged,
 *     quarantined, and the caller gets the default value instead.
 *   - A full/blocked storage quota (QuotaExceededError, Safari private mode,
 *     browser storage disabled) never throws — set() returns false and callers
 *     already know to surface "no se pudo guardar" to the user.
 *   - All keys are namespaced so this app can never collide with, or be
 *     confused by, unrelated localStorage entries from other sites/tools.
 *   - If localStorage itself is unavailable, the app keeps working for the
 *     current tab session via an in-memory fallback instead of crashing on
 *     first read.
 */
const Storage = (() => {
  const PREFIX = "nexyai:";
  // Bump this whenever a stored shape changes in a way that would need a
  // migration. Written into every account/backup export so `importBackup`
  // and any future migration code have something concrete to check against.
  const SCHEMA_VERSION = 1;

  let backend = null;          // "localStorage" | "memory"
  const memoryStore = new Map(); // used only if localStorage is unavailable

  function namespacedKey(key) {
    return `${PREFIX}${key}`;
  }

  function detectBackend() {
    if (backend) return backend;
    try {
      const probeKey = `${PREFIX}__probe__`;
      window.localStorage.setItem(probeKey, "1");
      window.localStorage.removeItem(probeKey);
      backend = "localStorage";
    } catch (err) {
      // Safari private mode, storage disabled by policy, embedded webview, etc.
      Logger?.warn?.(
        "Storage: localStorage no está disponible (modo privado, política del navegador, o cuota agotada). " +
        "Los datos solo persistirán durante esta pestaña, en memoria.",
        err
      );
      backend = "memory";
    }
    return backend;
  }

  function rawGet(nsKey) {
    if (detectBackend() === "memory") {
      return memoryStore.has(nsKey) ? memoryStore.get(nsKey) : null;
    }
    return window.localStorage.getItem(nsKey);
  }

  function rawSet(nsKey, rawValue) {
    if (detectBackend() === "memory") {
      memoryStore.set(nsKey, rawValue);
      return true;
    }
    window.localStorage.setItem(nsKey, rawValue);
    return true;
  }

  function rawRemove(nsKey) {
    if (detectBackend() === "memory") {
      memoryStore.delete(nsKey);
      return;
    }
    window.localStorage.removeItem(nsKey);
  }

  /**
   * Reads and JSON-parses a value. Never throws.
   * If the stored value is corrupted (invalid JSON — e.g. hand-edited,
   * truncated by a crash mid-write, or from an incompatible older version),
   * it is quarantined (kept under a `__corrupted__:` key for forensics/manual
   * recovery instead of being silently destroyed) and `defaultValue` is
   * returned so the calling service can keep functioning normally.
   */
  function get(key, defaultValue = null) {
    const nsKey = namespacedKey(key);
    let raw;
    try {
      raw = rawGet(nsKey);
    } catch (err) {
      Logger?.error?.(`Storage.get("${key}") falló al leer del almacenamiento.`, err);
      return defaultValue;
    }

    if (raw === null || raw === undefined) return defaultValue;

    try {
      return JSON.parse(raw);
    } catch (err) {
      Logger?.error?.(
        `Storage.get("${key}") encontró datos corruptos (JSON inválido). ` +
        `Se aísla el valor dañado y se devuelve el valor por defecto para no romper la app.`,
        err
      );
      quarantine(nsKey, raw);
      return defaultValue;
    }
  }

  function quarantine(nsKey, raw) {
    try {
      const quarantineKey = `${PREFIX}__corrupted__:${Date.now()}:${nsKey}`;
      rawSet(quarantineKey, raw);
      rawRemove(nsKey);
    } catch (err) {
      // If even quarantining fails, just drop the corrupted key so it can't
      // keep breaking reads on every subsequent load.
      Logger?.error?.("Storage: no se pudo poner en cuarentena una clave corrupta; se eliminará.", err);
      try { rawRemove(nsKey); } catch { /* nothing more we can do */ }
    }
  }

  /**
   * Serializes and writes a value. Never throws.
   * Returns true on success, false on any failure (quota exceeded, storage
   * disabled, value not serializable, etc.) — every caller in this codebase
   * already checks this return value and surfaces a friendly error instead
   * of assuming the write succeeded.
   */
  function set(key, value) {
    const nsKey = namespacedKey(key);
    let raw;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      Logger?.error?.(`Storage.set("${key}") falló: el valor no se puede serializar a JSON.`, err);
      return false;
    }

    try {
      rawSet(nsKey, raw);
      return true;
    } catch (err) {
      const isQuotaError = err && (
        err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        err.code === 22 || err.code === 1014
      );
      if (isQuotaError) {
        Logger?.warn?.(`Storage.set("${key}") falló: almacenamiento lleno.`, err);
      } else {
        Logger?.error?.(`Storage.set("${key}") falló de forma inesperada.`, err);
      }
      return false;
    }
  }

  function remove(key) {
    try {
      rawRemove(namespacedKey(key));
      return true;
    } catch (err) {
      Logger?.error?.(`Storage.remove("${key}") falló.`, err);
      return false;
    }
  }

  function has(key) {
    try {
      return rawGet(namespacedKey(key)) !== null;
    } catch {
      return false;
    }
  }

  /** Lists app keys (without the namespace prefix) — used by the "Almacenamiento" settings panel. */
  function listKeys() {
    try {
      if (detectBackend() === "memory") {
        return [...memoryStore.keys()]
          .filter((k) => k.startsWith(PREFIX) && !k.includes("__corrupted__") && !k.includes("__probe__"))
          .map((k) => k.slice(PREFIX.length));
      }
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX) && !k.includes("__corrupted__") && !k.includes("__probe__")) {
          keys.push(k.slice(PREFIX.length));
        }
      }
      return keys;
    } catch (err) {
      Logger?.error?.("Storage.listKeys falló.", err);
      return [];
    }
  }

  /** Rough byte-size estimate of everything this app has stored — used by the "Almacenamiento" settings panel. */
  function estimateUsageBytes() {
    try {
      if (detectBackend() === "memory") {
        let bytes = 0;
        for (const [k, v] of memoryStore.entries()) {
          if (k.startsWith(PREFIX)) bytes += (k.length + (v?.length || 0)) * 2;
        }
        return bytes;
      }
      let bytes = 0;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) {
          const v = window.localStorage.getItem(k) || "";
          bytes += (k.length + v.length) * 2; // UTF-16 → 2 bytes/char, matches browser quota accounting
        }
      }
      return bytes;
    } catch (err) {
      Logger?.error?.("Storage.estimateUsageBytes falló.", err);
      return 0;
    }
  }

  /** Wipes every key belonging to this app (namespaced), leaving unrelated localStorage entries untouched. */
  function clearAll() {
    listKeys().forEach((k) => remove(k));
  }

  return {
    SCHEMA_VERSION,
    get, set, remove, has,
    listKeys, estimateUsageBytes, clearAll,
  };
})();
