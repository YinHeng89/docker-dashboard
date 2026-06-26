// ==================== Compose 模板管理路由 ====================
const express = require('express');
const { queryOne, queryAll, execute } = require('../lib/db');

const router = express.Router();

// 默认模板数据
const DEFAULT_TEMPLATES = [
  {
    name: '空白模板',
    description: '最简单的单服务模板，适合快速入门',
    content: `services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
`,
  },
  {
    name: 'Nginx + PHP',
    description: 'Nginx 反向代理 + PHP-FPM',
    content: `services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./html:/usr/share/nginx/html
    depends_on:
      - php
    restart: unless-stopped

  php:
    image: php:8.2-fpm-alpine
    volumes:
      - ./html:/var/www/html
    restart: unless-stopped
`,
  },
  {
    name: 'MySQL',
    description: 'MySQL 8.0 数据库服务',
    content: `services:
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root_password
      MYSQL_DATABASE: mydb
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql_data:
`,
  },
  {
    name: 'PostgreSQL',
    description: 'PostgreSQL 16 数据库服务',
    content: `services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
      POSTGRES_DB: mydb
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  pg_data:
`,
  },
  {
    name: 'Redis',
    description: 'Redis 7 缓存服务',
    content: `services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

volumes:
  redis_data:
`,
  },
  {
    name: 'WordPress',
    description: 'WordPress + MySQL 完整站点',
    content: `services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wp_data:/var/www/html
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
      MYSQL_ROOT_PASSWORD: root_password
    volumes:
      - db_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  wp_data:
  db_data:
`,
  },
];

// 首次启动时插入默认模板
// 启动时同步默认模板（新模板插入，已有模板更新）
function seedDefaultTemplates() {
  const count = queryOne('SELECT COUNT(*) as c FROM templates');
  const now = new Date().toISOString();
  for (const t of DEFAULT_TEMPLATES) {
    const existing = queryOne('SELECT id, content FROM templates WHERE name = ?', [t.name]);
    if (existing) {
      // 已有模板 → 更新内容和描述（保留用户可能修改的其他字段）
      execute(
        'UPDATE templates SET description = ?, content = ?, updated_at = ? WHERE name = ?',
        [t.description, t.content, now, t.name]
      );
    } else {
      execute(
        'INSERT INTO templates (name, description, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [t.name, t.description, t.content, now, now]
      );
    }
  }
  if (count && count.c === 0) {
    console.log('[Templates] 已插入默认模板');
  }
}
seedDefaultTemplates();

// GET /api/templates — 列出所有模板
router.get('/', (req, res) => {
  const rows = queryAll('SELECT id, name, description, content, created_at, updated_at FROM templates ORDER BY id');
  res.json(rows);
});

// GET /api/templates/:id — 获取单个模板（含完整内容）
router.get('/:id', (req, res) => {
  const row = queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '模板不存在' });
  res.json(row);
});

// POST /api/templates — 创建模板
router.post('/', (req, res) => {
  const { name, description = '', content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'name 和 content 为必填项' });
  }

  const existing = queryOne('SELECT id FROM templates WHERE name = ?', [name]);
  if (existing) {
    return res.status(409).json({ error: `模板 "${name}" 已存在` });
  }

  const now = new Date().toISOString();
  const result = execute(
    'INSERT INTO templates (name, description, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [name, description, content, now, now]
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/templates/:id — 更新模板
router.put('/:id', (req, res) => {
  const { name, description, content } = req.body;
  const row = queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '模板不存在' });

  const now = new Date().toISOString();
  execute(
    'UPDATE templates SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?',
    [name || row.name, description !== undefined ? description : row.description, content || row.content, now, req.params.id]
  );
  res.json({ success: true });
});

// DELETE /api/templates/:id — 删除模板
router.delete('/:id', (req, res) => {
  const row = queryOne('SELECT id FROM templates WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '模板不存在' });

  execute('DELETE FROM templates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
