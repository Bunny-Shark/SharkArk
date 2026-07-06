// src/renderer.js
const searchInput = document.getElementById('searchInput');
const contentArea = document.getElementById('contentArea');
const pluginGrid = document.getElementById('pluginGrid');
const pluginViewContainer = document.getElementById('pluginViewContainer');
const pluginView = document.getElementById('pluginView');
const pluginTitle = document.getElementById('pluginTitle');
const closePluginBtn = document.getElementById('closePluginBtn');
const statusCount = document.getElementById('statusCount');
const tabs = document.querySelectorAll('.tabs button');

// ---------- 状态 ----------
let allCommands = [];
let allPlugins = [];
let currentView = 'grid';
let loadedPlugin = null;

// ---------- 初始化 ----------
async function init() {
  try {
    allCommands = await window.shark.getCommands() || [];
    allPlugins = await window.shark.getPlugins() || [];
    
    renderCurrentView();
    updateStatus();
    
    console.log(`🦈 鲨鲨工具已启动，${allPlugins.length} 个插件，${allCommands.length} 个命令`);
  } catch (error) {
    console.error('初始化失败:', error);
    pluginGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">加载失败，请检查插件目录</div>
      </div>
    `;
  }
}

// ---------- 渲染 ----------
function renderCurrentView() {
  if (currentView === 'grid') {
    renderGrid(allPlugins);
  } else {
    renderList(allCommands);
  }
}

function renderGrid(plugins) {
  if (!plugins || plugins.length === 0) {
    pluginGrid.className = 'grid-view';
    pluginGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🧩</div>
        <div class="empty-text">暂无插件<br><span style="font-size:12px;color:#45475a;">在 plugins/ 目录下创建插件</span></div>
      </div>
    `;
    return;
  }

  pluginGrid.className = 'grid-view';
  pluginGrid.innerHTML = plugins.map(p => `
    <div class="card" data-name="${p.name}" onclick="loadPlugin('${p.name}')">
      <span class="card-icon">${p.icon || '🧩'}</span>
      <div class="card-name">${p.name}</div>
      ${p.description ? `<div class="card-desc">${p.description}</div>` : ''}
      <div class="card-version">v${p.version}</div>
    </div>
  `).join('');
}

function renderList(commands) {
  if (!commands || commands.length === 0) {
    pluginGrid.className = 'list-view';
    pluginGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌨️</div>
        <div class="empty-text">暂无可用命令</div>
      </div>
    `;
    return;
  }

  pluginGrid.className = 'list-view';
  pluginGrid.innerHTML = commands.map(c => `
    <div class="item" onclick="loadPlugin('${c.plugin}')">
      <span class="item-icon">${c.icon || '🧩'}</span>
      <span class="item-name">${c.cmd}</span>
      <span class="item-desc">${c.explain || ''}</span>
      <span class="item-shortcut">${c.plugin}</span>
    </div>
  `).join('');
}

function updateStatus() {
  const pluginCount = allPlugins.length;
  const cmdCount = allCommands.length;
  statusCount.textContent = `🦈 ${pluginCount} 个插件 · ${cmdCount} 个命令`;
}

// ---------- 加载插件 ----------
async function loadPlugin(pluginName) {
  try {
    const pluginPath = await window.shark.loadPlugin(pluginName);
    if (pluginPath) {
      loadedPlugin = pluginName;
      pluginTitle.textContent = `🧩 ${pluginName}`;
      pluginViewContainer.classList.add('active');
      
      // 加载插件
      pluginView.src = `file://${pluginPath}/index.html`;
      
      // 监听加载完成
      pluginView.addEventListener('dom-ready', () => {
        console.log(`🦈 插件 ${pluginName} 已加载`);
        // 通知插件已就绪
        pluginView.executeJavaScript(`
          if (window.sharkPlugin) {
            window.sharkPlugin.pluginReady('${pluginName}');
          }
        `);
      });
      
      // 隐藏列表，显示插件
      document.querySelector('.content-area').style.display = 'none';
      document.querySelector('.tabs').style.display = 'none';
    } else {
      console.warn(`插件未找到: ${pluginName}`);
    }
  } catch (error) {
    console.error('加载插件失败:', error);
  }
}

function closePlugin() {
  pluginViewContainer.classList.remove('active');
  pluginView.src = 'about:blank';
  loadedPlugin = null;
  document.querySelector('.content-area').style.display = 'block';
  document.querySelector('.tabs').style.display = 'flex';
  searchInput.focus();
}

closePluginBtn.addEventListener('click', closePlugin);

// ---------- 搜索 ----------
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    renderCurrentView();
    return;
  }
  
  // 检查是否匹配命令
  const matchedCmd = allCommands.find(c => c.cmd === query);
  if (matchedCmd) {
    loadPlugin(matchedCmd.plugin);
    searchInput.value = '';
    return;
  }
  
  // 搜索插件
  const filtered = allPlugins.filter(p => 
    p.name.toLowerCase().includes(query) ||
    (p.description && p.description.toLowerCase().includes(query))
  );
  
  if (currentView === 'grid') {
    renderGrid(filtered);
  } else {
    const filteredCmds = allCommands.filter(c => 
      c.cmd.includes(query) || 
      c.explain.includes(query)
    );
    renderList(filteredCmds);
  }
});

// ---------- 标签切换 ----------
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    searchInput.value = '';
    renderCurrentView();
    searchInput.focus();
  });
});

// ---------- 键盘快捷键 ----------
document.addEventListener('keydown', (e) => {
  // ESC 关闭插件视图
  if (e.key === 'Escape') {
    if (pluginViewContainer.classList.contains('active')) {
      closePlugin();
    } else {
      window.shark.closeWindow();
    }
    e.preventDefault();
  }
  
  // ⌘K / Ctrl+K 聚焦搜索
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  
  // 上下键切换
  if (!pluginViewContainer.classList.contains('active')) {
    const items = pluginGrid.querySelectorAll('.card, .item');
    if (items.length > 0) {
      let currentIndex = -1;
      items.forEach((el, i) => {
        if (el.classList.contains('active')) {
          currentIndex = i;
          el.classList.remove('active');
        }
      });
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (currentIndex + 1) % items.length;
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (currentIndex - 1 + items.length) % items.length;
        items[prev].classList.add('active');
        items[prev].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = pluginGrid.querySelector('.card.active, .item.active');
        if (active) {
          const name = active.dataset.name;
          if (name) loadPlugin(name);
        } else if (items.length > 0) {
          const name = items[0].dataset.name;
          if (name) loadPlugin(name);
        }
      }
    }
  }
});

// ---------- 点击外部关闭 ----------
document.addEventListener('click', (e) => {
  if (pluginViewContainer.classList.contains('active')) {
    if (!e.target.closest('#pluginViewContainer') && 
        !e.target.closest('.card') && 
        !e.target.closest('.item')) {
      closePlugin();
    }
  }
});

// ---------- 监听主进程消息 ----------
window.shark.on('shark:open-plugins', () => {
  closePlugin();
  searchInput.focus();
});

// ---------- 启动！ ----------
init();