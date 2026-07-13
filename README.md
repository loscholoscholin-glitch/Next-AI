# Nexy AI

Aplicación de chat con IA, con sistema de cuentas 100% local (sin backend),
gestión completa de chats, panel de uso de IA e integración con Puter para
la comunicación con el modelo.

## Cómo ejecutarla

No requiere build. Es HTML/CSS/JS puro.

1. Abre una terminal en esta carpeta.
2. Levanta un servidor estático simple, por ejemplo:
   - `python3 -m http.server 8080`
   - o con Node: `npx serve .`
3. Abre `http://localhost:8080` en tu navegador.

(Ábrela con un servidor, no con doble clic en el archivo — `file://` bloquea
el SDK de Puter y algunas APIs del navegador.)

## Estructura

```
nexy-ai-app/
├── index.html
├── assets/img/        → logo (estrella recortada del arte original)
├── css/                → variables, layout, componentes, auth, chat, settings, animaciones
└── js/
    ├── core/           → utils, storage, eventBus, logger
    ├── services/       → crypto, validación, cuentas, sesiones, chats, IA, claves API
    ├── ui/              → toasts, modales
    ├── features/        → auth, chat, settings, ai (paneles de UI)
    └── app.js            → orquestador principal
```

## Notas de seguridad

- Las contraseñas se procesan con PBKDF2-SHA256 (150,000 iteraciones) vía
  Web Crypto API. Nunca se guardan en texto plano.
- Las claves API se cifran con AES-GCM antes de guardarse en localStorage.
- Todo el almacenamiento es local al navegador (localStorage). No hay servidor
  propio: los datos no salen de tu equipo, salvo las llamadas a Puter para
  generar respuestas de IA.

## Próximos pasos sugeridos

- Conectar validación real de claves de proveedores externos (hoy solo
  valida Puter en vivo; OpenAI/Anthropic se validan por formato).
- Añadir soporte multi-idioma si lo necesitas.
- Empaquetar como app de escritorio con Electron/Tauri si quieres un .exe.
