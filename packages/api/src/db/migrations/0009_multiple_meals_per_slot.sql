-- 0009_multiple_meals_per_slot.sql
-- A slot can now hold several dishes, so the UNIQUE(plan_date, meal_slot) constraint goes.
-- SQLite can't drop a table constraint in place, so the table is rebuilt.
CREATE TABLE meal_plans_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  meal_slot TEXT NOT NULL CHECK(meal_slot IN ('breakfast','lunch','dinner','snack')),
  meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  servings INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  assigned_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  leftovers_required INTEGER NOT NULL DEFAULT 0,
  prep_time_limit_minutes INTEGER
);
INSERT INTO meal_plans_new (id, plan_date, meal_slot, meal_id, servings, notes, assigned_by_user_id, updated_at, leftovers_required, prep_time_limit_minutes)
  SELECT id, plan_date, meal_slot, meal_id, servings, notes, assigned_by_user_id, updated_at, leftovers_required, prep_time_limit_minutes FROM meal_plans;
DROP TABLE meal_plans;
ALTER TABLE meal_plans_new RENAME TO meal_plans;
CREATE INDEX IF NOT EXISTS idx_meal_plans_meal ON meal_plans(meal_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_slot ON meal_plans(plan_date, meal_slot);
