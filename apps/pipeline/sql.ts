export const thresholds = {
  volumeDays: 20,
  volumeMultiple: 5,
  volumeMinValue: 5e9,
  araLowPrice: 200,
  araHighPrice: 5000,
  araLowBand: 34,
  araMidBand: 24,
  araHighBand: 19,
  foreignDays: 7,
  foreignShare: 0.03,
  redMarketPct: -2,
  greenMinValue: 1e9,
  marketDays: 60,
  tickerDays: 250,
};

export const schema = `
CREATE TABLE prices (
  date DATE, ticker VARCHAR, close DOUBLE, prev DOUBLE, open DOUBLE, high DOUBLE,
  low DOUBLE, volume BIGINT, value DOUBLE, frequency BIGINT, foreign_buy BIGINT,
  foreign_sell BIGINT, listed_shares BIGINT, name VARCHAR, PRIMARY KEY(date, ticker)
);
CREATE TABLE indices (
  date DATE, index_code VARCHAR, close DOUBLE, prev DOUBLE, open DOUBLE, high DOUBLE,
  low DOUBLE, change DOUBLE, volume DOUBLE, value DOUBLE, frequency DOUBLE,
  PRIMARY KEY(date, index_code)
);
CREATE TABLE five_pct (
  date DATE, ticker VARCHAR, investor VARCHAR, account VARCHAR, holder_name VARCHAR,
  shares DOUBLE, previous_shares DOUBLE, combined_shares DOUBLE, previous_combined DOUBLE,
  pct_before DOUBLE, pct_after DOUBLE,
  previous_date DATE, PRIMARY KEY(date, ticker, investor, account)
);
CREATE TABLE one_pct (
  date DATE, ticker VARCHAR, investor VARCHAR, seq INTEGER, issuer_name VARCHAR,
  shares DOUBLE, pct DOUBLE, classification VARCHAR, local_foreign VARCHAR,
  nationality VARCHAR, domicile VARCHAR, scripless DOUBLE, scrip DOUBLE, url VARCHAR,
  PRIMARY KEY(date, ticker, investor, seq)
);
CREATE TABLE ownership_files (date DATE, source VARCHAR, url VARCHAR PRIMARY KEY);
CREATE TABLE disclosures (
  date DATE, id VARCHAR PRIMARY KEY, ticker VARCHAR, title VARCHAR,
  published_at VARCHAR, url VARCHAR, kind VARCHAR, attachments JSON,
  source_json VARCHAR, report_gaps JSON, registry_parser_version INTEGER,
  attachment_labels_version INTEGER
);
CREATE TABLE insiders (
  date DATE, id VARCHAR, ticker VARCHAR, reporter VARCHAR,
  shares_before DOUBLE, shares_after DOUBLE, net_shares DOUBLE, url VARCHAR,
  PRIMARY KEY(id, url)
);
CREATE TABLE registry (
  date DATE, id VARCHAR, ticker VARCHAR, free_float_pct DOUBLE,
  total_shares DOUBLE, sid_count DOUBLE, url VARCHAR, free_float_shares DOUBLE,
  PRIMARY KEY(date, ticker)
);
CREATE TABLE registry_investors (
  date DATE, ticker VARCHAR, label VARCHAR, shares DOUBLE, page INTEGER,
  PRIMARY KEY(date, ticker, label)
);
CREATE TABLE registry_holders (
  date DATE, ticker VARCHAR, investor VARCHAR, pct DOUBLE, controller BOOLEAN,
  controller_affiliate BOOLEAN, page INTEGER, PRIMARY KEY(date, ticker, investor)
);
CREATE TABLE issuers (
  date DATE, ticker VARCHAR PRIMARY KEY, name VARCHAR, board VARCHAR, sector VARCHAR,
  sub_sector VARCHAR, industry VARCHAR, sub_industry VARCHAR
);
CREATE TEMP TABLE incoming_five AS SELECT * FROM five_pct WHERE false;`;

export const marketCalendar = `
CREATE TEMP VIEW market_calendar AS
SELECT date, row_number() OVER (ORDER BY date DESC) session_no
FROM (SELECT DISTINCT date FROM prices);
CREATE TEMP VIEW market_periods AS SELECT unnest([1, 3, 5]) window_days;
`;

