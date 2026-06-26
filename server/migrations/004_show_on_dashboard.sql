ALTER TABLE container_groups ADD COLUMN show_on_dashboard INTEGER DEFAULT 1;
UPDATE container_groups SET show_on_dashboard = 1 WHERE show_on_dashboard IS NULL;
