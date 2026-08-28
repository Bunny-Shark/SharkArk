# AGENTS.md — SharkArk

uTools-style launcher ("鲨鲨工具") built with Electron: press a global hotkey, type an intent, jump to an app/file/plugin. Plain JavaScript + CommonJS, no TypeScript, no bundler, no linter, no tests.

## Commands

- `npm start` or `npm run dev` — launch the app (`electron .`)
- `electron . --debug` — launch with DevTools open
- No build/typecheck/lint/test tooling exists; don't invent any in instructions to the user.

## Architecture

```
src/main.js           Electron main process: Live2D pet window, plugin loading, app scanning, IPC, shortcuts
src/live2d.html/js    Pet window renderer: Live2D canvas, search panel, model switcher, plugin webview, info popup
src/live2d-preload.js Pet window contextBridge (window.petApi)
src/preload.js        Plugin webview contextBridge (window.sharkPlugin), loaded via <webview preload>
src/app-scanner.js    Start Menu app scanning (names + icons)
plugins/<name>/       One directory per plugin (plugin.json + index.html + renderer.js)
assets/models/        Live2D models, auto-scanned (Cubism 2 .model.json and Cubism 4/5 .model3.json)
assets/vendor/        Live2D runtime cores (live2d.min.js = Cubism 2, live2dcubismcore.min.js = Cubism 4/5)
```

### Plugin system

- A plugin is a directory under `plugins/` containing `plugin.json`, `index.html`, `renderer.js`. The main process scans this dir at startup (no hot reload — restart the app after adding a plugin).
- `plugin.json` schema: `name`, `version`, `description`, `icon` (emoji), `features[]` each with `code`, `explain`, `cmds[]` (search keywords), `icon`.
- Commands shown in the launcher are aggregated from every plugin's `features[].cmds` (`shark:get-commands`).
- Plugins render inside a `<webview partition="persist:shark-plugins">` in the main window and talk to the host only via `window.sharkPlugin` (see preload.js). Don't give plugins direct Node access in new code paths.

### IPC conventions

- All channels are prefixed `shark:`. `invoke` (request/response) for queries; `send` for notifications (`shark:plugin-ready`, `shark:close-window`, `shark:open-plugins`).
- preload.js allowlists inbound main→renderer channels in `window.shark.on()` — add new push channels there or they'll be silently dropped.
- Note: several `sharkPlugin` channels (`shark:storage-*`, `shark:notification`, `shark:open-external`) have preload bindings but **no handler in main.js** — calling them fails. Wire up handlers if a plugin needs them.

### Live2D desktop pet (src/live2d.*)

