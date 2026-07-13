/**
 * Nexy AI — Settings UI
 * Renders each settings panel on demand (lazy) into #settings-content.
 * Every mutating action re-fetches the account from AccountService afterward
 * rather than trusting local UI state, so the panel can never drift from storage.
 */
const SettingsUI = (() => {
  let currentPanel = "profile";

  function init() {
    document.getElementById("open-settings-btn").addEventListener("click", open);
    document.getElementById("settings-close").addEventListener("click", close);
    document.getElementById("settings-overlay").addEventListener("click", (e) => {
      if (e.target.id === "settings-overlay") close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("settings-overlay").hidden) close();
    });
    document.querySelectorAll(".settings-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
    });
  }

  function open() {
    document.getElementById("settings-overlay").hidden = false;
    switchPanel(currentPanel);
  }
  function close() {
    document.getElementById("settings-overlay").hidden = true;
  }

  function switchPanel(panel) {
    currentPanel = panel;
    document.querySelectorAll(".settings-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.panel === panel));
    const renderers = {
      profile: renderProfile, security: renderSecurity, privacy: renderPrivacy,
      storage: renderStorage, sessions: renderSessions, "ai-usage": renderAiUsage,
      "api-keys": renderApiKeys, interface: renderInterface, "account-actions": renderAccountActions,
    };
    (renderers[panel] || renderProfile)();
  }

  function content() { return document.getElementById("settings-content"); }

  // ---------------------------------------------------------------- PROFILE
  function renderProfile() {
    const acc = AccountService.getCurrent();
    const cooldown = AccountService.getUsernameCooldownInfo(acc);
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Perfil</h2>
        <p class="panel-desc">Gestiona tu identidad dentro de Nexy AI.</p>

        <div class="settings-section">
          <h3>Foto de perfil</h3>
          <div class="avatar-picker">
            <img id="profile-avatar-preview" src="${acc.avatarDataUrl || "assets/img/logo-star.png"}" alt="Avatar">
            <div>
              <button class="btn btn-ghost" id="avatar-upload-btn">Cambiar foto</button>
              <input type="file" id="avatar-file-input" accept="image/*" hidden>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Nombre de usuario</h3>
          <div class="field">
            <input type="text" id="profile-username-input" value="${Utils.escapeHtml(acc.username)}" />
            <span class="field-error" id="profile-username-error"></span>
          </div>
          <button class="btn btn-primary" id="profile-username-save" ${cooldown.onCooldown ? "disabled" : ""}>Guardar nombre</button>
          ${cooldown.onCooldown ? `
            <div class="cooldown-banner">
              ⏳ Podrás cambiar tu usuario de nuevo en <strong>${cooldown.remainingDays} día(s)</strong>
              (disponible el ${Utils.formatDate(cooldown.nextAvailableAt)}).
              Esta restricción existe para prevenir abuso y confusión de identidad.
            </div>` : ""}
        </div>

        <div class="settings-section">
          <h3>Información de la cuenta</h3>
          <div class="settings-row"><span class="settings-row-label">Creada el</span><span>${Utils.formatDateTime(acc.createdAt)}</span></div>
          <div class="settings-row"><span class="settings-row-label">Último inicio de sesión</span><span>${Utils.formatDateTime(acc.lastLoginAt)}</span></div>
        </div>

        <div class="settings-section">
          <h3>Estadísticas</h3>
          <div class="stats-grid">
            <div class="settings-stat"><span class="stat-value">${acc.stats?.messagesSent ?? 0}</span><span class="stat-label">Mensajes</span></div>
            <div class="settings-stat"><span class="stat-value">${acc.stats?.chatsCreated ?? 0}</span><span class="stat-label">Chats creados</span></div>
            <div class="settings-stat"><span class="stat-value">${acc.stats?.loginCount ?? 0}</span><span class="stat-label">Inicios de sesión</span></div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("avatar-upload-btn").addEventListener("click", () => document.getElementById("avatar-file-input").click());
    document.getElementById("avatar-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) { Toast.error("Selecciona un archivo de imagen válido."); return; }
      if (file.size > 2 * 1024 * 1024) { Toast.error("La imagen no puede superar 2MB."); return; }
      const dataUrl = await Utils.readFileAsDataURL(file);
      const res = await AccountService.setAvatar(dataUrl);
      if (res.success) {
        Toast.success("Foto de perfil actualizada.");
        document.getElementById("profile-avatar-preview").src = dataUrl;
        App.refreshSidebarUser();
      } else Toast.error(res.error);
    });

    document.getElementById("profile-username-save").addEventListener("click", async () => {
      const input = document.getElementById("profile-username-input");
      const check = Validation.validateUsername(input.value);
      const errEl = document.getElementById("profile-username-error");
      if (!check.valid) { errEl.textContent = check.error; return; }
      errEl.textContent = "";
      const res = await AccountService.changeUsername(input.value);
      if (res.success) {
        Toast.success("Nombre de usuario actualizado.");
        App.refreshSidebarUser();
        renderProfile();
      } else {
        errEl.textContent = res.error;
      }
    });
  }

  // --------------------------------------------------------------- SECURITY
  function renderSecurity() {
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Seguridad</h2>
        <p class="panel-desc">Tu contraseña se almacena únicamente como un hash irreversible (PBKDF2-SHA256), nunca en texto plano.</p>

        <div class="settings-section">
          <h3>Cambiar contraseña</h3>
          <form id="change-password-form" class="auth-form">
            <div class="field">
              <label>Contraseña actual</label>
              <input type="password" id="current-password" autocomplete="current-password" />
            </div>
            <div class="field">
              <label>Nueva contraseña</label>
              <input type="password" id="new-password" autocomplete="new-password" />
              <div class="strength-meter">
                <div class="strength-bar"><div class="strength-fill" id="settings-strength-fill"></div></div>
                <span class="strength-label" id="settings-strength-label">&nbsp;</span>
              </div>
            </div>
            <div class="field">
              <label>Confirmar nueva contraseña</label>
              <input type="password" id="confirm-new-password" autocomplete="new-password" />
            </div>
            <div class="form-banner" id="change-password-banner" hidden></div>
            <button type="submit" class="btn btn-primary" id="change-password-submit">Actualizar contraseña</button>
          </form>
        </div>
      </div>
    `;

    const newPass = document.getElementById("new-password");
    newPass.addEventListener("input", () => {
      const { score, label, color } = Validation.passwordStrength(newPass.value);
      const fill = document.getElementById("settings-strength-fill");
      fill.style.width = newPass.value ? `${((score + 1) / 5) * 100}%` : "0%";
      fill.style.background = color;
      document.getElementById("settings-strength-label").textContent = newPass.value ? label : "";
    });

    document.getElementById("change-password-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const banner = document.getElementById("change-password-banner");
      banner.hidden = true;
      const current = document.getElementById("current-password").value;
      const next = newPass.value;
      const confirm = document.getElementById("confirm-new-password").value;

      const btn = document.getElementById("change-password-submit");
      btn.disabled = true;
      try {
        const res = await AccountService.changePassword(current, next, confirm);
        if (!res.success) {
          banner.className = "form-banner error"; banner.textContent = res.error; banner.hidden = false;
          return;
        }
        banner.className = "form-banner success"; banner.textContent = "Contraseña actualizada correctamente."; banner.hidden = false;
        document.getElementById("change-password-form").reset();
        document.getElementById("settings-strength-fill").style.width = "0%";
        Toast.success("Contraseña actualizada.");
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- PRIVACY
  function renderPrivacy() {
    const acc = AccountService.getCurrent();
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Privacidad</h2>
        <p class="panel-desc">Todos tus datos permanecen almacenados localmente en este dispositivo. Nexy AI no envía tu información a servidores propios.</p>
        <div class="settings-section">
          <div class="settings-row">
            <div><div class="settings-row-label">Guardar historial de chats</div><div class="settings-row-desc">Desactivarlo no borra chats existentes, solo detiene el guardado de nuevos mensajes.</div></div>
            <label class="switch"><input type="checkbox" id="save-history-toggle" ${acc.settings?.saveHistory !== false ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label>
          </div>
        </div>
      </div>
    `;
    document.getElementById("save-history-toggle").addEventListener("change", (e) => {
      AccountService.updateSettings({ saveHistory: e.target.checked });
      Toast.info(e.target.checked ? "Guardado de historial activado." : "Guardado de historial desactivado.");
    });
  }

  // ---------------------------------------------------------------- STORAGE
  function renderStorage() {
    const bytes = Storage.estimateUsageBytes();
    const kb = (bytes / 1024).toFixed(1);
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Almacenamiento</h2>
        <p class="panel-desc">Nexy AI guarda todo localmente en tu navegador (localStorage).</p>
        <div class="settings-section">
          <div class="settings-row"><span class="settings-row-label">Uso estimado</span><span>${kb} KB</span></div>
        </div>
        <div class="settings-section">
          <h3>Respaldo y restauración</h3>
          <div class="settings-row">
            <div><div class="settings-row-label">Exportar datos de la cuenta</div><div class="settings-row-desc">Perfil y chats en formato JSON legible.</div></div>
            <button class="btn btn-ghost" id="export-account-btn">Exportar</button>
          </div>
          <div class="settings-row">
            <div><div class="settings-row-label">Crear respaldo completo</div><div class="settings-row-desc">Incluye credenciales cifradas para restaurar la cuenta completa.</div></div>
            <button class="btn btn-ghost" id="backup-account-btn">Respaldar</button>
          </div>
          <div class="settings-row">
            <div><div class="settings-row-label">Importar respaldo</div><div class="settings-row-desc">Restaura una cuenta desde un archivo de respaldo (.json).</div></div>
            <button class="btn btn-ghost" id="import-backup-btn">Importar</button>
            <input type="file" id="import-backup-input" accept="application/json" hidden>
          </div>
        </div>
      </div>
    `;

    document.getElementById("export-account-btn").addEventListener("click", () => {
      const data = AccountService.exportAccountData();
      if (data) { Utils.downloadBlob(JSON.stringify(data, null, 2), `nexyai-export-${Date.now()}.json`, "application/json"); Toast.success("Datos exportados."); }
    });
    document.getElementById("backup-account-btn").addEventListener("click", () => {
      const data = AccountService.backupAccountData();
      if (data) { Utils.downloadBlob(JSON.stringify(data, null, 2), `nexyai-backup-${Date.now()}.json`, "application/json"); Toast.success("Respaldo creado."); }
    });
    document.getElementById("import-backup-btn").addEventListener("click", () => document.getElementById("import-backup-input").click());
    document.getElementById("import-backup-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await Utils.readFileAsText(file);
        const res = await AccountService.importBackup(text);
        if (res.success) Toast.success("Respaldo importado. Inicia sesión con esa cuenta.");
        else Toast.error(res.error);
      } catch (err) {
        Toast.error("No se pudo leer el archivo seleccionado.");
      }
    });
  }

  // --------------------------------------------------------------- SESSIONS
  function renderSessions() {
    const acc = AccountService.getCurrent();
    const current = SessionService.getCurrentSessionRecord();
    const sessions = SessionService.listSessions(acc.usernameNormalized).slice().reverse();
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Sesiones</h2>
        <p class="panel-desc">Dispositivos donde has iniciado sesión en Nexy AI.</p>
        <div class="settings-section">
          ${sessions.map((s) => `
            <div class="session-card">
              <span class="session-icon">🖥</span>
              <div class="session-info">
                <strong>${Utils.escapeHtml(s.device)}</strong>
                <span>Iniciada ${Utils.formatRelativeTime(s.createdAt)}</span>
              </div>
              ${s.id === current?.sessionId ? '<span class="session-badge-current">Actual</span>' : `<button class="btn btn-ghost" data-revoke="${s.id}">Cerrar</button>`}
            </div>
          `).join("") || "<p class='panel-desc'>No hay sesiones registradas.</p>"}
        </div>
        ${sessions.length > 1 ? `<button class="btn btn-ghost" id="revoke-all-btn">Cerrar todas las demás sesiones</button>` : ""}
      </div>
    `;
    content().querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", () => {
        SessionService.revokeSession(acc.usernameNormalized, btn.dataset.revoke);
        Toast.success("Sesión cerrada.");
        renderSessions();
      });
    });
    document.getElementById("revoke-all-btn")?.addEventListener("click", () => {
      SessionService.revokeAllOtherSessions(acc.usernameNormalized);
      Toast.success("Se cerraron las demás sesiones.");
      renderSessions();
    });
  }

  // --------------------------------------------------------------- AI USAGE
  async function renderAiUsage() {
    content().innerHTML = `<div class="settings-panel"><h2>Uso de IA</h2><p class="panel-desc">Cargando información del proveedor…</p></div>`;
    const acc = AccountService.getCurrent();
    const usage = await AiService.getUsageInfo();
    const conn = AiService.getConnectionState();

    content().innerHTML = `
      <div class="settings-panel">
        <h2>Uso de IA</h2>
        <p class="panel-desc">Estado en tiempo real de tu conexión con el proveedor de IA.</p>

        <div class="settings-section">
          <h3>Estado de conexión</h3>
          <div class="settings-row"><span class="settings-row-label">Estado</span><span>${conn.state === "online" ? "🟢 Conectado" : conn.state === "offline" ? "🔴 Desconectado" : "🟡 Conectando"}</span></div>
          <div class="settings-row"><span class="settings-row-label">Modelo actual</span><span>${Utils.escapeHtml(document.getElementById("model-select").value || AiService.DEFAULT_MODEL)}</span></div>
          <div class="settings-row"><span class="settings-row-label">Nivel de razonamiento</span><span>${AiService.THINKING_LEVELS[acc.settings?.thinkingLevel || "medium"].label}</span></div>
        </div>

        <div class="settings-section">
          <h3>Cuota y límites</h3>
          ${usage.available ? renderUsageBars(usage.data) : `
            <div class="usage-unavailable">
              ℹ️ ${Utils.escapeHtml(usage.reason)}
            </div>
          `}
        </div>

        <div class="settings-section">
          <h3>Nivel de razonamiento (Thinking)</h3>
          <div class="thinking-option-grid">
            ${Object.entries(AiService.THINKING_LEVELS).map(([key, cfg]) => `
              <div class="thinking-option ${acc.settings?.thinkingLevel === key ? "active" : ""}" data-level="${key}">
                <div class="t-title">${cfg.label}</div>
                <div>${cfg.description}</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;

    content().querySelectorAll(".thinking-option").forEach((el) => {
      el.addEventListener("click", () => {
        const level = el.dataset.level;
        AccountService.updateSettings({ thinkingLevel: level });
        document.getElementById("thinking-select").value = level;
        content().querySelectorAll(".thinking-option").forEach((o) => o.classList.remove("active"));
        el.classList.add("active");
        Toast.success(`Nivel de razonamiento: ${AiService.THINKING_LEVELS[level].label}.`);
      });
    });
  }

  function renderUsageBars(data) {
    const rows = [];
    if (typeof data.remainingRequests === "number" && typeof data.dailyQuota === "number") {
      rows.push(usageRow("Solicitudes restantes hoy", data.remainingRequests, data.dailyQuota));
    }
    if (typeof data.remainingTokens === "number" && typeof data.monthlyTokenQuota === "number") {
      rows.push(usageRow("Tokens restantes este mes", data.remainingTokens, data.monthlyTokenQuota));
    }
    if (rows.length === 0) {
      return `<div class="usage-unavailable">ℹ️ El proveedor respondió, pero no incluyó valores de cuota reconocibles.</div>`;
    }
    return rows.join("");
  }

  function usageRow(label, remaining, total) {
    const pct = total > 0 ? Utils.clamp((remaining / total) * 100, 0, 100) : 0;
    return `
      <div class="usage-row">
        <div class="usage-row-head"><span>${label}</span><span>${remaining} / ${total}</span></div>
        <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  // ---------------------------------------------------------------- API KEYS
  function renderApiKeys() {
    const statuses = ApiKeyService.listStatuses();
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Claves API</h2>
        <p class="panel-desc">Las claves se cifran localmente (AES-GCM) antes de guardarse. Nunca se muestran en texto plano salvo que las revele explícitamente.</p>
        <div id="apikeys-list">
          ${statuses.map((s) => renderApiKeyCard(s)).join("")}
        </div>
      </div>
    `;
    statuses.forEach((s) => wireApiKeyCard(s.providerId));
  }

  function renderApiKeyCard(status) {
    const pillClass = status.valid === true ? "valid" : status.valid === false ? "invalid" : "unset";
    const pillText = status.valid === true ? "Válida" : status.valid === false ? "Inválida" : status.hasKey ? "Sin validar" : "No configurada";
    return `
      <div class="apikey-card" data-provider="${status.providerId}">
        <div class="apikey-head">
          <strong>${Utils.escapeHtml(status.label)}</strong>
          <span class="status-pill ${pillClass}">${pillText}</span>
        </div>
        ${status.hasKey ? `<div class="settings-row-desc" style="margin-bottom:8px;">Clave: <code>${Utils.escapeHtml(status.maskedPreview)}</code>${status.lastValidatedAt ? ` · validada ${Utils.formatRelativeTime(status.lastValidatedAt)}` : ""}</div>` : ""}
        <div class="apikey-input-row">
          <input type="password" placeholder="${status.hasKey ? "Reemplazar clave…" : "Pegar clave API…"}" data-input="${status.providerId}">
          <button class="icon-btn" data-action="toggle-visibility" data-provider="${status.providerId}" title="Mostrar/ocultar">👁</button>
          <button class="btn btn-ghost" data-action="save" data-provider="${status.providerId}">Guardar</button>
        </div>
        <div class="apikey-input-row" style="margin-top:8px;">
          <button class="btn btn-ghost" data-action="validate" data-provider="${status.providerId}" ${!status.hasKey ? "disabled" : ""}>Probar conexión</button>
          <button class="btn btn-ghost" data-action="remove" data-provider="${status.providerId}" ${!status.hasKey ? "disabled" : ""}>Eliminar</button>
        </div>
      </div>
    `;
  }

  function wireApiKeyCard(providerId) {
    const card = document.querySelector(`.apikey-card[data-provider="${providerId}"]`);
    if (!card) return;
    const input = card.querySelector(`[data-input="${providerId}"]`);

    card.querySelector('[data-action="toggle-visibility"]').addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
    });

    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      if (Utils.isBlank(input.value)) { Toast.error("Ingresa una clave antes de guardar."); return; }
      const res = await ApiKeyService.addOrReplaceKey(providerId, input.value);
      if (res.success) { Toast.success("Clave guardada de forma segura."); renderApiKeys(); }
      else Toast.error(res.error);
    });

    card.querySelector('[data-action="validate"]').addEventListener("click", async (e) => {
      const btn = e.target;
      btn.disabled = true; btn.textContent = "Probando…";
      const res = await ApiKeyService.validateKey(providerId);
      btn.disabled = false; btn.textContent = "Probar conexión";
      if (res.success) {
        Toast[res.valid ? "success" : "warning"](res.valid ? "Conexión validada correctamente." : "La clave no pudo validarse.");
        renderApiKeys();
      } else Toast.error(res.error);
    });

    card.querySelector('[data-action="remove"]').addEventListener("click", async () => {
      const confirmed = await ModalUI.open({ title: "Eliminar clave API", message: `¿Eliminar la clave de ${providerId}? Esta acción no se puede deshacer.`, confirmLabel: "Eliminar" });
      if (confirmed) { await ApiKeyService.removeKey(providerId); Toast.success("Clave eliminada."); renderApiKeys(); }
    });
  }

  // --------------------------------------------------------------- INTERFACE
  function renderInterface() {
    const acc = AccountService.getCurrent();
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Interfaz</h2>
        <p class="panel-desc">Ajusta la experiencia visual de Nexy AI.</p>
        <div class="settings-section">
          <div class="settings-row">
            <div><div class="settings-row-label">Modo de rendimiento</div><div class="settings-row-desc">Desactiva animaciones costosas para mayor fluidez en equipos más lentos.</div></div>
            <label class="switch"><input type="checkbox" id="perf-mode-toggle" ${acc.settings?.performanceMode ? "checked" : ""}><span class="track"><span class="thumb"></span></span></label>
          </div>
        </div>
      </div>
    `;
    document.getElementById("perf-mode-toggle").addEventListener("change", (e) => {
      AccountService.updateSettings({ performanceMode: e.target.checked });
      document.documentElement.dataset.perfMode = e.target.checked ? "on" : "off";
      Toast.info(e.target.checked ? "Modo de rendimiento activado." : "Modo de rendimiento desactivado.");
    });
  }

  // --------------------------------------------------------- ACCOUNT ACTIONS
  function renderAccountActions() {
    content().innerHTML = `
      <div class="settings-panel">
        <h2>Acciones de cuenta</h2>
        <div class="settings-section">
          <div class="settings-row">
            <div><div class="settings-row-label">Cerrar sesión</div><div class="settings-row-desc">Termina tu sesión en este dispositivo.</div></div>
            <button class="btn btn-ghost" id="logout-btn">Cerrar sesión</button>
          </div>
        </div>
        <div class="settings-section danger-zone">
          <h3>⚠ Zona de peligro</h3>
          <div class="settings-row">
            <div><div class="settings-row-label">Eliminar cuenta</div><div class="settings-row-desc">Borra permanentemente tu cuenta, chats y claves API de este dispositivo.</div></div>
            <button class="btn btn-danger" id="delete-account-btn">Eliminar cuenta</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      const confirmed = await ModalUI.open({ title: "Cerrar sesión", message: "¿Deseas cerrar tu sesión actual?", confirmLabel: "Cerrar sesión", danger: false });
      if (confirmed) { close(); App.logout(); }
    });
    document.getElementById("delete-account-btn").addEventListener("click", async () => {
      const result = await ModalUI.open({
        title: "Eliminar cuenta permanentemente",
        message: "Esta acción eliminará tu cuenta, todos tus chats y claves API guardadas en este dispositivo. No se puede deshacer. Ingresa tu contraseña para confirmar.",
        requirePassword: true, confirmLabel: "Eliminar definitivamente",
      });
      if (result && result.password) {
        const res = await AccountService.deleteAccount(result.password);
        if (res.success) { close(); Toast.success("Cuenta eliminada."); App.logout(true); }
        else Toast.error(res.error);
      }
    });
  }

  return { init, open, close, switchPanel };
})();
