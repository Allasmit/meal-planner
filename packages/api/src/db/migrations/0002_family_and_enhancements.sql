-- 0002_family_and_enhancements.sql
-- Add new columns to meals
ALTER TABLE meals ADD COLUMN cost REAL;
ALTER TABLE meals ADD COLUMN protein_type TEXT CHECK(protein_type IN ('chicken','red_meat','pork','fish','vegetarian','vegan','other'));
ALTER TABLE meals ADD COLUMN meal_category TEXT CHECK(meal_category IN ('dinner','breakfast','lunch','baking','treat','snack'));
ALTER TABLE meals ADD COLUMN leftover_behaviour TEXT NOT NULL DEFAULT 'consumed_same' CHECK(leftover_behaviour IN ('consumed_same','fridge_next_day','freezable'));
ALTER TABLE meals ADD COLUMN source_url TEXT;
ALTER TABLE meals ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meals ADD COLUMN is_special_occasion INTEGER NOT NULL DEFAULT 0;

-- Add new columns to meal_plans
ALTER TABLE meal_plans ADD COLUMN leftovers_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meal_plans ADD COLUMN prep_time_limit_minutes INTEGER;

-- Family members
CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Adult' CHECK(role IN ('Adult','Teen','Child')),
  notes TEXT
);

-- Family member dietary restrictions (junction)
CREATE TABLE IF NOT EXISTS family_member_dietary_types (
  family_member_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  dietary_type_id INTEGER NOT NULL REFERENCES dietary_types(id) ON DELETE CASCADE,
  PRIMARY KEY (family_member_id, dietary_type_id)
);

-- Meal suitable for family members (junction)
CREATE TABLE IF NOT EXISTS meal_suitable_for (
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  family_member_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  PRIMARY KEY (meal_id, family_member_id)
);

-- Weekly planner rules
CREATE TABLE IF NOT EXISTS weekly_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('max_protein_per_week','max_category_per_week','default_leftovers_days','batch_cooking_day')),
  value TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1
);

-- Default weekly rules
INSERT OR IGNORE INTO weekly_rules (label, rule_type, value, is_enabled) VALUES
  ('Red meat max 1× per week', 'max_protein_per_week', '{"protein":"red_meat","maxCount":1}', 1),
  ('Baking/bread max 3× per week', 'max_category_per_week', '{"category":"baking","maxCount":3}', 1),
  ('Default: leftovers required Sun–Thu', 'default_leftovers_days', '{"days":[0,1,2,3,4]}', 1),
  ('Sunday preferred batch cooking day', 'batch_cooking_day', '{"dayOfWeek":0}', 1);
