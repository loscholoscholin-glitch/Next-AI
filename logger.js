/**
 * Nexy AI — Logger
 * Centralized, leveled logging. Every other module logs through here instead
 * of calling console.* directly, so log format is consistent and so a single
 * place can silence noisy logs in production without touching call sites.
 */
const Logger = (() => {
  const PREFIX = "[Nexy AI]";
  // Keep a small ring buffer of recent errors in memory — useful for a future
  // "copy diagnostic info" button without needing a backend or file access.
  const MAX_HISTORY = 100;
  const history = [];

  function record(level, args) {
    history.push({ level, time: Date.now(), message: args.map((a) => (a instanceof Error ? a.message : a)).join(" ") });
    if (history.length > MAX_HISTORY) history.shift();
  }

  function info(...args) {
    record("info", args);
    console.info(PREFIX, ...args);
  }

  function warn(...args) {
    record("warn", args);
    console.warn(PREFIX, ...args);
  }

  function error(...args) {
    record("error", args);
    console.error(PREFIX, ...args);
  }

  function debug(...args) {
    record("debug", args);
    console.debug(PREFIX, ...args);
  }

  function getHistory() {
    return [...history];
  }

  return { info, warn, error, debug, getHistory };
})();
