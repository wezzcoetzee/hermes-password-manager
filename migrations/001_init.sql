-- AgentVault broker schema. No credentials, cookies, addresses or payment details are stored here.

CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  token_hash  TEXT NOT NULL UNIQUE,          -- sha256 of the bearer token; the token itself is never stored
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE accounts (
  id                   TEXT PRIMARY KEY,     -- also the Keychain account key in the native helper
  site_id              TEXT NOT NULL,        -- references sites/<id>.json
  username             TEXT NOT NULL,
  label                TEXT NOT NULL,
  max_session_minutes  INTEGER NOT NULL DEFAULT 60,
  created_at           INTEGER NOT NULL
);

CREATE TABLE grants (
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  allow_transactions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, account_id)
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  site_id     TEXT NOT NULL,
  account_id  TEXT REFERENCES accounts(id),
  state       TEXT NOT NULL CHECK (state IN ('anonymous', 'authenticated', 'expired', 'revoked', 'terminated')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE transaction_approvals (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  summary_hash  TEXT NOT NULL,               -- binds the approval to the exact order the user saw
  merchant      TEXT NOT NULL,
  total         TEXT NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX transaction_approvals_session ON transaction_approvals (session_id, status);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  event       TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  agent_id    TEXT,
  session_id  TEXT,
  account_id  TEXT,
  detail      TEXT                            -- JSON, never contains secrets
);
CREATE INDEX audit_events_ts ON audit_events (ts);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
