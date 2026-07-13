/**
 * Nexy AI — Chat UI
 * Renders the chat list, active conversation, and handles the composer/streaming loop.
 * Keeps a reference to the in-flight AI request so navigating chats never leaves
 * zombie listeners or race conditions writing into the wrong conversation.
 */
const ChatUI = (() => {
  let activeChatId = null;
  let activeFilter = "all";
  let searchQuery = "";
  let inFlightRequest = null; // { chatId, controller }
  let openMenuChatId = null;

  function init() {
    document.getElementById("new-chat-btn").addEventListener("click", () => createAndOpenChat());
    document.getElementById("chat-search").addEventListener("input", Utils.debounce((e) => {
      searchQuery = e.target.value;
      renderChatList();
    }, 200));

    document.querySelectorAll(".sidebar-filters .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".sidebar-filters .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        activeFilter = chip.dataset.filter;
        renderChatList();
      });
    });

    document.getElementById("sidebar-collapse").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("collapsed");
    });
    document.getElementById("mobile-menu-btn").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("mobile-open");
    });

    const composer = document.getElementById("composer");
    const input = document.getElementById("composer-input");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 200) + "px";
      document.getElementById("composer-send").disabled = Utils.isBlank(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    composer.addEventListener("submit", handleSend);

    document.getElementById("model-select").innerHTML = AiService.AVAILABLE_MODELS
      .map((m) => `<option value="${m.id}">${Utils.escapeHtml(m.label)}</option>`).join("");

    document.getElementById("thinking-select").addEventListener("change", (e) => {
      AccountService.updateSettings({ thinkingLevel: e.target.value });
    });

    document.addEventListener("click", (e) => {
      if (openMenuChatId && !e.target.closest(".chat-item-menu") && !e.target.closest(".chat-item-menu-btn")) {
        closeChatMenu();
      }
    });

    EventBus.on("ai:connection-changed", updateConnectionBadge);
    EventBus.on("ai:retrying", ({ attempt, max }) => {
      Toast.warning(`Reintentando conexión con la IA (${attempt}/${max})…`, 2500);
    });

    updateConnectionBadge(AiService.getConnectionState());
  }

  function updateConnectionBadge({ state }) {
    const badge = document.getElementById("connection-badge");
    badge.dataset.state = state;
    const labels = { online: "Conectado", offline: "Desconectado", connecting: "Conectando…" };
    badge.querySelector(".conn-label").textContent = labels[state] || "Desconocido";
  }

  function loadForCurrentUser() {
    const account = AccountService.getCurrent();
    document.getElementById("thinking-select").value = account?.settings?.thinkingLevel || "medium";
    document.body.dataset.perfMode = account?.settings?.performanceMode ? "on" : "off";
    document.documentElement.dataset.perfMode = account?.settings?.performanceMode ? "on" : "off";
    renderChatList();
    const chats = ChatService.listChats({ filter: "all" });
    if (chats.length > 0) openChat(chats[0].id);
    else showEmptyState();
  }

  function renderChatList() {
    const listEl = document.getElementById("chat-list");
    const chats = ChatService.listChats({ filter: activeFilter, query: searchQuery });

    if (chats.length === 0) {
      listEl.innerHTML = `<div class="chat-group-label">Sin chats para mostrar</div>`;
      return;
    }

    listEl.innerHTML = chats.map((chat) => `
      <div class="chat-item ${chat.id === activeChatId ? "active" : ""}" data-chat-id="${chat.id}">
        ${chat.pinned ? '<span class="pin-icon">📌</span>' : ""}
        <span class="chat-item-title">${Utils.escapeHtml(chat.title)}${chat.favorite ? " ⭐" : ""}</span>
        <button class="chat-item-menu-btn" data-menu-for="${chat.id}" aria-label="Opciones del chat">⋯</button>
      </div>
    `).join("");

    listEl.querySelectorAll(".chat-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".chat-item-menu-btn")) return;
        openChat(el.dataset.chatId);
        document.getElementById("sidebar").classList.remove("mobile-open");
      });
    });
    listEl.querySelectorAll(".chat-item-menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleChatMenu(btn.dataset.menuFor, btn);
      });
    });
  }

  function toggleChatMenu(chatId, anchorBtn) {
    if (openMenuChatId === chatId) { closeChatMenu(); return; }
    closeChatMenu();
    openMenuChatId = chatId;
    const chat = ChatService.getChat(chatId);
    const menu = document.createElement("div");
    menu.className = "chat-item-menu";
    menu.innerHTML = `
      <button data-action="rename">✏️ Renombrar</button>
      <button data-action="pin">📌 ${chat.pinned ? "Desfijar" : "Fijar"}</button>
      <button data-action="favorite">⭐ ${chat.favorite ? "Quitar de favoritos" : "Favorito"}</button>
      <button data-action="duplicate">📋 Duplicar</button>
      <button data-action="archive">🗄 ${chat.archived ? "Restaurar" : "Archivar"}</button>
      <button data-action="export-txt">⬇ Exportar TXT</button>
      <button data-action="export-md">⬇ Exportar Markdown</button>
      <button data-action="export-json">⬇ Exportar JSON</button>
      <button data-action="delete" class="danger">🗑 Eliminar</button>
    `;
    anchorBtn.closest(".chat-item").appendChild(menu);
    menu.addEventListener("click", (e) => handleMenuAction(e, chatId));
  }

  function closeChatMenu() {
    document.querySelectorAll(".chat-item-menu").forEach((m) => m.remove());
    openMenuChatId = null;
  }

  async function handleMenuAction(e, chatId) {
    const action = e.target.dataset.action;
    if (!action) return;
    closeChatMenu();

    switch (action) {
      case "rename": {
        const chat = ChatService.getChat(chatId);
        const newTitle = prompt("Nuevo nombre del chat:", chat.title);
        if (newTitle != null) {
          const res = ChatService.renameChat(chatId, newTitle);
          if (res.success) { renderChatList(); if (chatId === activeChatId) updateChatTitle(res.chat.title); }
          else Toast.error(res.error);
        }
        break;
      }
      case "pin": ChatService.togglePin(chatId); renderChatList(); break;
      case "favorite": ChatService.toggleFavorite(chatId); renderChatList(); break;
      case "duplicate": {
        const res = ChatService.duplicateChat(chatId);
        if (res.success) { renderChatList(); Toast.success("Chat duplicado."); }
        break;
      }
      case "archive": ChatService.toggleArchive(chatId); renderChatList(); Toast.info("Chat actualizado."); break;
      case "export-txt": case "export-md": case "export-json": {
        const format = action === "export-txt" ? "txt" : action === "export-md" ? "markdown" : "json";
        const file = ChatService.exportChat(chatId, format);
        if (file) { Utils.downloadBlob(file.content, file.filename, file.mime); Toast.success("Chat exportado."); }
        break;
      }
      case "delete": {
        const confirmed = await ModalUI.open({
          title: "Eliminar chat", message: "Esta acción no se puede deshacer. ¿Deseas eliminar este chat?",
          confirmLabel: "Eliminar", danger: true,
        });
        if (confirmed) {
          ChatService.deleteChat(chatId);
          if (chatId === activeChatId) { activeChatId = null; showEmptyState(); }
          renderChatList();
          Toast.success("Chat eliminado.");
        }
        break;
      }
    }
  }

  function createAndOpenChat() {
    const chat = ChatService.createChat();
    renderChatList();
    openChat(chat.id);
  }

  function openChat(chatId) {
    activeChatId = chatId;
    const chat = ChatService.getChat(chatId);
    if (!chat) { showEmptyState(); return; }
    updateChatTitle(chat.title);
    renderMessages(chat);
    renderChatList();
  }

  function updateChatTitle(title) {
    document.getElementById("chat-title").textContent = title;
  }

  function showEmptyState() {
    updateChatTitle("Nueva conversación");
    document.getElementById("messages").innerHTML = `
      <div class="empty-state" id="chat-empty-state">
        <img src="assets/img/logo-star.png" class="empty-logo" alt="Nexy AI">
        <h2>¿En qué puedo ayudarte hoy?</h2>
        <p>Escribe un mensaje para comenzar una conversación con Nexy AI.</p>
      </div>`;
  }

  function renderMessages(chat) {
    const container = document.getElementById("messages");
    if (chat.messages.length === 0) { showEmptyState(); return; }
    container.innerHTML = `<div class="messages-inner" id="messages-inner"></div>`;
    const inner = document.getElementById("messages-inner");
    chat.messages.forEach((m) => inner.appendChild(renderMessageEl(m)));
    scrollToBottom();
  }

  function renderMessageEl(message) {
    const el = document.createElement("div");
    el.className = `msg ${message.role}${message.error ? " error" : ""}`;
    el.dataset.msgId = message.id;
    el.innerHTML = `
      <div class="msg-avatar">${message.role === "user" ? initials() : `<img src="assets/img/logo-star.png" alt="Nexy AI">`}</div>
      <div class="msg-body">
        <div class="msg-role">${message.role === "user" ? "Tú" : "Nexy AI"}</div>
        <div class="msg-content">${Utils.renderMessageContent(message.content)}</div>
        <div class="msg-actions">
          <button data-action="copy">Copiar</button>
        </div>
      </div>
    `;
    el.querySelector('[data-action="copy"]').addEventListener("click", () => {
      navigator.clipboard?.writeText(message.content).then(() => Toast.success("Copiado al portapapeles."));
    });
    return el;
  }

  function initials() {
    const name = AccountService.getCurrent()?.username || "U";
    return Utils.escapeHtml(name.slice(0, 2).toUpperCase());
  }

  function scrollToBottom() {
    const container = document.getElementById("messages");
    container.scrollTop = container.scrollHeight;
  }

  async function handleSend(e) {
    e.preventDefault();
    const input = document.getElementById("composer-input");
    const text = input.value.trim();
    if (Utils.isBlank(text)) return;

    if (!activeChatId) {
      const chat = ChatService.createChat();
      activeChatId = chat.id;
      renderChatList();
    }

    input.value = "";
    input.style.height = "auto";
    document.getElementById("composer-send").disabled = true;

    ChatService.addMessage(activeChatId, { role: "user", content: text });
    AccountService.incrementStat("messagesSent");
    renderMessages(ChatService.getChat(activeChatId));
    updateChatTitle(ChatService.getChat(activeChatId).title);
    renderChatList();

    await requestAiResponse(activeChatId);
  }

  async function requestAiResponse(chatId) {
    // Cancel any previous in-flight request so responses never cross-write between chats.
    if (inFlightRequest) {
      inFlightRequest.controller.abort();
      inFlightRequest = null;
    }

    const chat = ChatService.getChat(chatId);
    const history = chat.messages.map((m) => ({ role: m.role, content: m.content }));
    const model = document.getElementById("model-select").value || AiService.DEFAULT_MODEL;
    const thinkingLevel = AccountService.getCurrent()?.settings?.thinkingLevel || "medium";

    // Insert a placeholder assistant message that will be filled in as chunks arrive.
    const placeholderResult = ChatService.addMessage(chatId, { role: "assistant", content: "" });
    if (chatId === activeChatId) {
      const inner = document.getElementById("messages-inner") || (() => { renderMessages(ChatService.getChat(chatId)); return document.getElementById("messages-inner"); })();
      const placeholderEl = renderMessageEl(placeholderResult.chat.messages[placeholderResult.chat.messages.length - 1]);
      placeholderEl.querySelector(".msg-content").innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
      inner.appendChild(placeholderEl);
      scrollToBottom();
    }

    let accumulated = "";
    let firstChunkReceived = false;

    const controller = AiService.streamChat({
      history, // full history up to and including the new user message (was accidentally `history.slice(0, -0)`, which JS evaluates as slice(0,0) → always an empty array, since -0 === 0)
      model,
      thinkingLevel,
      onChunk: (_chunk, fullText) => {
        accumulated = fullText;
        if (chatId !== activeChatId) return;
        const msgEl = document.querySelector(`.msg[data-msg-id="${placeholderResult.chat.messages.at(-1).id}"] .msg-content`);
        if (msgEl) {
          if (!firstChunkReceived) { firstChunkReceived = true; }
          msgEl.innerHTML = Utils.renderMessageContent(fullText) + '<span class="streaming-cursor"></span>';
          scrollToBottom();
        }
      },
      onDone: (fullText) => {
        inFlightRequest = null;
        ChatService.updateLastMessage(chatId, fullText || "(Sin contenido en la respuesta.)");
        if (chatId === activeChatId) renderMessages(ChatService.getChat(chatId));
      },
      onError: (err) => {
        inFlightRequest = null;
        const message = err?.message || "Ocurrió un error al comunicarse con la IA.";
        ChatService.mutateChat(chatId, (c) => {
          const last = c.messages[c.messages.length - 1];
          if (last && last.role === "assistant") { last.content = message; last.error = true; }
        });
        if (chatId === activeChatId) renderMessages(ChatService.getChat(chatId));
        Toast.error(message);
      },
    });

    inFlightRequest = { chatId, controller };
  }

  function getActiveChatId() { return activeChatId; }

  return { init, loadForCurrentUser, renderChatList, createAndOpenChat, getActiveChatId };
})();
