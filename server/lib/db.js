// ==================== SQLite 数据库 ====================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrate');

const DB_DIR = process.env.DB_DIR || '/data';
const DB_PATH = path.join(DB_DIR, 'dashboard.db');

// 确保数据目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// 启用 WAL 模式（更好的并发性能）
db.pragma('journal_mode = WAL');

// ==================== 初始化表结构 ====================
db.exec(`
  -- 用户表（单用户模式，仅存密码）
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户偏好设置
  CREATE TABLE IF NOT EXISTS preferences (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'light',
    cmd_history TEXT DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- 项目注册表（快照信息，单用户共享）
  CREATE TABLE IF NOT EXISTS registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT UNIQUE NOT NULL,
    project_name TEXT NOT NULL,
    working_dir TEXT,
    config_files TEXT,
    status TEXT DEFAULT 'active',
    snapshot TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Compose 模板
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ==================== 执行数据库迁移 ====================
runMigrations(db, path.join(__dirname, '..', 'migrations'));

// ==================== 查询助手 ====================

/**
 * 查询单行
 */
function queryOne(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/**
 * 查询多行
 */
function queryAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/**
 * 执行写操作（INSERT/UPDATE/DELETE）
 */
function execute(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/**
 * 事务执行
 */
function transaction(fn) {
  return db.transaction(fn);
}

module.exports = {
  db,
  queryOne,
  queryAll,
  execute,
  transaction,
};
