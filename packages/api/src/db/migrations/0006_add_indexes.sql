-- 0006_add_indexes.sql
-- Foreign-key and lookup indexes. The junction tables' composite primary keys already cover
-- lookups by meal_id; these cover the reverse direction and the hot join/filter columns.
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_meal ON meal_ingredients(meal_id);
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_ingredient ON meal_ingredients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_meal ON meal_plans(meal_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category_id);
CREATE INDEX IF NOT EXISTS idx_meal_dietary_types_type ON meal_dietary_types(dietary_type_id);
CREATE INDEX IF NOT EXISTS idx_meal_suitable_for_member ON meal_suitable_for(family_member_id);
CREATE INDEX IF NOT EXISTS idx_meal_preferred_by_member ON meal_preferred_by(family_member_id);
CREATE INDEX IF NOT EXISTS idx_family_member_dietary_type ON family_member_dietary_types(dietary_type_id);
CREATE INDEX IF NOT EXISTS idx_meals_cuisine ON meals(cuisine_id);
