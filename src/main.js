// src/main.js
const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- 配置 ----------
const APP_NAME = '鲨鲨工具';
const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

// ---------- 插件管理系统 ----------
const plugins = [];

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log(`[${APP_NAME}] 插件目录不存在，创建:`, PLUGINS_DIR);
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    return;
  }

  const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const manifestPath = path.join(PLUGINS_DIR, dir.name, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        plugins.push({
          name: dir.name,
          manifest,
          path: path.join(PLUGINS_DIR, dir.name)
        });
        console.log(`[${APP_NAME}] ✅ 加载插件: ${manifest.name} v${manifest.version}`);
      } catch (error) {
        console.error(`[${APP_NAME}] ❌ 加载失败 ${dir.name}:`, error.message);
      }
    }
  }
  
  console.log(`[${APP_NAME}] 共加载 ${plugins.length} 个插件`);
}

// ---------- IPC 通信 ----------
// 获取所有命令
ipcMain.handle('shark:get-commands', () => {
  const commands = [];
  for (const plugin of plugins) {
    if (plugin.manifest.features) {
      for (const feature of plugin.manifest.features) {
        if (feature.cmds) {
          commands.push(...feature.cmds.map(cmd => ({
            cmd,
            plugin: plugin.manifest.name,
            explain: feature.explain,
            code: feature.code,
            icon: feature.icon || '🧩'
          })));
        }
      }
    }
  }
  return commands;
});

// 获取插件列表
ipcMain.handle('shark:get-plugins', () => {
  return plugins.map(p => ({
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description || '',
    icon: p.manifest.icon || '🧩',
    author: p.manifest.author || ''
  }));
});

// 获取插件路径
ipcMain.handle('shark:get-plugin-path', (event, pluginName) => {
  const plugin = plugins.find(p => p.name === pluginName);
  return plugin ? plugin.path : null;
});

// 插件就绪通知
ipcMain.on('shark:plugin-ready', (event, pluginName) => {
  console.log(`[${APP_NAME}] 📢 ${pluginName} 已就绪`);
});

// 窗口关闭通知
ipcMain.on('shark:close-window', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.hide();
});

// ---------- 主窗口 ----------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 480,
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,          // 先隐藏，等准备好了再显示
    vibrancy: 'dark',     // macOS 毛玻璃效果
    visualEffectState: 'active',
    backgroundColor: '#00000000',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 失去焦点时自动隐藏（类似 uTools）
  mainWindow.on('blur', () => {
    // 如果插件视图打开，可以在这里决定是否隐藏
    // mainWindow.hide();
  });

  // 开发工具
  if (process.argv.includes('--debug')) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

// ---------- 全局快捷键 ----------
function registerShortcuts() {
  // Alt + V 呼出/隐藏
  const ret = globalShortcut.register('Alt+V', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  if (ret) {
    console.log(`[${APP_NAME}] ⌨️ 全局快捷键注册成功: Alt+V`);
  } else {
    console.log(`[${APP_NAME}] ⌨️ 全局快捷键注册失败，可能被占用`);
  }

  // Ctrl+Shift+P 打开插件管理
  globalShortcut.register('Ctrl+Shift+P', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shark:open-plugins');
    }
  });
}

// ---------- 应用生命周期 ----------
app.whenReady().then(() => {
  loadPlugins();
  createWindow();
  registerShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 清理快捷键
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});