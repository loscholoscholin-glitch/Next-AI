/**
 * Nexy AI — Chat Service
 * Manages chats per account: create/rename/delete/duplicate/archive/pin/favorite,
 * search, sort, grouping, and export. Auto-persists after every mutation.
 */
const ChatService = (() => {
  function chatsKey(usernameNormalized) {
    return `chats:${usernameNormalized}`;
  }

  function currentUserKey() {
    const norm = SessionService.getCurrentUsernameNormalized();
    if (!norm) throw new Error("No hay sesión activa.");
    return norm;
  }

  function readAll(usernameNormalized) {
    const data = Storage.get(chatsKey(usernameNormalized), []);
    return Array.isArray(data) ? data : [];
  }

  function writeAll(usernameNormalized, chats) {
    return Storage.set(chatsKey(usernameNormalized), chats);
  }

  function getAllChatsForUser(usernameNormalized) {
    return readAll(usernameNormalized);
  }

  function restoreChatsForUser(usernameNormalized, chats) {
    if (Array.isArray(chats)) writeAll(usernameNormalized, chats);
  }

  function deleteAllChatsForUser(usernameNormalized) {
    Storage.remove(chatsKey(usernameNormalized));
  }

  function listChats({ filter = "all", query = "" } = {}) {
    const norm = currentUserKey();
    let chats = readAll(norm);

    if (filter === "pinned") chats = chats.filter((c) => c.pinned);
    else if (filter === "favorite") chats = chats.filter((c) => c.favorite);
    else if (filter === "archived") chats = chats.filter((c) => c.archived);
    else chats = chats.filter((c) => !c.archived);

    if (!Utils.isBlank(query)) {
      const q = query.trim().toLowerCase();
      chats = chats.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
      );
    }

    chats.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    return chats;
  }

  function getChat(chatId) {
    const norm = currentUserKey();
    return readAll(norm).find((c) => c.id === chatId) || null;
  }

  function createChat(title = "Nueva conversación") {
    const norm = currentUserKey();
    const chats = readAll(norm);
    const chat = {
      id: Utils.uid("chat"),
      title,
      messages: [],
      pinned: false,
      favorite: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chats.unshift(chat);
    writeAll(norm, chats);
    AccountService.incrementStat("chatsCreated");
    EventBus.emit("chat:created", chat);
    return chat;
  }

  function mutateChat(chatId, mutatorFn) {
    const norm = currentUserKey();
    const chats = readAll(norm);
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) return { success: false, error: "Chat no encontrado." };
    mutatorFn(chats[idx]);
    chats[idx].updatedAt = Date.now();
    const ok = writeAll(norm, chats);
    if (!ok) return { success: false, error: "No se pudo guardar el chat." };
    EventBus.emit("chat:updated", chats[idx]);
    return { success: true, chat: chats[idx] };
  }

  function addMessage(chatId, message) {
    return mutateChat(chatId, (chat) => {
      chat.messages.push({
        id: Utils.uid("msg"),
        role: message.role,
        content: message.content,
        createdAt: Date.now(),
        error: !!message.error,
      });
      if (chat.title === "Nueva conversación" && message.role === "user") {
        chat.title = message.content.slice(0, 48) || "Nueva conversación";
      }
    });
  }

  function updateLastMessage(chatId, content) {
    return mutateChat(chatId, (chat) => {
      const last = chat.messages[chat.messages.length - 1];
      if (last) last.content = content;
    });
  }

  function renameChat(chatId, newTitle) {
    if (Utils.isBlank(newTitle)) return { success: false, error: "El título no puede estar vacío." };
    return mutateChat(chatId, (chat) => { chat.title = newTitle.trim().slice(0, 80); });
  }

  function deleteChat(chatId) {
    const norm = currentUserKey();
    const chats = readAll(norm).filter((c) => c.id !== chatId);
    writeAll(norm, chats);
    EventBus.emit("chat:deleted", { chatId });
    return { success: true };
  }

  function duplicateChat(chatId) {
    const norm = currentUserKey();
    const chats = readAll(norm);
    const original = chats.find((c) => c.id === chatId);
    if (!original) return { success: false, error: "Chat no encontrado." };
    const copy = {
      ...structuredClone(original),
      id: Utils.uid("chat"),
      title: `${original.title} (copia)`,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chats.unshift(copy);
    writeAll(norm, chats);
    EventBus.emit("chat:created", copy);
    return { success: true, chat: copy };
  }

  function togglePin(chatId) {
    return mutateChat(chatId, (chat) => { chat.pinned = !chat.pinned; });
  }

  function toggleFavorite(chatId) {
    return mutateChat(chatId, (chat) => { chat.favorite = !chat.favorite; });
  }

  function toggleArchive(chatId) {
    return mutateChat(chatId, (chat) => { chat.archived = !chat.archived; });
  }

  function exportChat(chatId, format = "txt") {
    const chat = getChat(chatId);
    if (!chat) return null;
    if (format === "json") {
      return { filename: `${slug(chat.title)}.json`, content: JSON.stringify(chat, null, 2), mime: "application/json" };
    }
    if (format === "markdown") {
      const md = chat.messages.map((m) => `**${m.role === "user" ? "Tú" : "Nexy AI"}:**\n\n${m.content}\n`).join("\n---\n\n");
      return { filename: `${slug(chat.title)}.md`, content: `# ${chat.title}\n\n${md}`, mime: "text/markdown" };
    }
    const txt = chat.messages.map((m) => `${m.role === "user" ? "Tú" : "Nexy AI"}: ${m.content}`).join("\n\n");
    return { filename: `${slug(chat.title)}.txt`, content: `${chat.title}\n${"=".repeat(chat.title.length)}\n\n${txt}`, mime: "text/plain" };
  }

  function slug(str) {
    return (str || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50) || "chat";
  }

  return {
    getAllChatsForUser, restoreChatsForUser, deleteAllChatsForUser,
    listChats, getChat, createChat, addMessage, updateLastMessage, renameChat,
    deleteChat, duplicateChat, togglePin, toggleFavorite, toggleArchive, exportChat,
  };
})();
