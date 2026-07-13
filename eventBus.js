/**
 * Nexy AI — Event Bus
 * Decouples services from UI. Prevents tight coupling and duplicate-listener bugs
 * by tracking registered handlers and offering explicit unsubscribe.
 */
const EventBus = (() => {
  const listeners = new Map();

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  function once(event, handler) {
    const wrapped = (...args) => {
      off(event, wrapped);
      handler(...args);
    };
    return on(event, wrapped);
  }

  function off(event, handler) {
    listeners.get(event)?.delete(handler);
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    // Copy to array: prevents mutation-during-iteration bugs if a handler unsubscribes itself.
    [...set].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        Logger?.error?.(`EventBus: handler para "${event}" lanzó un error.`, err);
      }
    });
  }

  function clear(event) {
    if (event) listeners.delete(event);
    else listeners.clear();
  }

  return { on, once, off, emit, clear };
})();
