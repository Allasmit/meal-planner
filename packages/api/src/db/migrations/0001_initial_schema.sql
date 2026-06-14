-- 0001_initial_schema.sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dietary types
CREATE TABLE IF NOT EXISTS dietary_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT
);

-- Cuisines
CREATE TABLE IF NOT EXISTS cuisines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Ingredient categories
CREATE TABLE IF NOT EXISTS ingredient_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Ingredients
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES ingredient_categories(id),
  default_unit TEXT
);

-- Meals
CREATE TABLE IF NOT EXISTS meals (
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Meal ↔ dietary types (junction)
CREATE TABLE IF NOT EXISTS meal_dietary_types (
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  dietary_type_id INTEGER NOT NULL REFERENCES dietary_types(id) ON DELETE CASCADE,
  PRIMARY KEY (meal_id, dietary_type_id)
);

-- Meal ingredients
CREATE TABLE IF NOT EXISTS meal_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  notes TEXT
);

-- Meal plans (one meal per slot per day)
CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  meal_slot TEXT NOT NULL CHECK(meal_slot IN ('breakfast','lunch','dinner','snack')),
  meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  servings INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  assigned_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_date, meal_slot)
);

-- Household settings (key/value)
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
