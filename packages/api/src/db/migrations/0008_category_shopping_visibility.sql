-- 0008_category_shopping_visibility.sql
-- Which ingredient categories are hidden from the shopping list by default (spices, pantry staples, ...)
-- is now data instead of a hard-coded list, so it can be changed in Settings.
ALTER TABLE ingredient_categories ADD COLUMN hidden_from_shopping INTEGER NOT NULL DEFAULT 0;
UPDATE ingredient_categories SET hidden_from_shopping = 1
WHERE name IN ('Spices & Herbs', 'Condiments & Sauces', 'Pantry & Dry Goods', 'Canned & Jarred', 'Beverages', 'Frozen', 'Other');
