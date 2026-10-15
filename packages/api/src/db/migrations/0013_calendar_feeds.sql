-- Calendars (e.g. a Google Calendar's secret iCal address) whose events are shown on the planner.
-- The URL is a secret: the API never sends it back to the browser.
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT NOT NULL,
  show_details INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
