// ==================== 数据库迁移模块 ====================
const path = require('path');
const fs = require('fs');

/**
 * 运行数据库迁移（仅向前，不回退）
 * @param {import('better-sqlite3').Database} db SQLite 数据库实例
 * @param {string} migrationsDir 迁移文件目录
 */
function runMigrations(db, migrationsDir) {
  // 确保 schema_migrations 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 确保迁移目录存在
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    return;
  }

  // 读取已应用的迁移版本
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map(row => row.version)
  );

  // 读取所有 .sql 迁移文件，按文件名排序
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');

    // 跳过已应用的迁移
    if (applied.has(version)) continue;

    // 检查迁移是否需要执行（idempotent guard）
    if (!shouldApplyMigration(db, version)) {
      console.log(`[DB] 跳过迁移（已不需要）: ${file}`);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8').trim();
    if (!sql) continue;

    try {
      console.log(`[DB] 执行迁移: ${file}`);

      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
      })();

      console.log(`[DB] 迁移完成: ${file}`);
      appliedCount++;
    } catch (e) {
      console.error(`[DB] 迁移失败 ${file}:`, e.message);
      throw e;
    }
  }

  if (appliedCount > 0) {
    console.log(`[DB] 共执行 ${appliedCount} 个迁移`);
  }
}

/**
 * 检查迁移是否还需要执行（idempotent）
 * 返回 false 表示目标结构已存在，可以安全跳过
 */
function shouldApplyMigration(db, version) {
  try {
    const checks = {
      '001_container_groups': () => {
        try {
          db.prepare('SELECT 1 FROM container_groups LIMIT 1').all();
          return false; // 表已存在，跳过
        } catch { return true; }
      },
      '002_remove_username': () => {
        const cols = db.prepare("PRAGMA table_info(users)").all();
        return cols.some(c => c.name === 'username');
      },
      '003_remove_favorites_group': () => {
        try {
          const row = db.prepare('SELECT id FROM container_groups WHERE id = ?').get('_favorites');
          return !!row;
        } catch { return false; }
      },
      '004_show_on_dashboard': () => {
        try {
          const cols = db.prepare("PRAGMA table_info(container_groups)").all();
          return !cols.some(c => c.name === 'show_on_dashboard');
        } catch { return false; }
      },
      '003_remove_registry_user_id': () => {
        const cols = db.prepare("PRAGMA table_info(registry)").all();
        return cols.some(c => c.name === 'user_id');
      },
    };

    if (checks[version]) {
      return checks[version]();
    }

    // 未知迁移：默认执行
    return true;
  } catch (e) {
    // 表不存在等情况，跳过
    return false;
  }
}

module.exports = { runMigrations };
