/**
 * Nexy AI — Core Utilities
 * Pure helper functions shared across the app. No side effects, no state.
 */
const Utils = (() => {

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeUsername(username) {
    return (username || "").trim().toLowerCase();
  }

  function isBlank(str) {
    return !str || str.trim().length === 0;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  /** Very small, safe markdown-ish renderer: code blocks, inline code, bold, italics, line breaks. */
  function renderMessageContent(raw) {
    let text = escapeHtml(raw ?? "");
    // fenced code blocks
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code data-lang="${escapeHtml(lang)}">${code}</code></pre>`;
    });
    // inline code
    text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // bold / italics
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    return text;
  }

  function debounce(fn, wait = 200) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function throttle(fn, wait = 200) {
    let last = 0, pending = null;
    return (...args) => {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn(...args);
      } else {
        clearTimeout(pending);
        pending = setTimeout(() => { last = Date.now(); fn(...args); }, wait - (now - last));
      }
    };
  }

  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "justo ahora";
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr} h`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `hace ${day} d`;
    return formatDate(timestamp);
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString("es-ES", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function daysBetween(a, b) {
    return Math.floor((b - a) / (1000 * 60 * 60 * 24));
  }

  function downloadBlob(content, filename, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Retry an async function with exponential backoff. */
  async function retryAsync(fn, { retries = 3, baseDelay = 500, onRetry = null } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastErr = err;
        if (attempt === retries) break;
        if (onRetry) onRetry(err, attempt);
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 150;
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  return {
    uid, normalizeUsername, isBlank, escapeHtml, renderMessageContent,
    debounce, throttle, formatRelativeTime, formatDate, formatDateTime, daysBetween,
    downloadBlob, readFileAsText, readFileAsDataURL, sleep, retryAsync, clamp
  };
})();
