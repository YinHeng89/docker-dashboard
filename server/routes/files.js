// ==================== 文件管理路由 ====================
const express = require('express');
const path = require('path');
const { safePath, readFile, writeFile, exists, listDir, ensureDir, PROJECTS_DIR } = require('../lib/utils');

const router = express.Router();

// GET /files — 列出项目目录
// 查询参数: ?path=subdir (可选，默认为根目录)
router.get('/', async (req, res, next) => {
  try {
    const relPath = req.query.path || '';
    const dirPath = safePath(relPath);

    if (!await exists(dirPath)) {
      return res.status(404).json({ error: '目录不存在' });
    }

    const entries = await listDir(dirPath);

    // 计算相对路径
    const rel = path.relative(PROJECTS_DIR, dirPath) || '.';

    res.json({
      path: rel,
      entries: entries.sort((a, b) => {
        // 目录在前，文件在后
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      }),
    });
  } catch (e) {
    next(e);
  }
});

// GET /files/:filePath — 读取文件内容
router.get('/:filePath(*)', async (req, res, next) => {
  try {
    const filePath = safePath(req.params.filePath);

    if (!await exists(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    const stat = require('fs').statSync(filePath);
    if (stat.isDirectory()) {
      // 如果是目录，列出内容
      const entries = await listDir(filePath);
      return res.json({
        type: 'directory',
        path: req.params.filePath,
        entries,
      });
    }

    const content = await readFile(filePath);
    res.json({
      type: 'file',
      path: req.params.filePath,
      content,
      size: stat.size,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /files/:filePath — 写入/创建文件
router.put('/:filePath(*)', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: '缺少 content 参数' });
    }

    const filePath = safePath(req.params.filePath);

    // 确保父目录存在
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, content);

    res.json({ success: true, path: req.params.filePath });
  } catch (e) {
    next(e);
  }
});

// DELETE /files/:filePath — 删除文件
router.delete('/:filePath(*)', async (req, res, next) => {
  try {
    const filePath = safePath(req.params.filePath);

    if (!await exists(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    const stat = require('fs').statSync(filePath);
    const fs = require('fs').promises;

    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
    }

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
