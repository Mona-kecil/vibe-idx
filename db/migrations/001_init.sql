CREATE TABLE IF NOT EXISTS raw_files (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sha256 TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  source_url TEXT,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idx_announcements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  announcement_id TEXT NOT NULL UNIQUE,
  no_pengumuman TEXT,
  jmsx_group_id TEXT,
  title TEXT NOT NULL,
  ticker TEXT,
  published_at TEXT,
  keyword TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement_files (
  announcement_id TEXT NOT NULL REFERENCES idx_announcements(id),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  attachment_url TEXT NOT NULL,
  filename TEXT,
  PRIMARY KEY (announcement_id, raw_file_id)
);

CREATE TABLE IF NOT EXISTS parser_runs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  parser_name TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_prices (
  trade_date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  previous NUMERIC,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume INTEGER,
  value NUMERIC,
  frequency INTEGER,
  foreign_buy INTEGER,
  foreign_sell INTEGER,
  listed_shares INTEGER,
  tradeable_shares INTEGER,
  source TEXT NOT NULL DEFAULT 'IDX',
  raw_file_id TEXT REFERENCES raw_files(id),
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, ticker)
);

CREATE TABLE IF NOT EXISTS ksei_5pct_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  announcement_id TEXT NOT NULL REFERENCES idx_announcements(id),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  previous_date TEXT,
  as_of_date TEXT NOT NULL,
  source_date TEXT,
  revision_no INTEGER NOT NULL,
  is_latest_revision INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  parse_status TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  UNIQUE (previous_date, as_of_date, raw_file_id)
);

CREATE TABLE IF NOT EXISTS ksei_5pct_rows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  report_id TEXT NOT NULL REFERENCES ksei_5pct_reports(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  issuer_name TEXT,
  shareholder_name TEXT,
  account_name TEXT,
  investor_status TEXT,
  previous_shares INTEGER,
  previous_sid_total INTEGER,
  previous_percent NUMERIC,
  current_shares INTEGER,
  current_sid_total INTEGER,
  current_percent NUMERIC,
  reported_change INTEGER,
  actual_change INTEGER
);

CREATE TABLE IF NOT EXISTS ksei_1pct_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  announcement_id TEXT NOT NULL REFERENCES idx_announcements(id),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  as_of_date TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  is_latest_revision INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  parse_status TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  UNIQUE (as_of_date, raw_file_id)
);

CREATE TABLE IF NOT EXISTS ksei_1pct_rows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  report_id TEXT NOT NULL REFERENCES ksei_1pct_reports(id) ON DELETE CASCADE,
  as_of_date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  investor_name TEXT NOT NULL,
  investor_classification TEXT,
  local_foreign TEXT,
  nationality TEXT,
  domicile TEXT,
  holdings_scripless INTEGER,
  holdings_scrip INTEGER,
  total_holding_shares INTEGER,
  percentage NUMERIC
);

CREATE INDEX IF NOT EXISTS ksei_1pct_rows_ticker_date_idx ON ksei_1pct_rows (ticker, as_of_date);
CREATE INDEX IF NOT EXISTS ksei_5pct_rows_ticker_idx ON ksei_5pct_rows (ticker);

CREATE TABLE IF NOT EXISTS insider_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  announcement_id TEXT NOT NULL REFERENCES idx_announcements(id),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  ticker TEXT,
  issuer_name TEXT,
  reporter_name TEXT,
  sid_name TEXT,
  position TEXT,
  is_director_or_commissioner INTEGER,
  shares_before INTEGER,
  voting_percent_before NUMERIC,
  shares_after INTEGER,
  voting_percent_after NUMERIC,
  delta_total INTEGER,
  is_controller INTEGER,
  will_maintain_control INTEGER,
  parse_status TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  UNIQUE (announcement_id, raw_file_id)
);

CREATE TABLE IF NOT EXISTS insider_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  report_id TEXT NOT NULL REFERENCES insider_reports(id) ON DELETE CASCADE,
  transaction_type_raw TEXT,
  transaction_type TEXT NOT NULL,
  is_repo INTEGER,
  ownership_status TEXT,
  direct_owner_name TEXT,
  unexercised_amount INTEGER,
  exercise_deadline TEXT,
  shares INTEGER,
  share_classification TEXT,
  price NUMERIC,
  transaction_date TEXT,
  purpose TEXT
);

CREATE TABLE IF NOT EXISTS monthly_ownership_snapshots (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  announcement_id TEXT NOT NULL REFERENCES idx_announcements(id),
  raw_file_id TEXT NOT NULL REFERENCES raw_files(id),
  ticker TEXT,
  issuer_name TEXT,
  report_month TEXT,
  registrar TEXT,
  total_shares INTEGER,
  treasury_shares INTEGER,
  scrip_shares INTEGER,
  scripless_shares INTEGER,
  reported_free_float_percent NUMERIC,
  parse_status TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  UNIQUE (announcement_id, raw_file_id)
);
