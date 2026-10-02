CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT UNIQUE,
  telegram_id TEXT UNIQUE,
  x_handle TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint_address TEXT UNIQUE NOT NULL,
  ticker TEXT,
  name TEXT,
  logo_url TEXT,
  x_url TEXT,
  tiktok_url TEXT,
  telegram_url TEXT,
  pump_url TEXT,
  dex_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  package TEXT NOT NULL,
  amount_lamports INTEGER NOT NULL,
  duration_hours INTEGER NOT NULL,
  x_url TEXT,
  tiktok_url TEXT,
  telegram_url TEXT,
  raid_copy TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_signature TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(token_id) REFERENCES tokens(id)
);

CREATE TABLE IF NOT EXISTS raid_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  external_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  signature TEXT UNIQUE NOT NULL,
  wallet_address TEXT,
  lamports INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
);

CREATE TABLE IF NOT EXISTS featured_tokens (
  token_id INTEGER PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  FOREIGN KEY(token_id) REFERENCES tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_ends ON campaigns(ends_at);
CREATE INDEX IF NOT EXISTS idx_actions_campaign ON raid_actions(campaign_id);
