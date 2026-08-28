// src/live2d.js — 桌面 Live2D 渲染 + Alt+Space 软件搜索面板 + 模型切换
const FIT_RATIO = 0.7; // 模型占窗口比例（缩小版）
const MAX_SLOTS = 6; // 模型周围最多显示 6 个软件图标
const MODEL_KEY = "pet:model"; // localStorage 记住上次选择的模型

// ---------- PixiJS / Live2D ----------
const app = new PIXI.Application({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundAlpha: 0,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
});
document.body.appendChild(app.view);

let model = null;
let clickable = false;
let readyNotified = false;

function layout() {
  if (!model) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // model.width 是缩放后的尺寸，先还原出原始尺寸再计算适配
  const naturalW = model.width / model.scale.x;
  const naturalH = model.height / model.scale.y;
  const scale = Math.min(W / naturalW, H / naturalH) * FIT_RATIO;
  model.scale.set(scale);
  model.x = (W - naturalW * scale) / 2;
  model.y = H - naturalH * scale; // 底部对齐，像站在桌面上
  updatePanelLayout();
}

async function loadModel(url) {
  if (model) {
    app.stage.removeChild(model);
    model.destroy();
    model = null;
  }
  try {
    model = await PIXI.live2d.Live2DModel.from(url);
    app.stage.addChild(model);
    layout();
    attachParamDriver(model);
    if (!readyNotified) {
      readyNotified = true;
      window.petApi.ready();
    }
  } catch (err) {
    console.error("Live2D 模型加载失败:", err);
  }
}

// ---------- 悬停应用图标 → 模型看向并伸手指向 ----------
// 依赖模型自身的手臂/眼球/头部参数（miku: PARAM_ARM_L/R、PARAM_EYE_BALL_X、PARAM_ANGLE_X），
// 通过包裹 motionManager.update 在动作更新之后覆写参数值，避免被动作覆盖。
let paramDriver = null;
let pointTarget = { armL: 0, armR: 0, eyeX: 0, angleX: 0 };
let pointCurrent = { armL: 0, armR: 0, eyeX: 0, angleX: 0 };

function detectParams(m) {
  const cm = m.internalModel.coreModel;
  const set = (id, v) => {
    try {
      if (typeof cm.setParameterValueById === "function") cm.setParameterValueById(id, v);
      else if (typeof cm.setParamFloat === "function") cm.setParamFloat(id, v);
    } catch {}
  };
  let ids = [];
  try {
    ids = Array.from((cm._model && cm._model.parameters && cm._model.parameters.ids) || []);
  } catch {}
  // Cubism 2 无法枚举参数，默认尝试（set 内部有 try/catch 兜底）
  const has = (id) => (ids.length ? ids.includes(id) : true);
  return {
    set,
    left: has("PARAM_ARM_L") ? "PARAM_ARM_L" : null,
    right: has("PARAM_ARM_R") ? "PARAM_ARM_R" : null,
    eyeX: has("PARAM_EYE_BALL_X") ? "PARAM_EYE_BALL_X" : null,
    angleX: has("PARAM_ANGLE_X") ? "PARAM_ANGLE_X" : null,
  };
}

function attachParamDriver(m) {
  try {
    paramDriver = detectParams(m);
    const mm = m.internalModel.motionManager;
    const originalUpdate = mm.update.bind(mm);
    mm.update = (model2, now) => {
      const res = originalUpdate(model2, now);
      for (const key of Object.keys(pointCurrent)) {
        pointCurrent[key] += (pointTarget[key] - pointCurrent[key]) * 0.18; // 平滑过渡
      }
      if (paramDriver.left) paramDriver.set(paramDriver.left, pointCurrent.armL);
      if (paramDriver.right) paramDriver.set(paramDriver.right, pointCurrent.armR);
      if (paramDriver.eyeX) paramDriver.set(paramDriver.eyeX, pointCurrent.eyeX);
      if (paramDriver.angleX) paramDriver.set(paramDriver.angleX, pointCurrent.angleX);
      return res;
    };
  } catch (err) {
    console.error("指向参数驱动初始化失败:", err);
  }
}

