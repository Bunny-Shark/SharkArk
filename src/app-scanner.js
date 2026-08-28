// src/app-scanner.js — 扫描 Windows 开始菜单已安装软件（名称 + 图标 + 启动路径）
const fs = require("fs");
const path = require("path");
const { app, shell } = require("electron");

// 跳过卸载器等无意义快捷方式
const SKIP_KEYWORDS = ["卸载", "uninstall", "Uninstall", "帮助", "readme", "Readme", "自述"];
const MAX_APPS = 200;

function startMenuDirs() {
  const dirs = [];
  if (process.env.ProgramData) {
    dirs.push(path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"));
  }
  if (process.env.AppData) {
    dirs.push(path.join(process.env.AppData, "Microsoft", "Windows", "Start Menu", "Programs"));
  }
  return dirs.filter((d) => fs.existsSync(d));
}

function collectLnks(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectLnks(full, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".lnk")) out.push(full);
  }
}

function isSkippable(name) {
  return SKIP_KEYWORDS.some((k) => name.includes(k));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * 扫描开始菜单快捷方式，返回 [{ name, lnk, icon(dataURL) }]
 * 按解析出的目标 exe 去重；图标通过 app.getFileIcon 提取
 */
async function scanInstalledApps() {
  const lnks = [];
  for (const dir of startMenuDirs()) collectLnks(dir, lnks);

  const seen = new Set();
  const candidates = [];
  for (const lnk of lnks) {
    const name = path.basename(lnk, path.extname(lnk));
    if (isSkippable(name)) continue;

    let target;
    try {
      target = shell.readShortcutLink(lnk).target;
    } catch {
      continue; // 非法 .lnk
    }
    if (!target || !target.toLowerCase().endsWith(".exe")) continue;
    if (!fs.existsSync(target)) continue;

    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({ name, lnk, target });
  }

  const sliced = candidates.slice(0, MAX_APPS);
  await mapLimit(sliced, 16, async (item) => {
    try {
      const icon = await app.getFileIcon(item.target, { size: "large" }); // 48px 源，缩小显示不失真
      item.icon = icon.toDataURL();
    } catch {
      item.icon = "";
    }
  });

  return sliced.map(({ name, lnk, icon }) => ({ name, lnk, icon }));
}

module.exports = { scanInstalledApps };