const marketSummaryView = `
CREATE VIEW market_summary AS
WITH active AS (
  SELECT ticker, name, close FROM prices WHERE date = (SELECT max(date) FROM prices) AND volume > 0
), totals AS (
  SELECT a.ticker, a.name, a.close, w.window_days,
    max(p.close) FILTER (WHERE c.session_no = w.window_days + 1) reference_close,
    CASE WHEN count(p.volume) FILTER (WHERE c.session_no <= w.window_days) = w.window_days
      AND count(p.value) FILTER (WHERE c.session_no <= w.window_days) = w.window_days
      THEN sum(p.value) FILTER (WHERE c.session_no <= w.window_days) END AS value,
    CASE WHEN count(p.volume) FILTER (WHERE c.session_no <= w.window_days) = w.window_days
      AND count(p.value) FILTER (WHERE c.session_no <= w.window_days) = w.window_days
      THEN sum(p.volume) FILTER (WHERE c.session_no <= w.window_days) / w.window_days END daily_volume,
    CASE WHEN count(p.volume) FILTER (WHERE c.session_no > w.window_days) = 20
      THEN avg(p.volume) FILTER (WHERE c.session_no > w.window_days) END baseline_volume
  FROM active a CROSS JOIN market_periods w
  JOIN market_calendar c ON c.session_no <= w.window_days + 20
  LEFT JOIN prices p ON p.date = c.date AND p.ticker = a.ticker
  GROUP BY a.ticker, a.name, a.close, w.window_days
)
SELECT ticker, name, close, window_days,
  (close / nullif(reference_close, 0) - 1) * 100 change_pct,
  value, daily_volume / nullif(baseline_volume, 0) rel_volume
FROM totals;
`;

export const marketSummary = `
SELECT (SELECT max(date) FROM prices) date, coalesce(list(s ORDER BY ticker), []) stocks
FROM (
  SELECT ticker, name, close, struct_pack(
    "1d" := first(struct_pack(change_pct := change_pct, value := value, rel_volume := rel_volume)) FILTER (WHERE window_days = 1),
    "3d" := first(struct_pack(change_pct := change_pct, value := value, rel_volume := rel_volume)) FILTER (WHERE window_days = 3),
    "5d" := first(struct_pack(change_pct := change_pct, value := value, rel_volume := rel_volume)) FILTER (WHERE window_days = 5)
  ) windows FROM market_summary GROUP BY ticker, name, close
) s`;

export const accumulation = `
WITH active AS (
  SELECT ticker FROM prices WHERE date = (SELECT max(date) FROM prices) AND volume > 0
), broker_days AS (
  SELECT date, ticker, count(*) row_count, bool_and(shares IS NOT NULL AND isfinite(shares)) AS valid
  FROM brokers GROUP BY date, ticker
), coverage AS (
  SELECT a.ticker, w.window_days,
    count(p.volume) = w.window_days AND bool_and(CASE WHEN p.volume > 0
      THEN coalesce(bp.complete, false) AND coalesce(b.valid, false) AND coalesce(b.row_count, 0) > 0
      ELSE true END) complete,
    sum(p.volume) volume, sum(p.frequency) trades,
    sum(p.volume) / nullif(sum(p.frequency), 0) stock_avg
  FROM active a CROSS JOIN market_periods w
  JOIN market_calendar c ON c.session_no <= w.window_days
  LEFT JOIN prices p ON p.date = c.date AND p.ticker = a.ticker
  LEFT JOIN broker_pairs bp ON bp.date = c.date AND bp.ticker = a.ticker
  LEFT JOIN broker_days b ON b.date = c.date AND b.ticker = a.ticker
  GROUP BY a.ticker, w.window_days
), nets AS (
  SELECT a.ticker, w.window_days, b.broker,
    sum(CASE WHEN b.side = 'buy' THEN b.shares ELSE -b.shares END) net,
    sum(b.freq) FILTER (WHERE b.side = 'buy') buy_trades,
    sum(b.shares) FILTER (WHERE b.side = 'buy') /
      nullif(sum(b.freq) FILTER (WHERE b.side = 'buy'), 0) broker_avg
  FROM active a CROSS JOIN market_periods w
  JOIN market_calendar c ON c.session_no <= w.window_days
  JOIN brokers b ON b.date = c.date AND b.ticker = a.ticker
  GROUP BY a.ticker, w.window_days, b.broker
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY ticker, window_days ORDER BY net DESC, broker) rank FROM nets
), periods AS (
  SELECT c.ticker, c.window_days, CASE WHEN c.complete AND c.volume > 0 AND r.broker IS NOT NULL
    THEN struct_pack(pct := r.net / c.volume, broker := r.broker,
      size := CASE WHEN isfinite(r.broker_avg / nullif(c.stock_avg, 0))
        THEN r.broker_avg / nullif(c.stock_avg, 0) END,
      broker_avg := CASE WHEN isfinite(r.broker_avg) THEN r.broker_avg END,
      stock_avg := CASE WHEN isfinite(c.stock_avg) THEN c.stock_avg END,
      buy_trades := r.buy_trades, trades := c.trades) END result
  FROM coverage c LEFT JOIN ranked r ON r.ticker = c.ticker AND r.window_days = c.window_days AND r.rank = 1
)
SELECT (SELECT max(date) FROM prices) date, coalesce(list(s ORDER BY ticker), []) stocks
FROM (
  SELECT ticker, struct_pack(
    "1d" := first(result) FILTER (WHERE window_days = 1),
    "3d" := first(result) FILTER (WHERE window_days = 3),
    "5d" := first(result) FILTER (WHERE window_days = 5)
  ) windows FROM periods GROUP BY ticker
) s`;

