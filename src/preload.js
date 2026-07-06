// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// 🦈 鲨鲨工具 API
contextBridge.exposeInMainWorld('shark', {
  // 获取所有命令
  getCommands: () => ipcRenderer.invoke('shark:get-commands'),
  
  // 获取插件列表
  getPlugins: () => ipcRenderer.invoke('shark:get-plugins'),
  
  // 加载插件
  loadPlugin: (pluginName) => ipcRenderer.invoke('shark:get-plugin-path', pluginName),
  
  // 插件就绪通知
  pluginReady: (pluginName) => ipcRenderer.send('shark:plugin-ready', pluginName),
  
  // 关闭窗口
  closeWindow: () => ipcRenderer.send('shark:close-window'),
  
  // 监听主进程消息
  on: (channel, callback) => {
    const validChannels = ['shark:open-plugins'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
});

// ---------- 给插件 WebView 使用的 API ----------
// 注意：这个 API 会暴露给插件 webview 中的页面
// 插件可以通过 window.sharkPlugin 调用
contextBridge.exposeInMainWorld('sharkPlugin', {
  // 插件可以调用的安全 API
  getCommands: () => ipcRenderer.invoke('shark:get-commands'),
  getPlugins: () => ipcRenderer.invoke('shark:get-plugins'),
  pluginReady: (pluginName) => ipcRenderer.send('shark:plugin-ready', pluginName),
  closeWindow: () => ipcRenderer.send('shark:close-window'),
  
  // 插件数据存储（示例）
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