- Separate transparent `BrowserWindow` created in `createLive2DWindow()` (main.js): frameless, always-on-top (`screen-saver`), `focusable: false`, `thickFrame: false` (required for transparency on Windows), `setIgnoreMouseEvents(true, { forward: true })` by default.
- The live2d renderer toggles mouse pass-through via `petApi.setClickable()` (IPC `pet:set-clickable`) when the pointer is over the model — that's how the window is both click-through and draggable (`-webkit-app-region: drag`).
- Script load order in `live2d.html` matters: pixi.min.js (v6) → `assets/vendor/live2d.min.js` (Cubism 2 core) → `assets/vendor/live2dcubismcore.min.js` (Cubism 4/5 core) → `pixi-live2d-display/dist/index.min.js` (full build; `cubism4.min.js` alone can't load Cubism 2 `.model.json` models). Both cores are vendored because npm doesn't ship them.
- **Model switching**: main scans `assets/models/*` for `.model.json` (C2) and `.model3.json` (C4) via `pet:get-models`; the bottom toolbar (🎭 models / 🚀 search toggle / ℹ️ Live2D info) sits under the model, switching swaps the `Live2DModel` in place and persists to `localStorage['pet:model']`. Dependency pairing is strict: pixi-live2d-display@0.3.x needs Pixi 5, **0.4.0 needs Pixi 6**, 0.5-beta needs Pixi 7 — Pixi 8 is unsupported. Toggle pet with `Alt+L`; launcher with `Alt+V`.
- **Toolbar panels are mutually exclusive** (`closeAllPanels(except)` in live2d.js): opening search, info, hotkeys, plugin chips, or the model list closes the others; Esc closes everything.
- **Plugin runtime is real**: `sharkPlugin.notify(title, body)` → main forwards `pet:notify` → the pet renders a speech bubble (`#bubble` in live2d.js, queued, anchored above the model head, auto-hides ~4s). `sharkPlugin.storage.get/set/remove` persists to project-root `plugin-data.json` (gitignored); `openExternal` only allows http/https. See `plugins/todo/` for the reference plugin using all of these.
- **Interactive dialogs**: `showDialog(title, body, actions)` in live2d.js returns a Promise resolved by button click; while open it flips the window interactive (`pet:set-search-state`) and suppresses pass-through hover logic (`dialogOpen` guard in the mousemove handler). The TODO reminder scheduler (`checkTodoReminders`, 15s tick in live2d.js) reads the shared `todo:list` storage key and fires these dialogs even when the plugin webview is closed; "稍后" snoozes 10 min via `remindState`. The todo plugin polls storage every 3s to sync host-side changes (e.g. completing from the dialog).
- **Motion playback**: the info popup lists every motion group/clip from `model.internalModel.settings.motions` (works for C2 `file` and C4 `File` keys); clicking plays it via `model.motion(group, index, MotionPriority.FORCE)`. MotionManager state lives at `motionManager.state.currentGroup/currentIndex` — there is no `currentMotion` property.
- **Direct parameter driving (pointing effect)**: hovering an app slot drives `PARAM_ARM_L/R`, `PARAM_EYE_BALL_X`, `PARAM_ANGLE_X` so the model looks at and points toward the slot. Values are written by wrapping `motionManager.update` (after the motion runs, before core update) — NOT from a ticker, or motions overwrite them every frame. C2 coreModel uses `setParamFloat(id, v)`; C4 coreModel's `setParameterValueById` accepts plain string ids. Detection: C4 ids live at `coreModel._model.parameters.ids`; C2 can't be enumerated so ids are tried blindly (set is try/catch-wrapped).
- **Custom hotkeys**: stored in project-root `settings.json` (gitignored), registered by main via `globalShortcut` on startup; `pet:set-shortcut` validates the accelerator, re-registers all hotkeys, rolls back on conflict, and persists. Renderer capture UI intercepts keydown in the capture phase.
- **Panel layout is model-relative** (`updatePanelLayout()` in live2d.js): the search input hovers just above the model's head and the 6 app slots hug the model's sides — positions derive from `model.getBounds()`, not the window edges, and recompute on model switch/resize.
- **The Live2D pet window is the entire app** — there is no launcher window (index.html/renderer.js were removed). Everything is on the pet's bottom toolbar (🎭 models / 🚀 search / 🧩 plugins / ℹ️ info), and the panels are mutually exclusive. Plugins open as a `<webview preload="./preload.js" partition="persist:shark-plugins">` overlay inside the pet window; the pet window therefore needs `webviewTag: true` + `webSecurity: false`. `Alt+L` toggles the pet, `Alt+Space` the search.
- **App search (Alt+Space)**: global shortcut sends `pet:toggle-search` to the pet window; the panel lives inside `live2d.html`. Opening it makes the main process call `setFocusable(true)` + drop mouse pass-through (`pet:search-state`), closing reverses it — the pet window is normally `focusable: false` so this flip is required for the input to receive keys. App list is scanned from Start Menu `.lnk` files by `src/app-scanner.js` (dedup by target exe, icons via `app.getFileIcon` size "large", cached after first `pet:get-apps`); fuzzy match is a subsequence scorer in `live2d.js`, max 6 icon slots flanking the model (no selection highlight; Enter launches the first match, clicking an icon launches and closes the panel). Launch goes through `shell.openPath(lnk)` to preserve shortcut args.

## Gotchas

- Frameless, transparent, always-on-top pet window; `webSecurity: false` exists to let the webview load local `file://` plugin pages — keep that in mind when touching window/webview security settings.
- UI text, comments, and logs are in Chinese. Palette is Catppuccin Mocha-style (`#cdd6f4`, `#89b4fa`, `#45475a`, `#6c7086`); icons are emoji, not image assets.
- `.gitignore` only covers `/node_modules`; `package-lock.json` is committed.
