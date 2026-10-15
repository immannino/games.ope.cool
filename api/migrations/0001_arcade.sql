-- Arcade tables. Better Auth's own tables (user, session, account, verification) are created by
-- scripts/migrate.mjs from the auth config; these sit alongside them.

-- a player's public identity: a unique handle for boards and share links, plus arcade initials
CREATE TABLE IF NOT EXISTS profile (
  user_id     TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  handle      TEXT NOT NULL,
  handle_key  TEXT NOT NULL UNIQUE,   -- lowercased handle, so "Tony" and "tony" can't both exist
  initials    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- every verified run. Boards take each player's best run for the period.
CREATE TABLE IF NOT EXISTS run (
  id           TEXT PRIMARY KEY,       -- short id used in share links
  game         TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  meters       INTEGER NOT NULL,
  frames       INTEGER NOT NULL,
  death        TEXT NOT NULL,
  week         INTEGER NOT NULL,       -- the weekly course the run was played on
  day          TEXT NOT NULL,          -- UTC date it was posted, YYYY-MM-DD
  sim_version  INTEGER NOT NULL,
  replay       TEXT NOT NULL,
  replay_hash  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (game, user_id, replay_hash)  -- re-sending the same run doesn't post it twice
);
CREATE INDEX IF NOT EXISTS run_by_week ON run (game, week, user_id, score DESC);
CREATE INDEX IF NOT EXISTS run_by_day  ON run (game, day, user_id, score DESC);
CREATE INDEX IF NOT EXISTS run_by_user ON run (game, user_id, score DESC);
CREATE INDEX IF NOT EXISTS run_recent  ON run (game, user_id, created_at DESC);