// 根据图标位置计算指向目标：图标在左侧抬左腕、右侧抬右腕，眼球和头部跟着转
function pointAtSlot(card) {
  if (!model) return;
  const r = card.getBoundingClientRect();
  const mb = model.getBounds();
  const dx = (r.left + r.width / 2 - (mb.x + mb.width / 2)) / (mb.width / 2);
  pointTarget = {
    armL: dx < 0 ? 0.9 : 0,
    armR: dx >= 0 ? 0.9 : 0,
    eyeX: Math.max(-1, Math.min(1, dx)),
    angleX: Math.max(-15, Math.min(15, dx * 12)),
  };
}

function resetPoint() {
  pointTarget = { armL: 0, armR: 0, eyeX: 0, angleX: 0 };
}

// 默认窗口鼠标穿透（不挡桌面），鼠标悬停在模型上时恢复交互
function setClickable(on) {
  if (on === clickable) return;
  clickable = on;
  window.petApi.setClickable(on);
  document.body.style.cursor = on ? "grab" : "default";
}

document.addEventListener("mousemove", (e) => {
  if (panelOpen || dialogOpen) return; // 面板或对话框打开期间窗口始终可交互
  const over = !!model && model.getBounds().contains(e.clientX, e.clientY);
  setClickable(over);
});
document.addEventListener("mouseleave", () => {
  if (!panelOpen) setClickable(false);
});

window.addEventListener("resize", () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
  layout();
});

// ---------- 模型切换栏 ----------
const modelBar = document.getElementById("modelBar");
const modelChips = document.getElementById("modelChips");
document.getElementById("modelToggle").addEventListener("click", () => {
  const opening = !modelBar.classList.contains("expanded");
  closeAllPanels("models"); // 功能互斥
  modelBar.classList.toggle("expanded", opening);
});

// assets/models 下扫描到的模型列表 [{ name, url }]
let models = [];

function renderModelBar() {
  modelChips.innerHTML = models
    .map((m) => `<div class="model-chip" data-url="${m.url}">${m.name}</div>`)
    .join("");
  modelChips.querySelectorAll(".model-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const url = chip.dataset.url;
      localStorage.setItem(MODEL_KEY, url);
      closeAllPanels("models"); // 切换后收起所有面板
      loadModel(url);
    });
  });
}

async function initModels() {
  try {
    models = await window.petApi.getModels();
  } catch (err) {
    console.error("模型列表获取失败:", err);
    return;
  }
  if (!models.length) return;
  renderModelBar();
  // 优先恢复上次选择，否则用第一个
  const saved = localStorage.getItem(MODEL_KEY);
  const target = models.find((m) => m.url === saved) || models[0];
  loadModel(target.url);
}

// ---------- 软件搜索（Alt+Space）----------
const searchPanel = document.getElementById("searchPanel");
const searchInput = document.getElementById("searchInput");
const appSlots = document.getElementById("appSlots");

let apps = []; // 全量扫描结果 [{ name, lnk, icon }]
let shownApps = []; // 当前展示的（最多 6 个）
let panelOpen = false;

// 子序列模糊匹配：连续命中、词首命中加分；-1 = 不匹配
function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  let last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak = ti === last + 1 ? streak + 1 : 1;
      score += 10 + streak * 5 + (ti === 0 || /[\s\-_]/.test(t[ti - 1]) ? 8 : 0);
      last = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

function searchApps(query) {
  if (!query) {
    return apps.slice(0, MAX_SLOTS); // 默认展示前 6 个
  }
  return apps
    .map((a) => ({
      a,
      // 名称和快捷方式文件名都参与匹配，取较高分
      s: Math.max(fuzzyScore(query, a.name), fuzzyScore(query, a.lnk.split(/[\\/]/).pop().replace(/\.lnk$/i, ""))),
    }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, MAX_SLOTS)
    .map((x) => x.a);
}

// 搜索框与图标卡贴着模型布局：输入框悬在头顶，图标分列两侧
function updatePanelLayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const b = model ? model.getBounds() : null;

  // 输入框：水平对齐模型中心，垂直贴模型头顶上方
  const panelW = searchPanel.offsetWidth || W * 0.62;
  const cx = b ? b.x + b.width / 2 : W / 2;
  const panelTop = b ? Math.max(10, b.y - 70) : 26;
  searchPanel.style.left = `${Math.min(Math.max(cx, panelW / 2 + 8), W - panelW / 2 - 8)}px`;
  searchPanel.style.top = `${panelTop}px`;

  // 图标卡：贴模型左右两侧，纵向沿模型中上部排布
  const slotW = 76;
  const gap = 10;
  const xLeft = b ? Math.max(6, b.x - slotW - gap) : 12;
  const xRight = b ? Math.min(W - slotW - 6, b.x + b.width + gap) : W - slotW - 12;
  const startY = b ? b.y + b.height * 0.16 : H * 0.40;
  const step = b ? Math.min(118, b.height * 0.27) : H * 0.17;

  const cards = appSlots.querySelectorAll(".app-slot");
  cards.forEach((card, i) => {
    const col = i < 3 ? "left" : "right";
    const row = i % 3;
    card.style.left = `${col === "left" ? xLeft : xRight}px`;
    card.style.top = `${startY + row * step}px`;
  });
}

