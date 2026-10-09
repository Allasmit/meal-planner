-- migrate:fk-off
-- 0005_allow_lamb_protein_type.sql
-- The protein_type CHECK constraint (added in 0002) did not allow 'lamb', which the API and UI offer.
-- SQLite cannot alter a CHECK constraint, so the meals table is rebuilt with the expanded list.
CREATE TABLE meals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  prep_time_minutes INTEGER NOT NULL DEFAULT 0,
  cook_time_minutes INTEGER NOT NULL DEFAULT 0,
  servings INTEGER NOT NULL DEFAULT 2,
  difficulty TEXT NOT NULL DEFAULT 'easy' CHECK(difficulty IN ('easy','medium','hard')),
  cuisine_id INTEGER REFERENCES cuisines(id),
  instructions TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  is_tested INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  cost REAL,
  protein_type TEXT CHECK(protein_type IN ('chicken','red_meat','pork','fish','lamb','vegetarian','vegan','other')),
  meal_category TEXT CHECK(meal_category IN ('dinner','breakfast','lunch','baking','treat','snack')),
  leftover_behaviour TEXT NOT NULL DEFAULT 'consumed_same' CHECK(leftover_behaviour IN ('consumed_same','fridge_next_day','freezable')),
  source_url TEXT,
  is_favourite INTEGER NOT NULL DEFAULT 0,
  is_special_occasion INTEGER NOT NULL DEFAULT 0
);

INSERT INTO meals_new (
  id, name, description, prep_time_minutes, cook_time_minutes, servings, difficulty, cuisine_id,
  instructions, image_url, is_tested, notes, created_by_user_id, updated_by_user_id, created_at, updated_at,
  cost, protein_type, meal_category, leftover_behaviour, source_url, is_favourite, is_special_occasion
)
SELECT
  id, name, description, prep_time_minutes, cook_time_minutes, servings, difficulty, cuisine_id,
  instructions, image_url, is_tested, notes, created_by_user_id, updated_by_user_id, created_at, updated_at,
  cost, protein_type, meal_category, leftover_behaviour, source_url, is_favourite, is_special_occasion
FROM meals;

-- Keep the AUTOINCREMENT counter so ids of deleted meals are never reused.
UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'meals'), 0))
WHERE name = 'meals_new';

DROP TABLE meals;
ALTER TABLE meals_new RENAME TO meals;
