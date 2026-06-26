// ==================== Registry API（项目注册表） ====================
const express = require('express');
const { queryOne, queryAll, execute } = require('../lib/db');

const router = express.Router();

// GET /api/registry — 获取所有项目
router.get('/', (req, res) => {
  const rows = queryAll('SELECT * FROM registry ORDER BY last_seen DESC');
  const projects = {};
  for (const row of rows) {
    projects[row.project_key] = {
      name: row.project_name,
      key: row.project_key,
      workingDir: row.working_dir,
      configFiles: row.config_files,
      status: row.status,
      firstSeen: row.first_seen ? new Date(row.first_seen).getTime() : null,
      lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
      snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
    };
  }
  res.json(projects);
});

// POST /api/registry — 批量同步（前端推送）
router.post('/', (req, res) => {
  const { projects } = req.body;
  if (!projects || typeof projects !== 'object') {
    return res.status(400).json({ error: '无效的 projects 数据' });
  }

  const now = new Date().toISOString();

  for (const [key, entry] of Object.entries(projects)) {
    const existing = queryOne('SELECT id FROM registry WHERE project_key = ?', [key]);

    if (existing) {
      // 更新现有记录
      execute(
        `UPDATE registry SET
          project_name = ?, working_dir = ?, config_files = ?,
          status = ?, snapshot = ?, last_seen = ?, updated_at = ?
        WHERE project_key = ?`,
        [
          entry.name || key,
          entry.workingDir || null,
          entry.configFiles || null,
          entry.status || 'active',
          entry.snapshot ? JSON.stringify(entry.snapshot) : null,
          entry.lastSeen ? new Date(entry.lastSeen).toISOString() : now,
          now,
          key,
        ]
      );
    } else {
      // 插入新记录
      execute(
        `INSERT INTO registry (project_key, project_name, working_dir, config_files, status, snapshot, first_seen, last_seen, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          key,
          entry.name || key,
          entry.workingDir || null,
          entry.configFiles || null,
          entry.status || 'active',
          entry.snapshot ? JSON.stringify(entry.snapshot) : null,
          entry.firstSeen ? new Date(entry.firstSeen).toISOString() : now,
          entry.lastSeen ? new Date(entry.lastSeen).toISOString() : now,
          now,
        ]
      );
    }
  }

  res.json({ success: true, count: Object.keys(projects).length });
});

// PUT /api/registry/:key — 更新单个项目
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const entry = req.body;
  const now = new Date().toISOString();

  const existing = queryOne('SELECT id FROM registry WHERE project_key = ?', [key]);

  if (existing) {
    execute(
      `UPDATE registry SET
        project_name = ?, working_dir = ?, config_files = ?,
        status = ?, snapshot = ?, last_seen = ?, updated_at = ?
      WHERE project_key = ?`,
      [
        entry.name || key,
        entry.workingDir || null,
        entry.configFiles || null,
        entry.status || 'active',
        entry.snapshot ? JSON.stringify(entry.snapshot) : null,
        entry.lastSeen ? new Date(entry.lastSeen).toISOString() : now,
        now,
        key,
      ]
    );
  } else {
    execute(
      `INSERT INTO registry (project_key, project_name, working_dir, config_files, status, snapshot, first_seen, last_seen, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        entry.name || key,
        entry.workingDir || null,
        entry.configFiles || null,
        entry.status || 'active',
        entry.snapshot ? JSON.stringify(entry.snapshot) : null,
        entry.firstSeen ? new Date(entry.firstSeen).toISOString() : now,
        entry.lastSeen ? new Date(entry.lastSeen).toISOString() : now,
        now,
      ]
    );
  }

  res.json({ success: true });
});

// DELETE /api/registry/:key — 删除项目
router.delete('/:key', (req, res) => {
  const { key } = req.params;
  execute('DELETE FROM registry WHERE project_key = ?', [key]);
  res.json({ success: true });
});

module.exports = router;