function renderSlots() {
  appSlots.innerHTML = shownApps
    .map(
      (a, i) => `
    <div class="app-slot visible" data-idx="${i}">
      <img src="${a.icon || ""}" onerror="this.style.visibility='hidden'" />
      <div class="app-name">${a.name}</div>
    </div>
  `
    )
    .join("");
  updatePanelLayout();

  appSlots.querySelectorAll(".app-slot").forEach((card) => {
    card.addEventListener("mouseenter", () => pointAtSlot(card));
    card.addEventListener("mouseleave", resetPoint);
    card.addEventListener("click", () => launch(shownApps[Number(card.dataset.idx)]));
  });
}

function refreshResults() {
  shownApps = searchApps(searchInput.value.trim());
  renderSlots();
}

async function launch(item) {
  if (!item) return;
  await window.petApi.launchApp(item);
  closePanel();
}

function openPanel() {
  panelOpen = true;
  closeAllPanels("search"); // 关闭信息弹窗、收起模型列表
  searchPanel.classList.add("open");
  updatePanelLayout();
  window.petApi.setSearchState(true); // 主进程：获得焦点 + 取消穿透
  refreshResults();
  // 等主进程把窗口设为可聚焦后再聚焦输入框
  setTimeout(() => searchInput.focus(), 150);
}

function closePanel() {
  panelOpen = false;
  searchPanel.classList.remove("open");
  searchInput.value = "";
  searchInput.blur();
  appSlots.innerHTML = "";
  window.petApi.setSearchState(false); // 主进程：恢复穿透
}

window.petApi.onToggleSearch(() => {
  panelOpen ? closePanel() : openPanel();
});

searchInput.addEventListener("input", refreshResults);

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePanel();
  } else if (e.key === "Enter") {
    e.preventDefault();
    launch(shownApps[0]); // 无选中状态，回车直接启动第一个匹配
  }
});

// ---------- 底部工具条：模型切换 / 快速启动 / Live2D 信息 ----------
const launchBtn = document.getElementById("launchBtn");
const infoBtn = document.getElementById("infoBtn");
const infoPopup = document.getElementById("infoPopup");

// 功能互斥：打开一个就关闭其他（except = 本次要打开的那个）
function closeAllPanels(except) {
  if (except !== "search" && panelOpen) closePanel();
  if (except !== "info") infoPopup.classList.remove("open");
  if (except !== "hotkey") closeHotkeyPanel();
  if (except !== "models") modelBar.classList.remove("expanded");
  if (except !== "pluginChips") pluginChips.classList.remove("open");
  if (except !== "plugin") closePluginView();
}

// 🚀 与 Alt+Space 等效：开/关搜索面板
launchBtn.addEventListener("click", () => {
  if (panelOpen) {
    closePanel();
  } else {
    openPanel(); // openPanel 内部会先关闭其他功能
  }
});

function currentModelMeta() {
  const url = localStorage.getItem(MODEL_KEY) || (models[0] && models[0].url);
  return models.find((m) => m.url === url) || null;
}

