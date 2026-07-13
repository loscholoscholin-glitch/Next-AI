/**
 * Nexy AI — Session Service
 * Tracks the active local session plus a per-account session history so the
 * "Sessions" settings panel can show real device/browser entries instead of fakes.
 */
const SessionService = (() => {
  const CURRENT_SESSION_KEY = "currentSession";
  const SESSIONS_INDEX_KEY = "sessionsByUser"; // { [normalizedUsername]: Session[] }

  function detectDeviceLabel() {
    const ua = navigator.userAgent;
    let browser = "Navegador desconocido";
    if (ua.includes("Edg/")) browser = "Microsoft Edge";
    else if (ua.includes("Chrome/")) browser = "Google Chrome";
    else if (ua.includes("Firefox/")) browser = "Mozilla Firefox";
    else if (ua.includes("Safari/")) browser = "Safari";
    const platform = navigator.platform || "Dispositivo desconocido";
    return `${browser} · ${platform}`;
  }

  function createSession(account) {
    const sessionId = Utils.uid("sess");
    const session = {
      id: sessionId,
      usernameNormalized: account.usernameNormalized,
      device: detectDeviceLabel(),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    Storage.set(CURRENT_SESSION_KEY, { sessionId, usernameNormalized: account.usernameNormalized });

    const index = Storage.get(SESSIONS_INDEX_KEY, {});
    const list = Array.isArray(index[account.usernameNormalized]) ? index[account.usernameNormalized] : [];
    list.push(session);
    // Keep last 10 sessions per account.
    index[account.usernameNormalized] = list.slice(-10);
    Storage.set(SESSIONS_INDEX_KEY, index);
    return session;
  }

  function getCurrentSessionRecord() {
    return Storage.get(CURRENT_SESSION_KEY, null);
  }

  function getCurrentUsernameNormalized() {
    const s = getCurrentSessionRecord();
    return s?.usernameNormalized || null;
  }

  function getCurrentUsername() {
    const norm = getCurrentUsernameNormalized();
    if (!norm) return null;
    const acc = AccountService.getByNormalized(norm);
    return acc?.username || null;
  }

  function isAuthenticated() {
    const s = getCurrentSessionRecord();
    if (!s) return false;
    const acc = AccountService.getByNormalized(s.usernameNormalized);
    return !!acc;
  }

  function updateSessionUsername(account) {
    const s = getCurrentSessionRecord();
    if (s) Storage.set(CURRENT_SESSION_KEY, { ...s, usernameNormalized: account.usernameNormalized });
  }

  function destroySession() {
    Storage.remove(CURRENT_SESSION_KEY);
  }

  function listSessions(usernameNormalized) {
    const index = Storage.get(SESSIONS_INDEX_KEY, {});
    return Array.isArray(index[usernameNormalized]) ? index[usernameNormalized] : [];
  }

  function revokeSession(usernameNormalized, sessionId) {
    const index = Storage.get(SESSIONS_INDEX_KEY, {});
    const list = index[usernameNormalized] || [];
    index[usernameNormalized] = list.filter((s) => s.id !== sessionId);
    Storage.set(SESSIONS_INDEX_KEY, index);
    const current = getCurrentSessionRecord();
    if (current?.sessionId === sessionId) destroySession();
  }

  function revokeAllOtherSessions(usernameNormalized) {
    const current = getCurrentSessionRecord();
    const index = Storage.get(SESSIONS_INDEX_KEY, {});
    const list = index[usernameNormalized] || [];
    index[usernameNormalized] = list.filter((s) => s.id === current?.sessionId);
    Storage.set(SESSIONS_INDEX_KEY, index);
  }

  return {
    createSession, getCurrentSessionRecord, getCurrentUsernameNormalized, getCurrentUsername,
    isAuthenticated, updateSessionUsername, destroySession, listSessions, revokeSession, revokeAllOtherSessions,
  };
})();
