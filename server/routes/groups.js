// ==================== 分组管理 API ====================
// ⚠️ 重要：具体的 /mappings、/preferences 路径必须在 /:id 参数路由之前定义
const express = require('express');
const { queryOne, queryAll, execute, db } = require('../lib/db');

const router = express.Router();

// ==================== 分组 CRUD ====================

// GET /api/groups — 获取所有分组 + 映射
router.get('/', (req, res) => {
  const groups = queryAll('SELECT * FROM container_groups ORDER BY sort_order ASC, name ASC');
  const mappings = queryAll('SELECT * FROM container_group_mapping');

  const map = {};
  for (const m of mappings) {
    map[m.container_key] = m.group_id;
  }

  res.json({
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sort_order,
      isBuiltin: !!g.is_builtin,
      showOnDashboard: g.show_on_dashboard !== 0,
    })),
    mappings: map,
  });
});

// POST /api/groups — 创建分组
router.post('/', (req, res) => {
  const { id, name, sortOrder } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'id 和 name 是必填项' });
  }

  // 不允许使用 _independent 内置 ID
  if (id === '_independent') {
    return res.status(400).json({ error: '不允许使用系统保留 ID' });
  }

  const existing = queryOne('SELECT id FROM container_groups WHERE id = ?', [id]);
  if (existing) {
    return res.status(409).json({ error: '分组 ID 已存在' });
  }

  execute(
    'INSERT INTO container_groups (id, name, sort_order) VALUES (?, ?, ?)',
    [id, name, sortOrder ?? 0]
  );

  res.json({ success: true, id, name, sortOrder: sortOrder ?? 0 });
});

// ==================== 映射管理（必须在 /:id 之前） ====================

// GET /api/groups/mappings — 获取所有映射
router.get('/mappings', (req, res) => {
  const mappings = queryAll('SELECT * FROM container_group_mapping');
  const map = {};
  for (const m of mappings) {
    map[m.container_key] = m.group_id;
  }
  res.json(map);
});

// PUT /api/groups/mappings — 批量设置映射
router.put('/mappings', (req, res) => {
  const { assign, remove } = req.body;

  db.transaction(() => {
    if (assign && typeof assign === 'object') {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO container_group_mapping (container_key, group_id) VALUES (?, ?)'
      );
      for (const [containerKey, groupId] of Object.entries(assign)) {
        const group = queryOne('SELECT id FROM container_groups WHERE id = ?', [groupId]);
        if (!group) continue;
        stmt.run(containerKey, groupId);
      }
    }

    if (remove && Array.isArray(remove)) {
      const stmt = db.prepare('DELETE FROM container_group_mapping WHERE container_key = ?');
      for (const key of remove) {
        stmt.run(key);
      }
    }
  })();

  res.json({ success: true });
});

// DELETE /api/groups/mappings/unassign — 取消分配
router.delete('/mappings/unassign', (req, res) => {
  const { containerKey } = req.body;
  if (!containerKey) {
    return res.status(400).json({ error: 'containerKey 是必填项' });
  }

  execute('DELETE FROM container_group_mapping WHERE container_key = ?', [containerKey]);
  res.json({ success: true });
});

// ==================== 折叠状态偏好（必须在 /:id 之前） ====================

// GET /api/groups/preferences/collapsed — 获取分组折叠状态
router.get('/preferences/collapsed', (req, res) => {
  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      const collapsed = parsed._collapsedGroups || {};
      return res.json(collapsed);
    }
  } catch { /* ignore */ }
  res.json({});
});

// PUT /api/groups/preferences/collapsed — 保存分组折叠状态
router.put('/preferences/collapsed', (req, res) => {
  const { collapsed } = req.body;
  if (!collapsed || typeof collapsed !== 'object') {
    return res.status(400).json({ error: 'collapsed 参数无效' });
  }

  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  let history = {};
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      // 兼容旧数据：cmd_history 默认是数组 '[]'，数组上设属性无法序列化
      history = Array.isArray(parsed) ? { _legacy_cmds: parsed } : parsed;
    }
  } catch { /* ignore */ }

  history._collapsedGroups = collapsed;

  const existing = queryOne('SELECT user_id FROM preferences WHERE user_id = ?', [req.user.id]);
  if (existing) {
    execute('UPDATE preferences SET cmd_history = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [
      JSON.stringify(history), req.user.id,
    ]);
  } else {
    execute('INSERT INTO preferences (user_id, cmd_history) VALUES (?, ?)', [
      req.user.id, JSON.stringify(history),
    ]);
  }

  res.json({ success: true });
});