export const analytics = `
${marketCalendar}
${marketSummaryView}
CREATE VIEW latest AS SELECT max(date) date FROM prices;
CREATE VIEW features AS
SELECT *, (close / nullif(prev, 0) - 1) * 100 change_pct,
  (foreign_buy - foreign_sell) * close net_foreign,
  avg(volume) OVER w avg_volume, count(*) OVER w prior_days,
  CASE WHEN prev < ${thresholds.araLowPrice} THEN ${thresholds.araLowBand}
       WHEN prev < ${thresholds.araHighPrice} THEN ${thresholds.araMidBand}
       ELSE ${thresholds.araHighBand} END ara_band
FROM prices WINDOW w AS (
  PARTITION BY ticker ORDER BY date
  ROWS BETWEEN ${thresholds.volumeDays} PRECEDING AND 1 PRECEDING
);
CREATE VIEW investor_snapshots AS
WITH keyed AS (
  SELECT *, array_to_string(list_filter(regexp_split_to_array(
    regexp_replace(upper(investor), '[[:punct:]]', '', 'g'), '[[:space:]]+'),
    token -> token NOT IN ('', 'PT', 'TBK', 'PTE', 'LTD', 'LIMITED')), ' ') investor_key
  FROM five_pct
), snapshots AS (
  SELECT date, ticker, investor_key, max(investor) investor,
    max(combined_shares) shares, max(previous_combined) previous_shares,
    max(pct_before) pct_before, max(pct_after) pct_after, max(previous_date) previous_date
  FROM keyed GROUP BY date, ticker, investor_key
)
SELECT * EXCLUDE(investor), first_value(investor) OVER (
  PARTITION BY ticker, investor_key ORDER BY date DESC, investor) investor
FROM snapshots;
CREATE VIEW investor_changes AS
WITH compared AS (
  SELECT c.date, c.ticker, c.investor, c.shares,
    coalesce(p.shares, CASE WHEN d.date IS NOT NULL THEN 0 ELSE c.previous_shares END, 0) previous_shares,
    coalesce(p.pct_after, CASE WHEN d.date IS NOT NULL THEN 0 ELSE c.pct_before END, 0) pct_before,
    c.pct_after, c.previous_date
  FROM investor_snapshots c
  LEFT JOIN investor_snapshots p ON p.date = c.previous_date
    AND p.ticker = c.ticker AND p.investor_key = c.investor_key
  LEFT JOIN (SELECT DISTINCT date FROM five_pct) d ON d.date = c.previous_date
)
SELECT *, shares - previous_shares net_shares, false exited
FROM compared WHERE shares - previous_shares <> 0
UNION ALL
-- IDX drops an investor from the file once they fall below 5%, so an exit is a prior-day holder missing today.
SELECT d.date, p.ticker, p.investor, NULL, p.shares, p.pct_after, NULL, d.previous_date, NULL, true
FROM (SELECT DISTINCT date, previous_date FROM five_pct) d
JOIN investor_snapshots p ON p.date = d.previous_date
WHERE NOT EXISTS (SELECT 1 FROM investor_snapshots c
  WHERE c.date = d.date AND c.ticker = p.ticker AND c.investor_key = p.investor_key);
CREATE VIEW foreign_runs AS
WITH calendar AS (SELECT date, dense_rank() OVER (ORDER BY date) trading_day FROM prices GROUP BY date),
buys AS (
  SELECT ticker, date, net_foreign, value,
    trading_day - row_number() OVER (PARTITION BY ticker ORDER BY date) grp
  FROM features JOIN calendar USING(date) WHERE net_foreign > 0
)
SELECT ticker, max(date) date, count(*)::INTEGER streak_days, sum(net_foreign) net_foreign, sum(value) traded_value
FROM buys GROUP BY ticker, grp;
CREATE VIEW feed AS
SELECT ticker, 'volume_spike' kind, date,
  to_json(struct_pack(volume := volume, avg_volume := avg_volume,
    multiple := volume / nullif(avg_volume, 0), value := value, prior_days := prior_days)) numbers
FROM features WHERE date = (SELECT date FROM latest)
  AND prior_days = ${thresholds.volumeDays}
  AND volume >= ${thresholds.volumeMultiple} * avg_volume AND value >= ${thresholds.volumeMinValue}
UNION ALL
SELECT ticker, 'ara', date,
  to_json(struct_pack(prev := prev, close := close, change_pct := change_pct, band_pct := ara_band))
FROM features WHERE date = (SELECT date FROM latest) AND change_pct >= ara_band
UNION ALL
SELECT ticker, 'foreign_streak', date,
  to_json(struct_pack(streak_days := streak_days, net_foreign := net_foreign))
FROM foreign_runs WHERE date = (SELECT date FROM latest) AND streak_days >= ${thresholds.foreignDays}
  AND net_foreign >= ${thresholds.foreignShare} * traded_value
UNION ALL
SELECT f.ticker, 'green_on_red', f.date,
  to_json(struct_pack(change_pct := f.change_pct, market_change_pct := i.change / nullif(i.prev, 0) * 100,
    value := f.value))
FROM features f JOIN indices i ON f.date = i.date AND i.index_code = 'COMPOSITE'
WHERE f.date = (SELECT date FROM latest) AND f.change_pct > 0 AND f.value >= ${thresholds.greenMinValue}
  AND i.change / nullif(i.prev, 0) * 100 <= ${thresholds.redMarketPct}
UNION ALL
SELECT ticker, 'five_pct_change', date,
  to_json(struct_pack(investor := investor, previous_date := previous_date,
    shares_before := previous_shares, shares_after := shares, net_shares := net_shares,
    pct_before := pct_before, pct_after := pct_after, exited := exited))
FROM investor_changes WHERE date = (SELECT max(date) FROM five_pct);
`;