function renderInfo() {
  const meta = currentModelMeta();
  const isCubism4 = !!(meta && meta.url.endsWith(".model3.json"));
  let scaleText = "-";
  if (model) scaleText = `${model.scale.x.toFixed(2)}x`;

  // 动作列表（可点击播放）
  let motionHtml = "";
  try {
    const m = model.internalModel.settings.motions || {};
    motionHtml = Object.entries(m)
      .map(([group, arr]) => {
        const chips = (arr || [])
          .map((mo, i) => {
            const file = mo.File || mo.file || "";
            const name = file.split(/[\\/]/).pop().replace(/\.motion3?\.json$/i, "");
            return `<span class="motion-chip" data-g="${group}" data-i="${i}" title="${file}">${name}</span>`;
          })
          .join("");
        return `<div class="motion-group">${group}</div><div class="motion-list">${chips}</div>`;
      })
      .join("");
  } catch {}

  const rows = [
    ["模型", meta ? meta.name : "未知"],
    ["格式", isCubism4 ? "Cubism 4/5" : "Cubism 2"],
    ["缩放", scaleText],
    ["可启动软件", `${apps.length} 个`],
  ];
  infoPopup.innerHTML =
    rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`).join("") +
    `<div class="motion-title">动作（点击播放）</div>` +
    (motionHtml || `<div class="motion-empty">该模型没有可用动作</div>`);

  infoPopup.querySelectorAll(".motion-chip").forEach((chip) => {
    chip.addEventListener("click", () => playMotion(chip.dataset.g, Number(chip.dataset.i)));
  });
}

// 播放动作：FORCE 优先级立即打断 Idle
function playMotion(group, index) {
  if (!model) return;
  try {
    const priority = (PIXI.live2d.MotionPriority && PIXI.live2d.MotionPriority.FORCE) || 3;
    model.motion(group, index, priority);
  } catch (err) {
    console.error("播放动作失败:", err);
  }
}

infoBtn.addEventListener("click", () => {
  const opening = !infoPopup.classList.contains("open");
  closeAllPanels("info");
  infoPopup.classList.toggle("open", opening);
  if (opening) renderInfo();
});

// ---------- 快捷键设置（⌨️）----------
const hotkeyBtn = document.getElementById("hotkeyBtn");
const hotkeyPopup = document.getElementById("hotkeyPopup");

const HOTKEY_ACTIONS = [
  ["togglePet", "显示 / 隐藏桌宠"],
  ["toggleSearch", "应用快速启动搜索"],
];
let currentShortcuts = {};
let capturing = null; // { action, val, orig }

function cancelCapture() {
  if (capturing) {
    capturing.val.textContent = capturing.orig;
    capturing.val.classList.remove("capturing");
    capturing = null;
  }
}

function closeHotkeyPanel() {
  hotkeyPopup.classList.remove("open");
  cancelCapture();
}

function renderHotkeys() {
  hotkeyPopup.innerHTML =
    `<div class="motion-title">快捷键设置（点击修改）</div>` +
    HOTKEY_ACTIONS.map(
      ([a, label]) =>
        `<div class="hk-row" data-action="${a}"><span class="k">${label}</span><span class="hk-val">${currentShortcuts[a] || "未设置"}</span></div>`,
    ).join("") +
    `<div class="hk-tip">支持 Alt/Ctrl(+Shift) + 字母/数字/F1~F12，Esc 取消</div>`;

  hotkeyPopup.querySelectorAll(".hk-row").forEach((row) => {
    row.addEventListener("click", () => {
      if (capturing) cancelCapture();
      const val = row.querySelector(".hk-val");
      capturing = { action: row.dataset.action, val, orig: val.textContent };
      val.textContent = "按下新快捷键…";
      val.classList.add("capturing");
    });
  });
}

hotkeyBtn.addEventListener("click", () => {
  const opening = !hotkeyPopup.classList.contains("open");
  closeAllPanels("hotkey");
  hotkeyPopup.classList.toggle("open", opening);
  if (opening) renderHotkeys();
});

// 快捷键录入：捕获阶段拦截，避免触发其他 Esc 逻辑
document.addEventListener(
  "keydown",
  async (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, val } = capturing;

    if (e.key === "Escape") {
      cancelCapture();
      return;
    }
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
    const keyName = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!mods.length || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
      cancelCapture();
      val.textContent = "需包含 Alt/Ctrl 等修饰键";
      val.classList.add("capturing");
      setTimeout(() => {
        if (!capturing) renderHotkeys();
      }, 1400);
      return;
    }

    const acc = [...mods, keyName].join("+");
    const res = await window.petApi.setShortcut(action, acc);
    capturing = null;
    val.classList.remove("capturing");
    if (res.ok) {
      currentShortcuts[action] = acc;
      renderHotkeys();
    } else {
      val.textContent = res.error;
      val.classList.add("capturing");
      setTimeout(() => {
        if (!capturing) renderHotkeys();
      }, 1600);
    }
  },
  true,
);

window.petApi
  .getShortcuts()
  .then((s) => {
    currentShortcuts = s;
  })
  .catch(() => {});

// ---------- 对话框气泡（插件通知 + 可交互对话框）----------
const bubbleEl = document.getElementById("bubble");
let bubbleTimer = null;
let bubbleActive = false;
let bubbleQueue = [];
let dialogOpen = false; // 交互对话框显示中（窗口需保持可交互）

function positionBubble() {
  const W = window.innerWidth;
  const halfW = Math.min(120, (bubbleEl.offsetWidth || 200) / 2 + 8);
  let cx = W / 2;
  let top = 26;
  if (model) {
    const mb = model.getBounds();
    cx = mb.x + mb.width / 2;
    top = Math.max(6, mb.y - (bubbleEl.offsetHeight || 60) - 14);
  }
  bubbleEl.style.left = `${Math.min(Math.max(cx, halfW), W - halfW)}px`;
  bubbleEl.style.top = `${top}px`;
}

function hideBubble() {
  bubbleEl.classList.remove("show");
  bubbleEl.innerHTML = "";
}

function showNextBubble() {
  const item = bubbleQueue.shift();
  if (!item) {
    bubbleActive = false;
    bubbleTimer = null;
    return;
  }
  bubbleActive = true;
  bubbleEl.innerHTML = `<div class="bubble-title">${item.title}</div>${item.body}`;

  if (item.actions) {
    // 可交互对话框：带按钮，不自动消失
    dialogOpen = true;
    if (!panelOpen) window.petApi.setSearchState(true); // 让气泡按钮可点击
    const act = document.createElement("div");
    act.className = "bubble-actions";
    item.actions.forEach((a) => {
      const b = document.createElement("button");
      b.className = "bubble-btn";
      b.textContent = a.label;
      b.addEventListener("click", () => {
        if (item.resolve) item.resolve(a.value);
        hideBubble();
        dialogOpen = false;
        if (!panelOpen) window.petApi.setSearchState(false); // 恢复穿透
        bubbleActive = false;
        bubbleTimer = setTimeout(showNextBubble, 250);
      });
      act.appendChild(b);
    });
    bubbleEl.appendChild(act);
  } else {
    bubbleTimer = setTimeout(() => {
      hideBubble();
      bubbleActive = false;
      bubbleTimer = setTimeout(showNextBubble, 250); // 两条提示之间的间隔
    }, item.duration || 4000);
  }
  bubbleEl.classList.add("show");
  positionBubble();
}

function showBubble(title, body, duration) {
  bubbleQueue.push({ title, body, duration });
  if (!bubbleActive) showNextBubble();
}

// 可交互对话框：用户点击按钮后 resolve(value)
function showDialog(title, body, actions) {
  return new Promise((resolve) => {
    bubbleQueue.push({ title, body, actions, resolve });
    if (!bubbleActive) showNextBubble();
  });
}

window.petApi.onNotify((title, body) => showBubble(title, body));

// ---------- TODO 定时提醒 ----------
// 桌宠窗口常驻运行，从这里调度插件的待办提醒（插件视图关闭后依然有效）。
// 数据通过共享存储 todo:list 交换；提醒对话框带「完成 / 稍后」按钮。
let remindState = {}; // id -> { cfg, lastDate, nextTs, snoozeUntil }

async function checkTodoReminders() {
  try {
    const todos = (await window.petApi.storage.get("todo:list")) || [];
    const now = new Date();
    for (const t of todos) {
      if (!t || t.done || !t.id) continue;
      if (!t.remindAt && !(t.intervalMin > 0)) continue;
      const st = (remindState[t.id] = remindState[t.id] || {});
      const cfg = `${t.remindAt || ""}|${t.intervalMin || 0}`;
      if (st.cfg !== cfg) {
        st.cfg = cfg;
        st.lastDate = undefined;
        st.nextTs = undefined;
      }
      let due = false;
      if (t.remindAt) {
        // 每天指定时间提醒
        const [h, m] = t.remindAt.split(":").map(Number);
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        if (now >= d && st.lastDate !== d.toDateString() && now >= (st.snoozeUntil || 0)) {
          st.lastDate = d.toDateString();
          due = true;
        }
      }
      if (!due && t.intervalMin > 0) {
        // 间隔循环提醒
        if (!st.nextTs) {
          st.nextTs = Date.now() + t.intervalMin * 60000;
        } else if (Date.now() >= st.nextTs) {
          st.nextTs = Date.now() + t.intervalMin * 60000;
          due = true;
        }
      }
      if (due) fireTodoReminder(t);
    }
  } catch {}
}

function fireTodoReminder(t) {
  showDialog("⏰ 待办提醒", t.text, [
    { label: "✅ 完成", value: "done" },
    { label: "⏰ 稍后", value: "snooze" },
  ]).then(async (v) => {
    if (v === "done") {
      const todos = (await window.petApi.storage.get("todo:list")) || [];
      const item = todos.find((x) => x.id === t.id);
      if (item) {
        item.done = true;
        await window.petApi.storage.set("todo:list", todos);
      }
    } else {
      // 稍后：10 分钟后再提醒
      const st = remindState[t.id] || (remindState[t.id] = {});
      st.snoozeUntil = Date.now() + 10 * 60000;
      if (t.remindAt) st.lastDate = undefined;
      if (t.intervalMin > 0) st.nextTs = Date.now() + 10 * 60000;
    }
  });
}

setInterval(checkTodoReminders, 15000);
checkTodoReminders();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (pluginOpen) {
      closePluginView(); // 插件视图优先关闭
      return;
    }
    infoPopup.classList.remove("open");
    modelBar.classList.remove("expanded");
    pluginChips.classList.remove("open");
    // 搜索面板的 Esc 由输入框自己处理
  }
});

// ---------- 插件（🧩）----------
const pluginBtn = document.getElementById("pluginBtn");
const pluginChips = document.getElementById("pluginChips");
const pluginViewContainer = document.getElementById("pluginViewContainer");
const pluginView = document.getElementById("pluginView");
const pluginTitle = document.getElementById("pluginTitle");

let pluginList = []; // [{ dir, name, icon, description, path }]
let pluginOpen = false;

function renderPluginChips() {
  pluginChips.innerHTML = pluginList.length
    ? pluginList
        .map((p) => `<div class="model-chip" data-dir="${p.dir}">${p.icon} ${p.name}</div>`)
        .join("")
    : `<div class="model-chip" style="cursor:default;color:#6c7086;">暂无插件，放入 plugins/ 目录</div>`;

  pluginChips.querySelectorAll(".model-chip[data-dir]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = pluginList.find((x) => x.dir === chip.dataset.dir);
      pluginChips.classList.remove("open");
      if (p) openPluginView(p);
    });
  });
}

function openPluginView(p) {
  pluginOpen = true;
  pluginTitle.textContent = `${p.icon} ${p.name}`;
  pluginViewContainer.classList.add("open");
  pluginView.src = `file://${p.path.replace(/\\/g, "/")}/index.html`;
  // 插件加载完成后通知其已就绪
  pluginView.addEventListener(
    "dom-ready",
    () => {
      pluginView
        .executeJavaScript(`if (window.sharkPlugin) window.sharkPlugin.pluginReady('${p.dir}')`)
        .catch(() => {});
    },
    { once: true }
  );
}

function closePluginView() {
  if (!pluginOpen) return;
  pluginOpen = false;
  pluginViewContainer.classList.remove("open");
  pluginView.src = "about:blank";
}

pluginBtn.addEventListener("click", () => {
  const opening = !pluginChips.classList.contains("open");
  closeAllPanels("pluginChips");
  renderPluginChips();
  pluginChips.classList.toggle("open", opening);
});

document.getElementById("closePluginBtn").addEventListener("click", () => {
  closePluginView();
});

window.petApi.onClosePlugin(() => closePluginView());

// 后台加载插件列表
window.petApi
  .getPlugins()
  .then((list) => {
    pluginList = list;
  })
  .catch((err) => console.error("插件列表获取失败:", err));

// ---------- 启动 ----------
// 后台获取软件列表（首次会扫描，之后走主进程缓存）
window.petApi
  .getApps()
  .then((list) => {
    apps = list.slice().sort((a, b) => a.name.localeCompare(b.name, "zh"));
    if (panelOpen) refreshResults();
  })
  .catch((err) => console.error("软件扫描失败:", err));

initModels();
