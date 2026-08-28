// src/live2d-preload.js — Live2D 桌宠窗口专用桥接
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petApi", {
  // 鼠标是否悬停在模型上：true = 窗口可交互（可拖动），false = 穿透
  setClickable: (on) => ipcRenderer.send("pet:set-clickable", !!on),
  hide: () => ipcRenderer.send("pet:hide"),
  ready: () => ipcRenderer.send("pet:ready"),

  // 搜索面板
  getApps: () => ipcRenderer.invoke("pet:get-apps"),
  launchApp: (item) => ipcRenderer.invoke("pet:launch-app", item),
  setSearchState: (open) => ipcRenderer.send("pet:search-state", !!open),
  onToggleSearch: (cb) => ipcRenderer.on("pet:toggle-search", () => cb()),

  // 模型列表与切换
  getModels: () => ipcRenderer.invoke("pet:get-models"),

  // 插件
  getPlugins: () => ipcRenderer.invoke("pet:get-plugins"),
  onClosePlugin: (cb) => ipcRenderer.on("pet:close-plugin", () => cb()),

  // 快捷键设置
  getShortcuts: () => ipcRenderer.invoke("pet:get-shortcuts"),
  setShortcut: (action, accelerator) => ipcRenderer.invoke("pet:set-shortcut", action, accelerator),

  // 插件通知 → 对话框气泡
  onNotify: (cb) => ipcRenderer.on("pet:notify", (event, title, body) => cb(title, body)),

  // 共享键值存储（与插件 sharkPlugin.storage 同一份数据）
  storage: {
    get: (key) => ipcRenderer.invoke("shark:storage-get", key),
    set: (key, value) => ipcRenderer.invoke("shark:storage-set", key, value),
    remove: (key) => ipcRenderer.invoke("shark:storage-remove", key),
  },
});
