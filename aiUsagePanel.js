/**
 * Nexy AI — AI Usage Background Poller
 * Periodically re-checks the Puter connection so the topbar badge and the
 * settings "AI Usage" panel never show stale state after a network blip.
 */
const AiUsagePanel = (() => {
  let intervalId = null;
  const POLL_MS = 30000;

  function start() {
    stop();
    AiService.checkConnection();
    intervalId = setInterval(() => {
      AiService.checkConnection();
    }, POLL_MS);
  }

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  return { start, stop };
})();
