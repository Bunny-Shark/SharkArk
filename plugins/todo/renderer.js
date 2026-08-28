// plugins/todo/renderer.js — 待办清单逻辑（通过 window.sharkPlugin 与宿主通信）
// 提醒调度在桌宠窗口常驻运行（live2d.js 读取共享存储 todo:list），这里只负责编辑数据。
const STORAGE_KEY = "todo:list";
let todos = [];
let editing = null; // 正在编辑的条目下标

const listEl = document.getElementById("todoList");
const inputEl = document.getElementById("todoInput");
const timeEl = document.getElementById("todoTime");
const intervalEl = document.getElementById("todoInterval");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelEditBtn");

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function load() {
  try {
    todos = (await window.sharkPlugin.storage.get(STORAGE_KEY)) || [];
  } catch {
    todos = [];
  }
  if (!Array.isArray(todos)) todos = [];
  // 旧数据补 id
  let changed = false;
  for (const t of todos) {
    if (!t.id) {
      t.id = makeId();
      changed = true;
    }
  }
  if (changed) await save();
  render();
}

async function save() {
  await window.sharkPlugin.storage.set(STORAGE_KEY, todos);
}

function remindBadge(t) {
  const parts = [];
  if (t.remindAt) parts.push(`⏰ ${t.remindAt}`);
  if (t.intervalMin > 0) parts.push(`🔁 ${t.intervalMin}分`);
  return parts.join(" ");
}

function render() {
  if (!todos.length) {
    listEl.innerHTML = `<div class="todo-empty">还没有待办，添加一条吧</div>`;
    return;
  }
  listEl.innerHTML = todos
    .map((t, i) => {
      const badge = remindBadge(t);
      return `
    <li class="${t.done ? "done" : ""}" data-i="${i}">
      <span class="check"></span>
      <span class="text">${t.text}</span>
      ${badge ? `<span class="remind-badge" data-edit="${i}" title="修改提醒设置">${badge}</span>` : `<span class="remind-badge" data-edit="${i}" title="设置提醒">＋⏰</span>`}
      <span class="del" data-del="${i}">✕</span>
    </li>`;
    })
    .join("");

  listEl.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.dataset.edit !== undefined || e.target.dataset.del !== undefined) return;
      toggle(Number(li.dataset.i));
    });
  });
  listEl.querySelectorAll(".remind-badge").forEach((badge) => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      startEdit(Number(badge.dataset.edit));
    });
  });
  listEl.querySelectorAll(".del").forEach((del) => {
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      remove(Number(del.dataset.del));
    });
  });
}

function startEdit(i) {
  editing = i;
  const t = todos[i];
  inputEl.value = t.text;
  timeEl.value = t.remindAt || "";
  intervalEl.value = t.intervalMin > 0 ? String(t.intervalMin) : "";
  saveBtn.textContent = "保存";
  cancelBtn.classList.add("show");
  inputEl.focus();
}

function resetForm() {
  editing = null;
  inputEl.value = "";
  timeEl.value = "";
  intervalEl.value = "";
  saveBtn.textContent = "添加";
  cancelBtn.classList.remove("show");
}

async function submit() {
  const text = inputEl.value.trim();
  const remindAt = timeEl.value || "";
  const intervalMin = intervalEl.value ? Number(intervalEl.value) : 0;

  if (editing !== null) {
    const t = todos[editing];
    if (!text.trim()) {
      resetForm();
      return;
    }
    t.text = text.trim();
    t.remindAt = remindAt;
    t.intervalMin = intervalMin;
    resetForm();
    await save();
    render();
    window.sharkPlugin.notify("📝 已更新提醒", t.remindAt ? `${t.text}（每天 ${t.remindAt}）` : t.intervalMin ? `${t.text}（每 ${t.intervalMin} 分钟）` : t.text);
    return;
  }

  if (!text) return;
  todos.unshift({ id: makeId(), text: text.trim(), done: false, remindAt, intervalMin });
  resetForm();
  await save();
  render();
  window.sharkPlugin.notify("📝 新增待办", text.trim());
}

async function toggle(i) {
  todos[i].done = !todos[i].done;
  await save();
  render();
  if (todos[i].done) {
    window.sharkPlugin.notify("✅ 待办完成", todos[i].text);
  }
}

async function remove(i) {
  const [t] = todos.splice(i, 1);
  if (editing === i) resetForm();
  await save();
  render();
  window.sharkPlugin.notify("🗑️ 删除待办", t.text);
}

saveBtn.addEventListener("click", submit);
cancelBtn.addEventListener("click", resetForm);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
});

// 桌宠对话框里点「完成」会直接改存储，轮询同步外部变更
let lastRaw = "";
setInterval(async () => {
  try {
    const raw = (await window.sharkPlugin.storage.get(STORAGE_KEY)) || [];
    if (JSON.stringify(raw) !== lastRaw && JSON.stringify(raw) !== JSON.stringify(todos)) {
      todos = raw;
      if (!Array.isArray(todos)) todos = [];
      let changed = false;
      for (const t of todos) {
        if (!t.id) {
          t.id = makeId();
          changed = true;
        }
      }
      if (changed) await save();
      render();
    }
    lastRaw = JSON.stringify(raw);
  } catch {}
}, 3000);

load();
