-- A planned dish can record how many portions were left over, and a later entry can be those leftovers.
-- leftover_from_id has no foreign key on purpose: an entry that is leftovers stays leftovers (and off the
-- shopping list) even if the original dish is later removed from the plan.
ALTER TABLE meal_plans ADD COLUMN leftover_portions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meal_plans ADD COLUMN leftover_from_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_meal_plans_leftover_from ON meal_plans(leftover_from_id);
