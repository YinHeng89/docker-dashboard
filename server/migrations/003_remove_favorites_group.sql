-- 收藏改为 preferences 存储，从 container_groups 表中移除
DELETE FROM container_group_mapping WHERE group_id = '_favorites';
DELETE FROM container_groups WHERE id = '_favorites';
