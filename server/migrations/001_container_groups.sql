-- 容器分组表
CREATE TABLE IF NOT EXISTS container_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_builtin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 容器→分组映射表
-- container_key: compose 项目名 或 容器名
CREATE TABLE IF NOT EXISTS container_group_mapping (
  container_key TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES container_groups(id) ON DELETE CASCADE
);

-- 预置"独立容器"分组（内建，不可删除/重命名）
INSERT OR IGNORE INTO container_groups (id, name, sort_order, is_builtin)
VALUES ('_independent', '独立容器', 9999, 1);
