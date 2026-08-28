// src/preload.js — 插件 webview 专用桥接（由 live2d 窗口内的 <webview preload> 加载）
const { contextBridge, ipcRenderer } = require('electron');

// 插件可以通过 window.sharkPlugin 调用的安全 API
contextBridge.exposeInMainWorld('sharkPlugin', {
  // 获取所有命令
  getCommands: () => ipcRenderer.invoke('shark:get-commands'),
  getPlugins: () => ipcRenderer.invoke('pet:get-plugins'),
  pluginReady: (pluginName) => ipcRenderer.send('shark:plugin-ready', pluginName),

  // 插件让宿主关闭插件视图
  closeWindow: () => ipcRenderer.send('shark:close-window'),

  // 插件数据存储（示例，主进程尚未实现对应 handler）
  storage: {
    set: (key, value) => ipcRenderer.invoke('shark:storage-set', key, value),
    get: (key) => ipcRenderer.invoke('shark:storage-get', key),
    remove: (key) => ipcRenderer.invoke('shark:storage-remove', key),
  },

  // 系统通知
  notify: (title, body) => ipcRenderer.send('shark:notification', title, body),

  // 打开外部链接
  openExternal: (url) => ipcRenderer.send('shark:open-external', url),
});