// ==================== 收藏（preferences JSON 数组） ====================

// GET /api/groups/preferences/favorites — 获取收藏列表
router.get('/preferences/favorites', (req, res) => {
  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      return res.json(parsed._favorites || []);
    }
  } catch { /* ignore */ }
  res.json([]);
});

// PUT /api/groups/preferences/favorites — 保存收藏列表
router.put('/preferences/favorites', (req, res) => {
  const { favorites } = req.body;
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ error: 'favorites 必须是数组' });
  }

  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  let history = {};
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      // 兼容旧数据：cmd_history 默认是数组 '[]'，数组上设属性无法序列化
      history = Array.isArray(parsed) ? { _legacy_cmds: parsed } : parsed;
    }
  } catch { /* ignore */ }

  history._favorites = favorites;

  const existing = queryOne('SELECT user_id FROM preferences WHERE user_id = ?', [req.user.id]);
  if (existing) {
    execute('UPDATE preferences SET cmd_history = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [
      JSON.stringify(history), req.user.id,
    ]);
  } else {
    execute('INSERT INTO preferences (user_id, cmd_history) VALUES (?, ?)', [
      req.user.id, JSON.stringify(history),
    ]);
  }

  res.json({ success: true });
});

// ==================== 未分组展示开关 ====================

router.get('/preferences/show-ungrouped', (req, res) => {
  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      return res.json({ show: parsed._showUngrouped !== false });
    }
  } catch { /* ignore */ }
  res.json({ show: true });
});

router.put('/preferences/show-ungrouped', (req, res) => {
  const { show } = req.body;
  const prefs = queryOne('SELECT cmd_history FROM preferences WHERE user_id = ?', [req.user.id]);
  let history = {};
  try {
    if (prefs && prefs.cmd_history) {
      const parsed = JSON.parse(prefs.cmd_history);
      history = Array.isArray(parsed) ? { _legacy_cmds: parsed } : parsed;
    }
  } catch { /* ignore */ }
  history._showUngrouped = !!show;
  const existing = queryOne('SELECT user_id FROM preferences WHERE user_id = ?', [req.user.id]);
  if (existing) {
    execute('UPDATE preferences SET cmd_history = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [JSON.stringify(history), req.user.id]);
  } else {
    execute('INSERT INTO preferences (user_id, cmd_history) VALUES (?, ?)', [req.user.id, JSON.stringify(history)]);
  }
  res.json({ success: true });
});

// ==================== 单个分组操作（/:id 必须在所有具体路径之后） ====================

// PUT /api/groups/:id — 更新分组（重命名/排序）
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, sortOrder, showOnDashboard } = req.body;

  const group = queryOne('SELECT * FROM container_groups WHERE id = ?', [id]);
  if (!group) {
    return res.status(404).json({ error: '分组不存在' });
  }

  if (name !== undefined && group.is_builtin) {
    return res.status(403).json({ error: '内置分组不允许重命名' });
  }

  const updates = [];
  const params = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }
  if (sortOrder !== undefined) {
    updates.push('sort_order = ?');
    params.push(sortOrder);
  }
  if (showOnDashboard !== undefined) {
    updates.push('show_on_dashboard = ?');
    params.push(showOnDashboard ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: '没有要更新的字段' });
  }

  params.push(id);
  execute(`UPDATE container_groups SET ${updates.join(', ')} WHERE id = ?`, params);

  res.json({ success: true });
});

// DELETE /api/groups/:id — 删除分组
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  if (id === '_independent') {
    return res.status(403).json({ error: '内置分组不允许删除' });
  }

  const group = queryOne('SELECT * FROM container_groups WHERE id = ?', [id]);
  if (!group) {
    return res.status(404).json({ error: '分组不存在' });
  }

  db.transaction(() => {
    execute('DELETE FROM container_group_mapping WHERE group_id = ?', [id]);
    execute('DELETE FROM container_groups WHERE id = ?', [id]);
  })();

  res.json({ success: true });
});

module.exports = router;
