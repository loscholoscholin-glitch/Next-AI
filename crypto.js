/**
 * Nexy AI — Crypto Service
 * Passwords are NEVER stored in plain text. We derive a salted PBKDF2-SHA256 hash
 * using the native Web Crypto API (no external dependency, no plaintext round-trip).
 *
 * NOTE: This is a client-side, local-account app (no server). PBKDF2 in the browser
 * raises the bar significantly above plain text or naive hashing, which is the
 * realistic ceiling for a fully local, backend-less account system.
 */
const CryptoService = (() => {
  const ITERATIONS = 150000;
  const HASH_ALG = "SHA-256";
  const KEY_LENGTH = 256;

  function toBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  function fromBase64(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  function randomSalt(bytes = 16) {
    return crypto.getRandomValues(new Uint8Array(bytes));
  }

  async function deriveKey(password, salt, iterations = ITERATIONS) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: HASH_ALG },
      keyMaterial,
      KEY_LENGTH
    );
    return derivedBits;
  }

  /** Returns a self-describing hash string: pbkdf2$iterations$saltB64$hashB64 */
  async function hashPassword(password) {
    const salt = randomSalt();
    const derived = await deriveKey(password, salt);
    return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
  }

  async function verifyPassword(password, storedHash) {
    try {
      const [scheme, iterStr, saltB64, hashB64] = (storedHash || "").split("$");
      if (scheme !== "pbkdf2") return false;
      const iterations = parseInt(iterStr, 10);
      const salt = fromBase64(saltB64);
      const derived = await deriveKey(password, salt, iterations);
      const derivedB64 = toBase64(derived);
      return timingSafeEqual(derivedB64, hashB64);
    } catch (err) {
      Logger.error("CryptoService.verifyPassword falló:", err);
      return false;
    }
  }

  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
  }

  /** Lightweight obfuscation for locally-stored API keys (NOT a substitute for a real backend vault). */
  async function obscure(plainText, passphrase = "nexyai-local-vault") {
    const enc = new TextEncoder();
    const salt = randomSalt();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plainText));
    return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(cipher)}`;
  }

  async function reveal(obscured, passphrase = "nexyai-local-vault") {
    try {
      const [saltB64, ivB64, cipherB64] = obscured.split(".");
      const salt = fromBase64(saltB64);
      const iv = fromBase64(ivB64);
      const cipher = fromBase64(cipherB64);
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
      const aesKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
      );
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, cipher);
      return new TextDecoder().decode(plainBuf);
    } catch (err) {
      Logger.error("CryptoService.reveal falló:", err);
      return null;
    }
  }

  return { hashPassword, verifyPassword, obscure, reveal };
})();
