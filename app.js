(() => {
  'use strict';

  const CLOUD_KEY = 'nexy-ai:workspace:v1';
  const LOCAL_KEY = 'nexy-ai:workspace:backup:v1';
  const MAX_CONTEXT_CHARS = 24_000;
  const TEXT_FILE_TYPES = /^(text\/|application\/(json|javascript|xml)|.*\.(txt|md|csv|json|js|ts|html|css|py|java|c|cpp|log))$/i;
  const state = { user: null, conversations: [], activeId: null, pendingFiles: [], saving: null, busy: false };
  const $ = (selector) => document.querySelector(selector);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindEvents();
    $('#sign-in-button').addEventListener('click', signIn);
    waitForPuter();
  }

  function bindEvents() {
    $('#new-chat-button').addEventListener('click', () => createConversation(true));
    $('.brand').addEventListener('click', (event) => { event.preventDefault(); createConversation(true); });
    $('#composer').addEventListener('submit', sendMessage);
    $('#prompt-input').addEventListener('input', autoGrow);
    $('#attach-file-button').addEventListener('click', () => $('#file-input').click());
    $('#attach-folder-button').addEventListener('click', () => $('#folder-input').click());
    $('#file-input').addEventListener('change', (event) => addFiles(event.target.files));
    $('#folder-input').addEventListener('change', (event) => addFiles(event.target.files));
    $('#command-button').addEventListener('click', openPalette);
    $('#more-button').addEventListener('click', openPalette);
    $('#shortcut-link').addEventListener('click', openPalette);
    $('#command-search').addEventListener('input', renderCommands);
    $('#theme-button').addEventListener('click', toggleTheme);
    $('#sign-out-button').addEventListener('click', signOut);
    $('#clear-chat-button').addEventListener('click', clearConversation);
    $('#open-sidebar').addEventListener('click', () => $('#sidebar').classList.add('is-open'));
    $('#collapse-sidebar').addEventListener('click', () => $('#sidebar').classList.remove('is-open'));
    document.addEventListener('keydown', handleShortcuts);
    ['dragenter', 'dragover'].forEach((name) => document.addEventListener(name, (event) => { event.preventDefault(); $('#composer').classList.add('is-dragging'); }));
    ['dragleave', 'drop'].forEach((name) => document.addEventListener(name, (event) => { event.preventDefault(); $('#composer').classList.remove('is-dragging'); }));
    document.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
  }

  async function waitForPuter() {
    for (let attempt = 0; attempt < 25 && !window.puter; attempt += 1) await delay(120);
    if (!window.puter) {
      $('#auth-status').textContent = 'No se pudo cargar Puter. Comprueba tu conexión y recarga la página.';
      return;
    }
    if (puter.auth.isSignedIn()) await bootWorkspace();
  }

  async function signIn() {
    if (!window.puter) return toast('Puter todavía no está listo. Inténtalo de nuevo en un momento.', 'error');
    const button = $('#sign-in-button');
    button.disabled = true;
    $('#auth-status').textContent = 'Abriendo el acceso seguro de Puter…';
    try {
      await puter.auth.signIn();
      await bootWorkspace();
    } catch (error) {
      $('#auth-status').textContent = userMessage(error, 'No se completó el inicio de sesión.');
      button.disabled = false;
    }
  }

  async function bootWorkspace() {
    try {
      state.user = await puter.auth.getUser();
      await restoreState();
      if (!state.conversations.length) createConversation(false);
      $('#auth-view').hidden = true;
      $('#app-view').hidden = false;
      renderProfile(); renderConversations(); renderMessages();
      $('#prompt-input').focus();
    } catch (error) {
      $('#auth-status').textContent = userMessage(error, 'No pudimos preparar tu espacio de trabajo.');
      $('#sign-in-button').disabled = false;
    }
  }

  async function restoreState() {
    let saved = null;
    try { saved = await puter.kv.get(CLOUD_KEY); } catch (error) { console.warn('Puter KV unavailable:', error); }
    if (!saved) saved = localStorage.getItem(LOCAL_KEY);
    try {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (parsed && Array.isArray(parsed.conversations)) {
        state.conversations = parsed.conversations;
        state.activeId = parsed.activeId;
      }
    } catch { localStorage.removeItem(LOCAL_KEY); }
    if (!state.conversations.some((chat) => chat.id === state.activeId)) state.activeId = state.conversations[0]?.id || null;
  }

  function createConversation(focus) {
    const chat = { id: crypto.randomUUID(), title: 'Nueva conversación', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.conversations.unshift(chat); state.activeId = chat.id; state.pendingFiles = [];
    renderConversations(); renderMessages(); renderAttachments(); persist();
    $('#sidebar').classList.remove('is-open');
    if (focus) $('#prompt-input').focus();
  }

  function currentChat() { return state.conversations.find((chat) => chat.id === state.activeId); }

  function renderProfile() {
    const name = state.user?.username || state.user?.name || 'Usuario Puter';
    $('#profile-name').textContent = name;
    $('#profile-avatar').textContent = initials(name);
  }

  function renderConversations() {
    const list = $('#conversation-list'); list.replaceChildren();
    const chats = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    chats.forEach((chat) => {
      const item = el('button', `conversation-item${chat.id === state.activeId ? ' is-active' : ''}`);
      item.type = 'button'; item.title = chat.title;
      item.append(el('span', 'conversation-spark', '✦'), el('span', 'conversation-name', chat.title));
      item.addEventListener('click', () => { state.activeId = chat.id; state.pendingFiles = []; renderConversations(); renderMessages(); renderAttachments(); $('#sidebar').classList.remove('is-open'); persist(); });
      list.append(item);
    });
  }

  function renderMessages() {
    const chat = currentChat(); const area = $('#messages'); area.replaceChildren();
    $('#conversation-title').textContent = chat?.title || 'Nueva conversación';
    if (!chat?.messages.length) {
      const welcome = el('article', 'welcome-card floating-card');
      welcome.append(el('span', 'welcome-star', '✦'), el('h3', '', '¿Qué vamos a crear hoy?'), el('p', '', 'Pregunta, arrastra archivos o adjunta una carpeta. Nexy guarda la conversación y usa Puter para responder.'));
      const suggestions = el('div', 'suggestion-grid');
      ['Resume este texto', 'Ayúdame a planear un proyecto', 'Explícame un concepto'].forEach((label) => { const button = el('button', 'suggestion', label); button.type = 'button'; button.addEventListener('click', () => { $('#prompt-input').value = label; $('#prompt-input').focus(); autoGrow(); }); suggestions.append(button); });
      welcome.append(suggestions); area.append(welcome);
    } else chat.messages.forEach((message) => area.append(renderMessage(message)));
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  }

  function renderMessage(message) {
    const article = el('article', `message message-${message.role}`);
    const avatar = el('span', 'message-avatar', message.role === 'assistant' ? '✦' : initials(state.user?.username || 'Tú'));
    const body = el('div', 'message-body');
    const meta = el('div', 'message-meta', message.role === 'assistant' ? 'Nexy AI' : 'Tú'); meta.append(el('time', '', formatTime(message.createdAt)));
    const content = el('div', 'message-content'); renderText(content, message.content);
    body.append(meta, content);
    if (message.attachments?.length) {
      const files = el('div', 'sent-files'); message.attachments.forEach((file) => files.append(fileBadge(file))); body.append(files);
    }
    if (message.role === 'assistant' && !message.loading) {
      const actions = el('div', 'message-actions'); const copy = el('button', 'mini-button', 'Copiar'); copy.type = 'button'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(message.content); toast('Respuesta copiada.'); }); actions.append(copy); body.append(actions);
    }
    article.append(avatar, body); return article;
  }

  function renderText(target, text) {
    String(text || '').split(/\n{2,}/).forEach((paragraph) => { const p = el('p'); p.textContent = paragraph; target.append(p); });
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    const known = new Set(state.pendingFiles.map((item) => `${item.file.name}:${item.file.size}:${item.path}`));
    files.forEach((file) => {
      const path = file.webkitRelativePath || file.name; const key = `${file.name}:${file.size}:${path}`;
      if (!known.has(key)) state.pendingFiles.push({ id: crypto.randomUUID(), file, path, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    });
    $('#file-input').value = ''; $('#folder-input').value = ''; renderAttachments(); toast(`${files.length} archivo${files.length === 1 ? '' : 's'} listo${files.length === 1 ? '' : 's'} para enviar.`);
  }

  function renderAttachments() {
    const tray = $('#attachment-tray'); tray.replaceChildren(); tray.hidden = !state.pendingFiles.length;
    state.pendingFiles.forEach((item) => {
      const card = el('div', 'attachment-card');
      if (item.preview) { const image = document.createElement('img'); image.src = item.preview; image.alt = ''; card.append(image); } else card.append(el('span', 'file-symbol', fileSymbol(item.file)));
      const label = el('span', 'attachment-label'); label.append(el('strong', '', item.path), el('small', '', humanSize(item.file.size))); card.append(label);
      const remove = el('button', 'remove-attachment', '×'); remove.type = 'button'; remove.ariaLabel = `Quitar ${item.file.name}`; remove.addEventListener('click', () => removeFile(item.id)); card.append(remove); tray.append(card);
    });
  }

  function removeFile(id) { const file = state.pendingFiles.find((item) => item.id === id); if (file?.preview) URL.revokeObjectURL(file.preview); state.pendingFiles = state.pendingFiles.filter((item) => item.id !== id); renderAttachments(); }

  async function sendMessage(event) {
    event.preventDefault(); if (state.busy) return;
    const prompt = $('#prompt-input').value.trim(); if (!prompt && !state.pendingFiles.length) return;
    if (!window.puter || !puter.auth.isSignedIn()) return toast('Inicia sesión con Puter antes de enviar mensajes.', 'error');
    const chat = currentChat(); const pending = [...state.pendingFiles]; state.pendingFiles = []; renderAttachments();
    const attachmentInfo = await inspectFiles(pending);
    const outboundMessage = { id: crypto.randomUUID(), role: 'user', content: prompt || 'Analiza los archivos adjuntos.', createdAt: Date.now(), attachments: attachmentInfo.metadata };
    chat.messages.push(outboundMessage); chat.updatedAt = Date.now();
    if (chat.messages.length === 1 && prompt) chat.title = compactTitle(prompt);
    $('#prompt-input').value = ''; autoGrow(); state.busy = true; setComposerBusy(true); renderConversations(); renderMessages();
    const placeholder = { id: crypto.randomUUID(), role: 'assistant', content: 'Pensando…', createdAt: Date.now(), loading: true };
    chat.messages.push(placeholder); renderMessages();
    try {
      const uploaded = await uploadFiles(pending, chat.id);
      if (uploaded.length) outboundMessage.attachments = attachmentInfo.metadata.map((file, index) => ({ ...file, cloudPath: uploaded[index]?.path || null }));
      const response = await askPuter(chat, prompt, attachmentInfo.context);
      placeholder.content = response || 'No recibí contenido en la respuesta. Intenta reformular la pregunta.'; placeholder.loading = false;
    } catch (error) {
      placeholder.content = `No pude completar la respuesta. ${userMessage(error, 'Vuelve a intentarlo.')}`; placeholder.loading = false; placeholder.error = true;
    } finally {
      chat.updatedAt = Date.now(); state.busy = false; setComposerBusy(false); renderConversations(); renderMessages(); persist();
    }
  }

  async function inspectFiles(items) {
    const metadata = items.map(({ file, path }) => ({ name: file.name, path, type: file.type || 'archivo', size: file.size }));
    let used = 0; const fragments = [];
    for (const { file, path } of items) {
      if (!TEXT_FILE_TYPES.test(file.type) && !TEXT_FILE_TYPES.test(file.name)) continue;
      const room = MAX_CONTEXT_CHARS - used; if (room <= 0) break;
      try { const text = (await file.text()).slice(0, room); used += text.length; fragments.push(`Archivo: ${path}\n${text}`); } catch { fragments.push(`Archivo: ${path} (no se pudo leer localmente)`); }
    }
    return { metadata, context: fragments.join('\n\n') };
  }

  async function uploadFiles(items, chatId) {
    if (!items.length) return [];
    try { const result = await puter.fs.upload(items.map((item) => item.file), `Nexy AI/conversations/${chatId}`, { dedupeName: true, createMissingParents: true }); return Array.isArray(result) ? result : [result]; }
    catch (error) { toast('Los archivos se adjuntaron al chat, pero no se pudieron subir a tu nube.', 'error'); console.warn(error); return []; }
  }

  async function askPuter(chat, prompt, fileContext) {
    const previous = chat.messages.filter((item) => !item.loading).slice(-12).map((item) => ({ role: item.role, content: item.content }));
    const instruction = 'Eres Nexy AI: claro, útil y honesto. Si recibes extractos de archivos, úsalos solo para responder a la petición actual. Indica cuando un archivo no pudo leerse.';
    const lastUser = previous.at(-1); if (lastUser?.role === 'user' && fileContext) lastUser.content = `${lastUser.content}\n\n[Extractos de archivos adjuntos]\n${fileContext}`;
    const response = await puter.ai.chat([{ role: 'system', content: instruction }, ...previous]);
    return response?.message?.content || response?.text || (typeof response === 'string' ? response : '');
  }

  function persist() {
    clearTimeout(state.saving);
    state.saving = setTimeout(async () => {
      const snapshot = { activeId: state.activeId, conversations: state.conversations.slice(0, 20).map((chat) => ({ ...chat, messages: chat.messages.filter((message) => !message.loading).slice(-50).map(({ id, role, content, createdAt, attachments }) => ({ id, role, content: String(content).slice(0, 12000), createdAt, attachments })) })) };
      const value = JSON.stringify(snapshot); localStorage.setItem(LOCAL_KEY, value);
      try { if (window.puter && puter.auth.isSignedIn()) await puter.kv.set(CLOUD_KEY, value); } catch (error) { console.warn('Could not save cloud state:', error); }
    }, 300);
  }

  function clearConversation() { const chat = currentChat(); if (!chat?.messages.length || !confirm('¿Limpiar todos los mensajes de esta conversación?')) return; chat.messages = []; chat.title = 'Nueva conversación'; chat.updatedAt = Date.now(); renderConversations(); renderMessages(); persist(); }
  async function signOut() { if (!confirm('¿Cerrar sesión de Puter en este navegador?')) return; try { await puter.auth.signOut(); } finally { state.user = null; state.pendingFiles.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)); state.pendingFiles = []; $('#app-view').hidden = true; $('#auth-view').hidden = false; $('#sign-in-button').disabled = false; $('#auth-status').textContent = 'Sesión cerrada. Tus conversaciones siguen guardadas en Puter.'; } }
  function toggleTheme() { document.body.classList.toggle('light-mode'); localStorage.setItem('nexy-ai:theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); }

  function openPalette() { const palette = $('#command-palette'); $('#command-search').value = ''; renderCommands(); palette.showModal(); setTimeout(() => $('#command-search').focus(), 0); }
  function renderCommands() {
    const query = $('#command-search').value.toLowerCase(); const list = $('#command-list'); list.replaceChildren();
    const commands = [
      ['Nueva conversación', 'Ctrl N', () => createConversation(true)], ['Enfocar mensaje', 'Ctrl /', () => $('#prompt-input').focus()], ['Alternar tema', 'Ctrl Shift L', toggleTheme], ['Limpiar conversación', '', clearConversation], ['Cerrar sesión', '', signOut],
      ...state.conversations.map((chat) => [chat.title, 'Conversación', () => { state.activeId = chat.id; renderConversations(); renderMessages(); persist(); }])
    ];
    commands.filter(([name]) => name.toLowerCase().includes(query)).forEach(([name, key, action]) => { const button = el('button', 'command'); button.type = 'button'; button.append(el('span', '', name), el('kbd', '', key)); button.addEventListener('click', () => { $('#command-palette').close(); action(); }); list.append(button); });
  }
  function handleShortcuts(event) {
    const command = event.ctrlKey || event.metaKey; const paletteOpen = $('#command-palette').open;
    if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!paletteOpen) openPalette(); }
    if (command && event.key.toLowerCase() === 'n') { event.preventDefault(); createConversation(true); }
    if (command && event.key === 'Enter' && !paletteOpen) { event.preventDefault(); $('#composer').requestSubmit(); }
    if (command && event.key === '/') { event.preventDefault(); $('#prompt-input').focus(); }
    if (event.key === 'Escape') $('#sidebar').classList.remove('is-open');
  }
  function setComposerBusy(busy) { $('#send-button').disabled = busy; $('#send-button').innerHTML = busy ? '<span class="spinner"></span>' : '<span>↑</span>'; $('#prompt-input').disabled = busy; }
  function autoGrow() { const input = $('#prompt-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  function fileBadge(file) { const badge = el('span', 'file-badge'); badge.append(el('span', '', fileSymbol(file)), el('span', '', file.name)); return badge; }
  function fileSymbol(file) { return file.type?.startsWith('image/') ? '▧' : /pdf/i.test(file.type || file.name) ? 'PDF' : 'TXT'; }
  function compactTitle(text) { return text.replace(/\s+/g, ' ').slice(0, 42) + (text.length > 42 ? '…' : ''); }
  function initials(name) { return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'N'; }
  function formatTime(value) { return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(value); }
  function humanSize(bytes) { if (!bytes) return '0 KB'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
  function userMessage(error, fallback) { return error?.message || error?.msg || fallback; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function toast(message, type = '') { const region = $('#toast-region'); const notice = el('div', `toast ${type}`, message); region.append(notice); setTimeout(() => notice.classList.add('leaving'), 3200); setTimeout(() => notice.remove(), 3600); }
  const savedTheme = localStorage.getItem('nexy-ai:theme'); if (savedTheme === 'light') document.body.classList.add('light-mode');
})();
