PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS delivery_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  extra_km_cents INTEGER NOT NULL DEFAULT 200 CHECK (extra_km_cents >= 0 AND extra_km_cents <= 100000)
);
INSERT OR IGNORE INTO delivery_settings(id) VALUES (1);
CREATE TABLE IF NOT EXISTS delivery_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL, location_at TEXT,
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0,1)),
  approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0,1)),
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1)),
  suspension_note TEXT NOT NULL DEFAULT '',
  online_establishment_id INTEGER UNIQUE
);
CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT REFERENCES users(id),
  reference TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('awaiting_customer','searching','accepted','in_transit','incident','delivered','cancelled','returned')),
  previous_status TEXT,
  detail TEXT NOT NULL,
  ready INTEGER NOT NULL CHECK(ready IN (0,1)),
  pickup_code TEXT NOT NULL,
  delivery_hash TEXT NOT NULL,
  delivery_salt TEXT NOT NULL,
  customer_token TEXT NOT NULL UNIQUE,
  customer_token_hash TEXT NOT NULL UNIQUE,
  customer_decision INTEGER CHECK(customer_decision IN (0,1)),
  pickup_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  hold INTEGER NOT NULL DEFAULT 0 CHECK(hold IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  picked_up_at TEXT,
  delivered_at TEXT,
  compensation_cents INTEGER CHECK(compensation_cents >= 0),
  compensation_at TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','online')),
  payment_reference TEXT,
  funded_driver_cents INTEGER,
  payment_mode TEXT NOT NULL DEFAULT 'manual' CHECK(payment_mode IN ('manual','provider_captured','pix_confirmed_manually')),
  UNIQUE(merchant_id,reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_active_order_per_driver ON delivery_orders(driver_id)
 WHERE driver_id IS NOT NULL AND status IN ('accepted','in_transit','incident');
CREATE INDEX IF NOT EXISTS delivery_orders_status ON delivery_orders(status);
CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES delivery_orders(id),
  actor_id TEXT REFERENCES users(id),
  actor_role TEXT NOT NULL,
  type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_events_order ON delivery_events(order_id,created_at);
CREATE TABLE IF NOT EXISTS delivery_incidents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES delivery_orders(id),
  driver_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS delivery_settlements (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id),
  week_start TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK(cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
  reference TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS delivery_settlement_orders (
  order_id TEXT PRIMARY KEY REFERENCES delivery_orders(id),
  settlement_id TEXT NOT NULL REFERENCES delivery_settlements(id)
);
