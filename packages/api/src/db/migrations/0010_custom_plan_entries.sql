-- 0010_custom_plan_entries.sql
-- A planned slot entry can now be a free-text dish (no recipe): meal_id stays NULL and custom_name holds the label.
ALTER TABLE meal_plans ADD COLUMN custom_name TEXT;
