-- 0004_add_meal_preferences.sql
-- Meal preferred by family members (junction)
CREATE TABLE IF NOT EXISTS meal_preferred_by (
meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
family_member_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
PRIMARY KEY (meal_id, family_member_id)
)