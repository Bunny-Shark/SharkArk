// src/main.js
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  shell,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { scanInstalledApps } = require("./app-scanner");

// ---------- 配置 ----------
const APP_NAME = "鲨鲨工具";
const PLUGINS_DIR = path.join(__dirname, "..", "plugins");

// ---------- 插件管理系统 ----------
const plugins = [];

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log(`[${APP_NAME}] 插件目录不存在，创建:`, PLUGINS_DIR);
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    return;
  }

  const dirs = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const manifestPath = path.join(PLUGINS_DIR, dir.name, "plugin.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        plugins.push({
          name: dir.name,
          manifest,
          path: path.join(PLUGINS_DIR, dir.name),
        });
        console.log(
          `[${APP_NAME}] ✅ 加载插件: ${manifest.name} v${manifest.version}`,
        );
      } catch (error) {
        console.error(`[${APP_NAME}] ❌ 加载失败 ${dir.name}:`, error.message);
      }
    }
  }

  console.log(`[${APP_NAME}] 共加载 ${plugins.length} 个插件`);
}

// ---------- 插件 IPC ----------
// 获取所有命令（供插件内部使用）
ipcMain.handle("shark:get-commands", () => {
  const commands = [];
  for (const plugin of plugins) {
    if (plugin.manifest.features) {
      for (const feature of plugin.manifest.features) {
        if (feature.cmds) {
          commands.push(
            ...feature.cmds.map((cmd) => ({
              cmd,
              plugin: plugin.manifest.name,
              explain: feature.explain,
              code: feature.code,
              icon: feature.icon || "🧩",
            })),
          );
        }
      }
    }
  }
  return commands;
});

// 插件就绪通知
ipcMain.on("shark:plugin-ready", (event, pluginName) => {
  console.log(`[${APP_NAME}] 📢 ${pluginName} 已就绪`);
});

// 插件请求关闭插件视图 → 转发给桌宠窗口
ipcMain.on("shark:close-window", () => {
  if (live2dWindow && !live2dWindow.isDestroyed()) {
    live2dWindow.webContents.send("pet:close-plugin");
  }
});

// ---------- 插件运行时（存储 / 通知 / 外链）----------
const PLUGIN_DATA_PATH = path.join(__dirname, "..", "plugin-data.json");
let pluginData = {};
try {
  pluginData = JSON.parse(fs.readFileSync(PLUGIN_DATA_PATH, "utf8"));
} catch {}

function savePluginData() {
  try {
    fs.writeFileSync(PLUGIN_DATA_PATH, JSON.stringify(pluginData, null, 2));
  } catch {}
}

// 插件键值存储（持久化到 plugin-data.json）
ipcMain.handle("shark:storage-set", (event, key, value) => {
  pluginData[String(key)] = value === undefined ? null : value;
  savePluginData();
  return true;
});

ipcMain.handle("shark:storage-get", (event, key) => {
  return key in pluginData ? pluginData[key] : null;
});

ipcMain.handle("shark:storage-remove", (event, key) => {
  delete pluginData[String(key)];
  savePluginData();
  return true;
});

// 插件通知 → 桌宠对话框气泡
ipcMain.on("shark:notification", (event, title, body) => {
  if (live2dWindow && !live2dWindow.isDestroyed()) {
    live2dWindow.webContents.send("pet:notify", String(title || ""), String(body || ""));
  }
});

// 外部链接（仅允许 http/https）
ipcMain.on("shark:open-external", (event, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

// ---------- Live2D 桌宠窗口 ----------
let live2dWindow = null;

function createLive2DWindow() {
  if (live2dWindow && !live2dWindow.isDestroyed()) return live2dWindow;

  const wa = screen.getPrimaryDisplay().workArea;
  live2dWindow = new BrowserWindow({
    width: 640,
    height: 780,
    x: wa.x + wa.width - 660,
    y: wa.y + wa.height - 800,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // 不抢焦点，纯展示
    resizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false, // Windows 下透明窗口必须去掉粗边框
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "live2d-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // 🧩 插件在窗口内以 webview 打开
      // 允许 webview 加载本地 file:// 插件页面
      webSecurity: false,
    },
  });

  // 最高层级置顶
  live2dWindow.setAlwaysOnTop(true, "screen-saver");
  // 默认鼠标穿透，由渲染进程在悬停到模型上时恢复交互
  live2dWindow.setIgnoreMouseEvents(true, { forward: true });
  live2dWindow.loadFile(path.join(__dirname, "live2d.html"));

  // 开发工具
  if (process.argv.includes("--debug")) {
    live2dWindow.webContents.openDevTools();
  }

  live2dWindow.on("closed", () => {
    live2dWindow = null;
  });

  return live2dWindow;
}

function toggleLive2DWindow() {
  if (!live2dWindow || live2dWindow.isDestroyed()) {
    createLive2DWindow();
    return;
  }
  if (live2dWindow.isVisible()) {
    live2dWindow.hide();
  } else {
    live2dWindow.show();
  }
}

// ---------- Live2D 桌宠 IPC ----------
ipcMain.on("pet:set-clickable", (event, on) => {
  if (live2dWindow && !live2dWindow.isDestroyed()) {
    live2dWindow.setIgnoreMouseEvents(!on, { forward: true });
  }
});

// 搜索面板开/关：开 = 临时获得焦点并取消穿透，关 = 恢复穿透、放弃焦点
ipcMain.on("pet:search-state", (event, open) => {
  if (!live2dWindow || live2dWindow.isDestroyed()) return;
  if (open) {
    live2dWindow.setFocusable(true);
    live2dWindow.setIgnoreMouseEvents(false);
    live2dWindow.focus();
  } else {
    live2dWindow.setIgnoreMouseEvents(true, { forward: true });
    live2dWindow.setFocusable(false);
  }
});

// 扫描已安装软件（首次调用后缓存）
let appListCache = null;
ipcMain.handle("pet:get-apps", async () => {
  if (!appListCache) {
    appListCache = await scanInstalledApps();
    console.log(`[${APP_NAME}] 🔍 扫描到 ${appListCache.length} 个软件`);
  }
  return appListCache;
});

ipcMain.handle("pet:launch-app", async (event, item) => {
  if (!item || !item.lnk) return "无效的应用";
  const err = await shell.openPath(item.lnk); // 打开 .lnk 保留原快捷方式参数
  return err || null;
});

// 扫描 assets/models 下所有模型（同时支持 Cubism 2 的 .model.json 和 Cubism 4/5 的 .model3.json）
ipcMain.handle("pet:get-models", () => {
  const dir = path.join(__dirname, "..", "assets", "models");
  const models = [];
  if (!fs.existsSync(dir)) return models;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const sub = path.join(dir, d.name);
    const files = fs
      .readdirSync(sub)
      .filter((f) => f.endsWith(".model3.json") || f.endsWith(".model.json"));
    if (files.length === 1) {
      models.push({ name: d.name, url: `../assets/models/${d.name}/${files[0]}` });
    } else {
      for (const f of files) {
        models.push({
          name: `${d.name}·${f.replace(/\.model3?\.json$/, "")}`,
          url: `../assets/models/${d.name}/${f}`,
        });
      }
    }
  }
  return models;
});

