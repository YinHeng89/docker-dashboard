-- 注意：本文件由 migrate.js 的幂等守卫（检查列是否已存在）保证只执行一次。
-- 手工执行前请确认列不存在，否则 SQLite 会报 duplicate column。
ALTER TABLE container_groups ADD COLUMN show_on_dashboard INTEGER DEFAULT 1;
UPDATE container_groups SET show_on_dashboard = 1 WHERE show_on_dashboard IS NULL;
