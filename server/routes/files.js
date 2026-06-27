// ==================== 文件管理路由 ====================
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const multer = require('multer');
const { safePath, readFile, writeFile, exists, listDir, ensureDir, PROJECTS_DIR } = require('../lib/utils');

const router = express.Router();

// Multer 配置：内存存储，限制 10 个文件，每个最多 50MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
});

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
    const rel = path.relative(PROJECTS_DIR, dirPath) || '.';

    // 附带文件元信息（大小、修改时间）
    const enriched = await Promise.all(entries.map(async (e) => {
      const fullPath = path.join(dirPath, e.name);
      try {
        const s = fs.statSync(fullPath);
        return {
          name: e.name,
          isDir: e.isDir,
          isFile: e.isFile,
          size: s.size,
          mtime: s.mtime.toISOString(),
        };
      } catch {
        return e;
      }
    }));

    res.json({
      path: rel,
      entries: enriched.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      }),
    });
  } catch (e) {
    next(e);
  }
});

// GET /files/download/:path(*) — 下载文件（流式传输）
router.get('/download/:filePath(*)', async (req, res, next) => {
  try {
    const filePath = safePath(req.params.filePath);
    if (!await exists(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: '不能下载目录' });
    }
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (e) => {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});

// GET /files/search — 搜索文件内容
// 查询参数: ?path=projectName&query=searchTerm
router.get('/search', async (req, res, next) => {
  try {
    const { path: relPath = '', query = '' } = req.query;
    if (!query || query.trim().length < 2) {
      return res.json({ results: [] });
    }
    const dirPath = safePath(relPath);
    if (!await exists(dirPath)) {
      return res.status(404).json({ error: '目录不存在' });
    }

    // 使用 grep 递归搜索
    const results = [];
    await new Promise((resolve) => {
      const proc = spawn('grep', [
        '-r', '-n', '-I', '--color=never',
        query.trim(), dirPath,
      ], { timeout: 10000 });
      let stdout = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.on('close', (code) => {
        if (code <= 1 && stdout) {
          for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (match) {
              results.push({
                file: path.relative(dirPath, match[1]),
                line: parseInt(match[2], 10),
                content: match[3].slice(0, 200),
              });
            }
          }
        }
        resolve();
      });
      proc.on('error', () => resolve());
      setTimeout(() => { proc.kill(); resolve(); }, 10000);
    });
    res.json({ results: results.slice(0, 50) });
  } catch (e) {
    next(e);
  }
});

// GET /files/:filePath — 读取文件内容
router.get('/:filePath(*)', async (req, res, next) => {
  try {
    // 跳过已匹配的特定路由
    if (req.params.filePath === 'download' || req.params.filePath === 'search') return next();

    const filePath = safePath(req.params.filePath);

    if (!await exists(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
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

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      await fsp.rm(filePath, { recursive: true, force: true });
    } else {
      await fsp.unlink(filePath);
    }

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ==================== 新增 API（需在通配路由前注册） ====================

// POST /files/upload — 多文件上传（使用 multer）
// 查询参数: ?path=subdir (目标目录)
router.post('/upload', upload.array('files', 10), async (req, res, next) => {
  try {
    const targetPath = req.query.path || '';
    const dirPath = safePath(targetPath);
    await ensureDir(dirPath);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const results = [];
    for (const file of req.files) {
      const filename = file.originalname;
      const destPath = path.join(dirPath, filename);

      // 安全校验
      try {
        safePath(path.join(targetPath, filename));
      } catch {
        continue;
      }

      await fsp.writeFile(destPath, file.buffer);
      results.push({ name: filename, size: file.size });
    }

    res.json({ success: true, files: results });
  } catch (e) {
    next(e);
  }
});

// POST /files/mkdir — 新建文件夹
// body: { path: string }
router.post('/mkdir', async (req, res, next) => {
  try {
    const dirPath = safePath(req.body.path);
    if (await exists(dirPath)) {
      return res.status(409).json({ error: '目录已存在' });
    }
    await ensureDir(dirPath);
    res.json({ success: true, path: req.body.path });
  } catch (e) {
    next(e);
  }
});

// POST /files/rename — 重命名文件/文件夹
// body: { oldPath: string, newPath: string }
router.post('/rename', async (req, res, next) => {
  try {
    const { oldPath: oldRel, newPath: newRel } = req.body;
    if (!oldRel || !newRel) {
      return res.status(400).json({ error: '缺少 oldPath 或 newPath 参数' });
    }
    const oldFull = safePath(oldRel);
    const newFull = safePath(newRel);

    if (!await exists(oldFull)) {
      return res.status(404).json({ error: '源文件不存在' });
    }
    if (await exists(newFull)) {
      return res.status(409).json({ error: '目标文件已存在' });
    }

    await ensureDir(path.dirname(newFull));
    await fsp.rename(oldFull, newFull);
    res.json({ success: true, oldPath: oldRel, newPath: newRel });
  } catch (e) {
    next(e);
  }
});

// POST /files/copy — 复制文件/文件夹
// body: { source: string, dest: string }
router.post('/copy', async (req, res, next) => {
  try {
    const { source, dest } = req.body;
    if (!source || !dest) {
      return res.status(400).json({ error: '缺少 source 或 dest 参数' });
    }
    const srcFull = safePath(source);
    const destFull = safePath(dest);

    if (!await exists(srcFull)) {
      return res.status(404).json({ error: '源文件不存在' });
    }
    if (await exists(destFull)) {
      return res.status(409).json({ error: '目标已存在' });
    }

    await ensureDir(path.dirname(destFull));
    await fsp.cp(srcFull, destFull, { recursive: true });
    res.json({ success: true, source, dest });
  } catch (e) {
    next(e);
  }
});

// POST /files/move — 移动文件/文件夹
// body: { source: string, dest: string }
router.post('/move', async (req, res, next) => {
  try {
    const { source, dest } = req.body;
    if (!source || !dest) {
      return res.status(400).json({ error: '缺少 source 或 dest 参数' });
    }
    const srcFull = safePath(source);
    const destFull = safePath(dest);

    if (!await exists(srcFull)) {
      return res.status(404).json({ error: '源文件不存在' });
    }
    if (await exists(destFull)) {
      return res.status(409).json({ error: '目标已存在' });
    }

    await ensureDir(path.dirname(destFull));
    await fsp.rename(srcFull, destFull);
    res.json({ success: true, source, dest });
  } catch (e) {
    next(e);
  }
});

// POST /files/batch-delete — 批量删除
// body: { paths: string[] }
router.post('/batch-delete', async (req, res, next) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: '缺少 paths 参数' });
    }

    const results = [];
    for (const p of paths) {
      try {
        const fullPath = safePath(p);
        if (!await exists(fullPath)) {
          results.push({ path: p, success: false, error: '不存在' });
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          await fsp.rm(fullPath, { recursive: true, force: true });
        } else {
          await fsp.unlink(fullPath);
        }
        results.push({ path: p, success: true });
      } catch (e) {
        results.push({ path: p, success: false, error: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