ipcMain.on("pet:hide", () => {
  if (live2dWindow && !live2dWindow.isDestroyed()) live2dWindow.hide();
});

ipcMain.on("pet:ready", () => {
  console.log(`[${APP_NAME}] 🎀 Live2D 桌宠已就绪`);
});

// 插件列表（供桌宠窗口 🧩 按钮展示）
ipcMain.handle("pet:get-plugins", () => {
  return plugins.map((p) => ({
    dir: p.name, // 目录名，唯一标识
    name: p.manifest.name || p.name,
    icon: p.manifest.icon || "🧩",
    description: p.manifest.description || "",
    path: p.path,
  }));
});

// 主窗口渲染进程也能切换桌宠
ipcMain.on("shark:toggle-live2d", () => {
  toggleLive2DWindow();
});

// ---------- 全局快捷键（可自定义，持久化到 settings.json）----------
const SETTINGS_PATH = path.join(__dirname, "..", "settings.json");
const DEFAULT_SHORTCUTS = { togglePet: "Alt+L", toggleSearch: "Alt+Space" };
let shortcuts = { ...DEFAULT_SHORTCUTS };

const SHORTCUT_ACTIONS = {
  togglePet: () => toggleLive2DWindow(),
  toggleSearch: () => {
    if (live2dWindow && !live2dWindow.isDestroyed()) {
      live2dWindow.webContents.send("pet:toggle-search");
    }
  },
};

function loadShortcuts() {
  try {
    shortcuts = { ...DEFAULT_SHORTCUTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) };
  } catch {
    shortcuts = { ...DEFAULT_SHORTCUTS };
  }
}

function saveShortcuts() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(shortcuts, null, 2));
  } catch {}
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  for (const [action, acc] of Object.entries(shortcuts)) {
    const ok = globalShortcut.register(acc, SHORTCUT_ACTIONS[action]);
    console.log(`[${APP_NAME}] ⌨️ ${action} = ${acc} ${ok ? "注册成功" : "注册失败，可能被占用"}`);
  }
}

// 查询 / 修改快捷键（修改后立即重注册并持久化）
ipcMain.handle("pet:get-shortcuts", () => shortcuts);

ipcMain.handle("pet:set-shortcut", (event, action, accelerator) => {
  if (!SHORTCUT_ACTIONS[action]) return { ok: false, error: "未知的快捷键动作" };
  if (
    !/^(Ctrl|Alt|Super|Shift|Cmd)\+(([A-Z0-9])|F([1-9]|1[0-2])|Space|Tab|Up|Down|Left|Right|\+)$/.test(
      accelerator,
    )
  ) {
    return { ok: false, error: "格式无效，需包含 Alt/Ctrl 等修饰键" };
  }

  const old = shortcuts[action];
  shortcuts[action] = accelerator;
  globalShortcut.unregisterAll();
  let conflict = null;
  for (const [a, acc] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(acc, SHORTCUT_ACTIONS[a])) conflict = acc;
  }
  if (conflict) {
    // 回滚
    shortcuts[action] = old;
    globalShortcut.unregisterAll();
    for (const [a, acc] of Object.entries(shortcuts)) {
      globalShortcut.register(acc, SHORTCUT_ACTIONS[a]);
    }
    return { ok: false, error: `快捷键 ${conflict} 已被占用` };
  }
  saveShortcuts();
  console.log(`[${APP_NAME}] ⌨️ ${action} 快捷键已改为 ${accelerator}`);
  return { ok: true };
});

// ---------- 应用生命周期 ----------
app.whenReady().then(() => {
  loadPlugins();
  createLive2DWindow();
  loadShortcuts();
  registerShortcuts();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!live2dWindow || live2dWindow.isDestroyed()) {
    createLive2DWindow();
  }
});

// 清理快捷键
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
