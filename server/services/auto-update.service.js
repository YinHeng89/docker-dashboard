// ==================== 自动更新检测服务 ====================
const { queryOne, queryAll, execute } = require('../lib/db');
const http = require('http');

let timer = null;
let running = false;
let preferences = { enabled: false, intervalHours: 6 };

// ===== 初始化表 =====
function initTable() {
  execute(`
    CREATE TABLE IF NOT EXISTS auto_update_results (
      container_id TEXT PRIMARY KEY,
      container_name TEXT,
      image_name TEXT,
      compose_project TEXT,
      has_update INTEGER DEFAULT 0,
      remote_digest TEXT,
      current_digest TEXT,
      checked_at TEXT
    )
  `);
}

// ===== 偏好存取 =====
function loadPreferences() {
  try {
    const row = queryOne('SELECT preferences FROM users LIMIT 1');
    if (row?.preferences) {
      const prefs = JSON.parse(row.preferences);
      if (prefs.autoUpdate) {
        preferences.enabled = !!prefs.autoUpdate.enabled;
        preferences.intervalHours = prefs.autoUpdate.intervalHours || 6;
      }
    }
  } catch { /* ignore */ }
  console.log(`[AutoUpdate] 偏好: enabled=${preferences.enabled}, interval=${preferences.intervalHours}h`);
}

function savePreferences() {
  try {
    const row = queryOne('SELECT preferences FROM users LIMIT 1');
    const current = row?.preferences ? JSON.parse(row.preferences) : {};
    current.autoUpdate = preferences;
    execute('UPDATE users SET preferences = ? WHERE id = (SELECT id FROM users LIMIT 1)', [
      JSON.stringify(current),
    ]);
  } catch { /* ignore */ }
}

// ===== 获取容器列表 =====
function fetchContainers() {
  return new Promise((resolve, reject) => {
    const req = http.get({
      socketPath: '/var/run/docker.sock',
      path: '/containers/json?all=true',
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });
  });
}

// ===== 检查单个容器更新 =====
async function checkSingleContainer(container) {
  const { checkContainerUpdate } = require('../routes/update');
  const result = await checkContainerUpdate(container.Id);
  if (result) {
    const composeProject = (container.Labels || {})['com.docker.compose.project'] || '';
    execute(
      `INSERT OR REPLACE INTO auto_update_results
       (container_id, container_name, image_name, compose_project, has_update, remote_digest, current_digest, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        container.Id,
        (container.Names || [])[0]?.replace(/^\//, '') || '',
        result.imageName || '',
        composeProject,
        result.hasUpdate ? 1 : 0,
        result.remoteDigest || null,
        result.currentDigest || null,
        new Date().toISOString(),
      ]
    );
    return result;
  }
  return null;
}

// ===== 执行全量检测 =====
async function runCheck() {
  if (running) { console.log('[AutoUpdate] 上次检测尚未完成，跳过'); return; }
  running = true;
  console.log(`[AutoUpdate] ⏳ 开始检测... ${new Date().toISOString()}`);

  try {
    const containers = await fetchContainers();
    const runningContainers = containers.filter(c => c.State === 'running');
    console.log(`[AutoUpdate] 发现 ${containers.length} 个容器，其中 ${runningContainers.length} 个运行中`);
    const toCheck = runningContainers.slice(0, 10);

    let updated = 0, upToDate = 0, errored = 0;
    for (const c of toCheck) {
      try {
        const result = await checkSingleContainer(c);
        const name = (c.Names || [])[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
        if (result) {
          if (result.hasUpdate) { updated++; console.log(`[AutoUpdate] ${name}: 🔴 可更新 (${result.imageName})`); }
          else { upToDate++; }
        }
      } catch (e) {
        errored++;
        console.log(`[AutoUpdate] 检测 ${c.Id.slice(0, 12)} 失败: ${e.message}`);
      }
    }

    console.log(`[AutoUpdate] ✅ 检测完成: ${updated} 可更新, ${upToDate} 已最新, ${errored} 失败`);
  } catch (e) {
    console.log(`[AutoUpdate] ❌ 检测失败: ${e.message}`);
  } finally {
    running = false;
  }
}

// ===== 启动/重启定时器 =====
function startTimer() {
  stopTimer();
  if (!preferences.enabled) {
    console.log('[AutoUpdate] 未启用，跳过定时检测');
    return;
  }
  const ms = preferences.intervalHours * 3600 * 1000;
  console.log(`[AutoUpdate] 定时检测已启动，间隔 ${preferences.intervalHours}h`);
  timer = setInterval(runCheck, ms);
  // 启动后 30 秒执行首次检测
  setTimeout(runCheck, 30000);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

// ===== 公开接口 =====
function init() {
  initTable();
  loadPreferences();
  startTimer();
}

function updateSettings(enabled, intervalHours) {
  preferences.enabled = !!enabled;
  preferences.intervalHours = Math.max(1, Math.min(24, intervalHours || 6));
  savePreferences();
  startTimer();
  if (!enabled) {
    // 清空旧结果
    execute('DELETE FROM auto_update_results');
  }
}

function getResults() {
  return queryAll(
    'SELECT * FROM auto_update_results ORDER BY has_update DESC, container_name ASC'
  );
}

function getSettings() {
  return { ...preferences };
}

module.exports = { init, updateSettings, getResults, getSettings, runCheck };
