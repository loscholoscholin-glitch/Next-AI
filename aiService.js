/**
 * Nexy AI — AI Service (Puter communication layer)
 * This is the single choke point for all AI calls. Responsibilities:
 *   - Detect Puter SDK availability / auth state without crashing the app.
 *   - Never block the main thread (all calls are async, streaming is chunked).
 *   - Recover automatically from transient network failures (retry + backoff).
 *   - Hard timeout so a hung request can never freeze the UI indefinitely.
 *   - Translate the app's "thinking level" concept into provider-supported options,
 *     with a graceful prompt-based fallback when the provider has no native support.
 *   - Surface clear, specific error messages instead of silent failures.
 */
const AiService = (() => {
  const DEFAULT_MODEL = "gpt-5.4-nano";
  const REQUEST_TIMEOUT_MS = 45000;
  const MAX_RETRIES = 2;

  // NOTE: these IDs must match Puter's live catalog exactly — an unrecognized
  // model id makes puter.ai.chat() reject or silently return no text, which is
  // indistinguishable from "the AI stopped responding" from the UI's point of view.
  // If Puter renames/retires a model again, this is the first place to check
  // (cross-reference https://docs.puter.com or developer.puter.com/ai/).
  const AVAILABLE_MODELS = [
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano (rápido)" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rápido)" },
  ];

  const THINKING_LEVELS = {
    low: {
      label: "Bajo", description: "Respuestas más rápidas, razonamiento mínimo.",
      nativeParams: { reasoning_effort: "low" },
      promptPrefix: "",
    },
    medium: {
      label: "Medio", description: "Equilibrio entre velocidad y calidad de razonamiento.",
      nativeParams: { reasoning_effort: "medium" },
      promptPrefix: "",
    },
    high: {
      label: "Alto", description: "Más razonamiento antes de responder.",
      nativeParams: { reasoning_effort: "high" },
      promptPrefix: "Piensa cuidadosamente paso a paso antes de dar tu respuesta final.\n\n",
    },
    ultra: {
      label: "Ultra", description: "Máxima calidad de razonamiento, puede ser más lento.",
      nativeParams: { reasoning_effort: "high", thinking: { type: "enabled", budget_tokens: 8000 } },
      promptPrefix: "Analiza el problema en profundidad, considera múltiples enfoques, verifica tu razonamiento paso a paso y luego entrega la respuesta final más precisa posible.\n\n",
    },
  };

  let connectionState = "connecting"; // connecting | online | offline
  let lastKnownError = null;

  function isPuterAvailable() {
    return typeof window.puter !== "undefined" && !!window.puter?.ai?.chat;
  }

  async function checkConnection() {
    if (!isPuterAvailable()) {
      setConnectionState("offline", "El SDK de Puter no se cargó. Verifica tu conexión a internet.");
      return false;
    }
    try {
      // Lightweight, non-billable presence check: auth status only.
      const signedIn = typeof puter.auth?.isSignedIn === "function" ? await puter.auth.isSignedIn() : true;
      setConnectionState("online");
      return true;
    } catch (err) {
      Logger.warn("AiService.checkConnection: no se pudo verificar el estado de Puter.", err);
      setConnectionState("offline", "No se pudo verificar la conexión con Puter.");
      return false;
    }
  }

  function setConnectionState(state, error = null) {
    connectionState = state;
    lastKnownError = error;
    EventBus.emit("ai:connection-changed", { state, error });
  }

  function getConnectionState() {
    return { state: connectionState, error: lastKnownError };
  }

  function withTimeout(promise, ms, onTimeout) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        onTimeout?.();
        reject(new Error("TIMEOUT"));
      }, ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
  }

  function resolveModel(model) {
    if (AVAILABLE_MODELS.some((m) => m.id === model)) return model;
    Logger.warn(`AiService: modelo desconocido "${model}", usando "${DEFAULT_MODEL}" en su lugar.`);
    return DEFAULT_MODEL;
  }

  function buildRequestOptions(model, thinkingLevel) {
    const level = THINKING_LEVELS[thinkingLevel] || THINKING_LEVELS.medium;
    return {
      model: resolveModel(model),
      stream: true,
      ...level.nativeParams,
    };
  }

  function toPuterMessages(history) {
    return history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  }

  /**
   * Streams a response. onChunk(text) is called incrementally; onDone(fullText) at the end.
   * Returns an object with .abort() to cancel mid-stream (e.g. user navigates away).
   */
  function streamChat({ history, model = DEFAULT_MODEL, thinkingLevel = "medium", onChunk, onDone, onError }) {
    let aborted = false;
    const controller = { abort: () => { aborted = true; } };

    (async () => {
      if (!isPuterAvailable()) {
        onError?.(new Error("El SDK de Puter no está disponible. Revisa tu conexión a internet y recarga la página."));
        setConnectionState("offline");
        return;
      }

      const level = THINKING_LEVELS[thinkingLevel] || THINKING_LEVELS.medium;
      const messages = toPuterMessages(history);
      if (level.promptPrefix && messages.length > 0) {
        const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
        if (lastUserIdx !== -1) {
          const realIdx = messages.length - 1 - lastUserIdx;
          messages[realIdx] = { ...messages[realIdx], content: level.promptPrefix + messages[realIdx].content };
        }
      }

      const options = buildRequestOptions(model, thinkingLevel);
      let fullText = "";
      let attempt = 0;

      try {
        await Utils.retryAsync(async (attemptIdx) => {
          if (aborted) return;
          attempt = attemptIdx;
          fullText = "";

          const callPromise = (async () => {
            const response = await puter.ai.chat(messages, options);

            // Puter's streaming response is an async iterable of chunks.
            if (response && typeof response[Symbol.asyncIterator] === "function") {
              for await (const part of response) {
                if (aborted) return;
                const chunkText = extractChunkText(part);
                if (chunkText) {
                  fullText += chunkText;
                  onChunk?.(chunkText, fullText);
                }
              }
            } else {
              // Non-streaming fallback (older SDK behavior or provider without streaming support).
              const text = extractChunkText(response) || (typeof response === "string" ? response : "");
              fullText = text;
              onChunk?.(text, fullText);
            }
          })();

          await withTimeout(callPromise, REQUEST_TIMEOUT_MS, () => {
            Logger.warn(`AiService: la solicitud excedió ${REQUEST_TIMEOUT_MS}ms (intento ${attemptIdx + 1}).`);
          });
        }, {
          retries: MAX_RETRIES,
          baseDelay: 800,
          onRetry: (err, attemptIdx) => {
            Logger.warn(`AiService: reintentando tras fallo (intento ${attemptIdx + 1}/${MAX_RETRIES}).`, err?.message);
            EventBus.emit("ai:retrying", { attempt: attemptIdx + 1, max: MAX_RETRIES });
          },
        });

        if (aborted) return;
        setConnectionState("online");
        onDone?.(fullText);
      } catch (err) {
        if (aborted) return;
        Logger.error("AiService.streamChat falló tras reintentos:", err);
        const friendly = classifyError(err);
        setConnectionState(friendly.offline ? "offline" : "online", friendly.message);
        onError?.(new Error(friendly.message));
      }
    })();

    return controller;
  }

  function extractChunkText(part) {
    if (!part) return "";
    if (typeof part === "string") return part;

    // Streaming chunk shapes: { type: 'text', text: '...' } | { type: 'tool_use', ... } | { type: 'compaction', ... } | { type: 'error', message }
    if (part.type === "tool_use" || part.type === "compaction") return "";
    if (part.type === "error") {
      throw new Error(part.message || "El proveedor devolvió un error en el stream.");
    }
    if (typeof part.text === "string") return part.text;

    // Non-streaming shape: { message: { content: "..." } } (older/simple providers)
    if (typeof part.message?.content === "string") return part.message.content;

    // Non-streaming shape: { message: { content: [ { type: 'text', text: '...' }, ... ] } }
    // This is what Claude models return via puter.ai.chat() without stream:true —
    // content is an array of blocks, each with its own `text` field.
    if (Array.isArray(part.message?.content)) {
      return part.message.content.map((c) => c?.text || "").join("");
    }

    // Fallback: top-level content array (some provider variants).
    if (Array.isArray(part.content)) {
      return part.content.map((c) => c?.text || "").join("");
    }

    return "";
  }

  function classifyError(err) {
    const msg = (err?.message || "").toLowerCase();
    if (msg === "timeout" || msg.includes("timeout")) {
      return { message: "La solicitud tardó demasiado en responder. Verifica tu conexión e inténtalo de nuevo.", offline: false };
    }
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
      return { message: "No se pudo conectar con Puter. Verifica tu conexión a internet.", offline: true };
    }
    if (msg.includes("auth") || msg.includes("unauthorized") || msg.includes("401")) {
      return { message: "Tu sesión de Puter expiró o no está autenticada. Vuelve a iniciar sesión con Puter.", offline: false };
    }
    if (msg.includes("rate") || msg.includes("429")) {
      return { message: "Has alcanzado el límite de solicitudes. Espera un momento antes de volver a intentar.", offline: false };
    }
    if (msg.includes("model")) {
      return { message: "El modelo seleccionado no está disponible en este momento. Prueba con otro modelo.", offline: false };
    }
    return { message: "Ocurrió un error al comunicarse con la IA. Se reintentó automáticamente sin éxito.", offline: false };
  }

  /** Attempts to read usage/quota info if the provider exposes it. Never fabricates values. */
  async function getUsageInfo() {
    if (!isPuterAvailable()) {
      return { available: false, reason: "El proveedor de IA no está disponible en este momento." };
    }
    try {
      if (typeof puter.ai.usage === "function") {
        const usage = await puter.ai.usage();
        if (usage && typeof usage === "object") {
          return { available: true, data: usage };
        }
      }
      if (typeof puter.kv?.get === "function") {
        // Some Puter deployments do not expose usage at all — this is expected, not an error.
      }
      return { available: false, reason: "Este proveedor no expone información de cuota o uso restante." };
    } catch (err) {
      Logger.warn("AiService.getUsageInfo: no se pudo obtener el uso.", err);
      return { available: false, reason: "No se pudo obtener la información de uso en este momento." };
    }
  }

  return {
    AVAILABLE_MODELS, THINKING_LEVELS, DEFAULT_MODEL,
    isPuterAvailable, checkConnection, getConnectionState, streamChat, getUsageInfo,
  };
})();
