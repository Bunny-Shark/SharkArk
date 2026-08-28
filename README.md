# SharkArk 🦈

以 **Live2D 桌宠为核心**的 Windows 桌面效率工具。启动后桌宠常驻桌面（透明背景、置顶、不抢焦点、不挡操作），所有功能都通过桌宠下方的工具条使用。

基于 Electron + PixiJS 6 + pixi-live2d-display 构建，同时支持 **Cubism 2** 和 **Cubism 4/5** 模型。

## 快速开始

```bash
npm install
npm start          # 启动，桌宠出现在屏幕右下角
npm start -- --debug   # 打开 DevTools
```

## 功能

### 🎭 模型切换

- 自动扫描 `assets/models/` 下所有模型目录，支持 Cubism 2（`.model.json`）和 Cubism 4/5（`.model3.json`）
- 点击 🎭 展开模型列表，点击即可切换，选择会被记住（下次启动恢复）
- 往 `assets/models/` 放入新的模型文件夹即可，无需改代码

### 🚀 应用快速启动

- 点击 🚀（或全局快捷键）在桌宠头顶弹出搜索框
- 启动时自动扫描 Windows 开始菜单的软件（名称 + 真实图标），支持模糊搜索
- 搜索框和应用图标都贴着模型显示，最多展示 6 个图标，`Enter` 启动第一个匹配，点击图标直接启动
- **鼠标悬停在图标上时，模型会看向该方向并伸出手臂指向它**（依赖模型的手臂参数，Miku 等标准模型自带；没有手臂参数的模型只会转动眼球和头部）

### ℹ️ Live2D 信息与动作

- 点击 ℹ️ 查看当前模型信息：名称、格式、缩放、动作列表等
- 动作按组列出（Tap / Flick / Idle…），**点击任意动作即可让模型播放**，播完自动回到待机

### ⌨️ 自定义快捷键

- 点击 ⌨️ 打开快捷键设置，点击任意条目后按下新的组合键即可生效（立即重注册并持久化到 `settings.json`）
- 可自定义：显示/隐藏桌宠、应用快速启动搜索
- 组合格式：`Alt/Ctrl(+Shift) + 字母/数字/F1~F12`；与其他软件冲突时会提示并自动回滚

### 🧩 插件

- 插件放在 `plugins/` 目录下，每个插件一个文件夹，点击 🧩 展开列表、点击打开（在桌宠窗口内以 webview 呈现）
- 插件结构：

```
plugins/my-plugin/
├── plugin.json    # 清单
├── index.html     # 入口页面
└── renderer.js    # 插件逻辑
```

`plugin.json` 示例：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件说明",
  "icon": "🧩",
  "features": [
    { "code": "hello", "explain": "打招呼", "cmds": ["hello", "你好"], "icon": "👋" }
  ]
}
```

插件页面内通过 `window.sharkPlugin` 调用宿主能力：

| API | 说明 |
| --- | --- |
| `notify(title, body)` | **桌宠弹出对话框气泡**（头顶显示，4 秒自动消失，多条排队播放） |
| `storage.get/set/remove(key)` | 持久化键值存储（保存到项目根目录 `plugin-data.json`） |
| `getCommands()` / `getPlugins()` | 获取所有插件的命令 / 插件列表 |
| `pluginReady(name)` | 通知宿主插件已就绪 |
| `closeWindow()` | 关闭插件视图 |
| `openExternal(url)` | 用系统浏览器打开 http/https 链接 |

自带示例插件 **📝 待办清单**（`plugins/todo/`）：

- 添加待办时可设置**每天定时提醒**（指定 HH:MM）或**间隔循环提醒**（每 1/5/15/30/60 分钟）
- 到点时桌宠弹出提醒对话框（置顶悬浮在所有窗口之上），可选择 **✅ 完成** 或 **⏰ 稍后**（10 分钟后再提醒）
- 提醒调度在桌宠窗口常驻运行，**关闭插件视图后提醒依然有效**
- 数据通过 storage 持久化，重启不丢；对话框里点「完成」会直接写回待办状态，插件界面 3 秒内自动同步

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt+L` | 显示 / 隐藏桌宠（可在 ⌨️ 面板自定义） |
| `Alt+Space` | 打开 / 关闭应用搜索（可在 ⌨️ 面板自定义） |
| `Esc` | 关闭当前打开的面板 |

工具条功能互斥：打开任何一个面板会自动关闭其他面板。桌宠平时鼠标穿透，鼠标移到模型上即可拖动位置。

## 目录结构

```
src/
├── main.js            # 主进程：桌宠窗口、插件加载、软件扫描、IPC、快捷键
├── live2d.html/js     # 桌宠渲染：Live2D、搜索面板、模型切换、插件视图
├── live2d-preload.js  # 桌宠窗口桥接（petApi）
├── preload.js         # 插件 webview 桥接（window.sharkPlugin）
└── app-scanner.js     # 开始菜单软件扫描（名称 + 图标）
plugins/               # 插件目录（每个子文件夹一个插件）
assets/models/         # Live2D 模型（自动扫描）
assets/vendor/         # Live2D 运行时核心（离线可用）
```

## 技术说明

- 依赖版本严格配套：pixi-live2d-display@0.4.0 必须搭配 PixiJS 6.x
- Cubism 运行时核心（`live2d.min.js`、`live2dcubismcore.min.js`）已内置在 `assets/vendor/`，离线可用
- 桌宠窗口默认鼠标穿透，悬停在模型或面板上时恢复交互