export const market = `
SELECT
  (SELECT coalesce(list(struct_pack(date := date, close := close,
    change := change, change_pct := change / nullif(prev, 0) * 100) ORDER BY date), [])
   FROM (SELECT * FROM indices WHERE index_code = 'COMPOSITE'
     ORDER BY date DESC LIMIT ${thresholds.marketDays})) history,
  (SELECT date FROM latest) date,
  count(*) FILTER (WHERE close > prev)::INTEGER up,
  count(*) FILTER (WHERE close < prev)::INTEGER down
FROM prices WHERE date = (SELECT date FROM latest)`;

export const stockTable = `
SELECT ticker, name, close, change_pct, volume, value, net_foreign
FROM features WHERE date = (SELECT date FROM latest) ORDER BY ticker`;

export const tickers = `
WITH universe AS (
  SELECT ticker FROM issuers UNION SELECT ticker FROM prices UNION SELECT ticker FROM five_pct
  UNION SELECT ticker FROM one_pct UNION SELECT ticker FROM disclosures WHERE ticker IS NOT NULL
),
history AS (
  SELECT ticker, min(date) first_date, list(struct_pack(date := date, close := close, volume := volume,
    value := value, net_foreign := net_foreign) ORDER BY date) prices
  FROM (SELECT *, row_number() OVER (PARTITION BY ticker ORDER BY date DESC) n FROM features)
  WHERE n <= ${thresholds.tickerDays} GROUP BY ticker
), holders AS (
  SELECT ticker, list(struct_pack(investor := investor, shares := shares, pct := pct_after) ORDER BY investor) holders
  FROM investor_snapshots WHERE date = (SELECT max(date) FROM five_pct) AND shares > 0 GROUP BY ticker
), changes AS (
  SELECT c.ticker, list(struct_pack(date := date, investor := investor, net_shares := net_shares,
    shares_before := previous_shares, shares_after := shares,
    pct_before := pct_before, pct_after := pct_after, exited := exited) ORDER BY date DESC, investor) changes
  FROM investor_changes c LEFT JOIN history h USING(ticker)
  WHERE h.first_date IS NULL OR date >= h.first_date
  GROUP BY c.ticker
), monthly AS (
  SELECT ticker, list(struct_pack(investor := investor, shares := shares, pct := pct,
    classification := classification, local_foreign := local_foreign) ORDER BY investor, seq) holders
  FROM one_pct WHERE date = (SELECT max(date) FROM one_pct) GROUP BY ticker
), monthly_snapshots AS (
  SELECT date, ticker, list(struct_pack(investor := investor, shares := shares, pct := pct,
    classification := classification, local_foreign := local_foreign) ORDER BY investor, seq) holders
  FROM one_pct GROUP BY date, ticker
), one_pct_history AS (
  SELECT ticker, list(struct_pack(date := date, holders := holders) ORDER BY date) snapshots
  FROM monthly_snapshots GROUP BY ticker
), announcements AS (
  SELECT ticker, list(struct_pack(id := id, title := title, published_at := published_at,
    url := url, kind := kind, attachments := attachments) ORDER BY published_at DESC, id) disclosures
  FROM disclosures GROUP BY ticker
), trades AS (
  SELECT ticker, list(struct_pack(date := date, reporter := reporter,
    shares_before := shares_before, shares_after := shares_after, net_shares := net_shares,
    url := url) ORDER BY date DESC, id, url) insiders FROM insiders GROUP BY ticker
), registry_types AS (
  SELECT date, ticker, list(struct_pack(label := label, shares := shares, page := page) ORDER BY label) investor_types
  FROM registry_investors GROUP BY date, ticker
), registry_flags AS (
  SELECT date, ticker, list(struct_pack(investor := investor, pct := pct, controller := controller,
    controller_affiliate := controller_affiliate, page := page) ORDER BY investor) holders
  FROM registry_holders GROUP BY date, ticker
), registers AS (
  SELECT r.*, struct_pack(date := r.date, free_float_pct := r.free_float_pct,
    issued_shares := coalesce((SELECT o.shares * 100 / o.pct FROM one_pct o
      WHERE o.ticker = r.ticker AND date_trunc('month', o.date) = date_trunc('month', r.date)
        AND o.shares > 0 AND o.pct > 0
      ORDER BY o.shares DESC, o.investor, o.seq LIMIT 1), r.total_shares),
    sid_count := r.sid_count, url := r.url,
    free_float_shares := r.free_float_shares, investor_types := coalesce(t.investor_types, []),
    holders := coalesce(f.holders, [])) record
  FROM registry r LEFT JOIN registry_types t USING(date, ticker)
  LEFT JOIN registry_flags f USING(date, ticker)
), registry_history AS (
  SELECT ticker, list(record ORDER BY date) snapshots
  FROM registers GROUP BY ticker
)
SELECT u.ticker, coalesce(i.name, p.name, u.ticker) AS name,
  coalesce(h.prices, []) prices, coalesce(o.holders, []) holders, coalesce(c.changes, []) changes,
  struct_pack(date := (SELECT max(date) FROM one_pct), holders := coalesce(m.holders, [])) one_pct,
  coalesce(a.disclosures, []) disclosures, coalesce(t.insiders, []) insiders,
  coalesce(r.snapshots, []) registry_history, coalesce(mh.snapshots, []) one_pct_history
FROM universe u LEFT JOIN issuers i USING(ticker)
LEFT JOIN (SELECT ticker, arg_max(name, date) AS name FROM prices GROUP BY ticker) p USING(ticker)
LEFT JOIN history h USING(ticker) LEFT JOIN holders o USING(ticker) LEFT JOIN changes c USING(ticker)
LEFT JOIN monthly m USING(ticker) LEFT JOIN one_pct_history mh USING(ticker)
LEFT JOIN announcements a USING(ticker)
LEFT JOIN trades t USING(ticker) LEFT JOIN registry_history r USING(ticker)
ORDER BY u.ticker`;

export const health = `SELECT
  (SELECT max(date) FROM prices) prices,
  (SELECT max(date) FROM indices) indices,
  (SELECT max(date) FROM five_pct) five_pct,
  (SELECT max(date) FROM one_pct) one_pct,
  (SELECT max(date) FROM issuers) issuers,
  current_timestamp run_at`;
