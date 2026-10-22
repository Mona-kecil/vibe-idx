export const thresholds = {
  volumeDays: 20,
  volumeMultiple: 5,
  volumeMinValue: 5e9,
  araLowPrice: 200,
  araHighPrice: 5000,
  araLowBand: 34,
  araMidBand: 24,
  araHighBand: 19,
  foreignDays: 5,
  redMarketPct: -2,
  greenMinValue: 1e9,
  marketDays: 60,
  tickerDays: 250,
  ownershipDays: 90,
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
CREATE TABLE issuers (
  date DATE, ticker VARCHAR PRIMARY KEY, name VARCHAR, board VARCHAR, sector VARCHAR,
  sub_sector VARCHAR, industry VARCHAR, sub_industry VARCHAR
);
CREATE TEMP TABLE incoming_five AS SELECT * FROM five_pct WHERE false;`;

export const analytics = `
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
SELECT date, ticker, investor, max(combined_shares) shares, max(previous_combined) previous_shares,
  max(pct_before) pct_before, max(pct_after) pct_after, max(previous_date) previous_date
FROM five_pct GROUP BY date, ticker, investor;
CREATE VIEW investor_changes AS
SELECT *, shares - previous_shares net_shares
FROM investor_snapshots WHERE shares - previous_shares <> 0
UNION ALL
-- IDX drops an investor from the file once they fall below 5%, so an exit is a prior-day holder missing today.
SELECT d.date, p.ticker, p.investor, NULL, p.shares, p.pct_after, NULL, d.previous_date, NULL
FROM (SELECT DISTINCT date, previous_date FROM five_pct) d
JOIN investor_snapshots p ON p.date = d.previous_date
WHERE NOT EXISTS (SELECT 1 FROM investor_snapshots c
  WHERE c.date = d.date AND c.ticker = p.ticker AND c.investor = p.investor);
CREATE VIEW foreign_runs AS
WITH calendar AS (SELECT date, dense_rank() OVER (ORDER BY date) trading_day FROM prices GROUP BY date),
buys AS (
  SELECT ticker, date, net_foreign,
    trading_day - row_number() OVER (PARTITION BY ticker ORDER BY date) grp
  FROM features JOIN calendar USING(date) WHERE net_foreign > 0
)
SELECT ticker, max(date) date, count(*)::INTEGER streak_days, sum(net_foreign) net_foreign
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
    pct_before := pct_before, pct_after := pct_after))
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
WITH universe AS (SELECT ticker FROM issuers UNION SELECT ticker FROM prices UNION SELECT ticker FROM five_pct),
history AS (
  SELECT ticker, list(struct_pack(date := date, close := close, volume := volume,
    value := value, net_foreign := net_foreign) ORDER BY date) prices
  FROM (SELECT *, row_number() OVER (PARTITION BY ticker ORDER BY date DESC) n FROM features)
  WHERE n <= ${thresholds.tickerDays} GROUP BY ticker
), holders AS (
  SELECT ticker, list(struct_pack(investor := investor, shares := shares, pct := pct_after) ORDER BY investor) holders
  FROM investor_snapshots WHERE date = (SELECT max(date) FROM five_pct) AND shares > 0 GROUP BY ticker
), changes AS (
  SELECT ticker, list(struct_pack(date := date, investor := investor, net_shares := net_shares,
    shares_before := previous_shares, shares_after := shares,
    pct_before := pct_before, pct_after := pct_after) ORDER BY date DESC, investor) changes
  FROM investor_changes WHERE date >= (SELECT date FROM latest) - INTERVAL '${thresholds.ownershipDays} days'
  GROUP BY ticker
)
SELECT u.ticker, coalesce(i.name, p.name, u.ticker) AS name,
  coalesce(h.prices, []) prices, coalesce(o.holders, []) holders, coalesce(c.changes, []) changes
FROM universe u LEFT JOIN issuers i USING(ticker)
LEFT JOIN (SELECT ticker, arg_max(name, date) AS name FROM prices GROUP BY ticker) p USING(ticker)
LEFT JOIN history h USING(ticker) LEFT JOIN holders o USING(ticker) LEFT JOIN changes c USING(ticker)
ORDER BY u.ticker`;

export const health = `SELECT
  (SELECT max(date) FROM prices) prices,
  (SELECT max(date) FROM indices) indices,
  (SELECT max(date) FROM five_pct) five_pct,
  (SELECT max(date) FROM issuers) issuers,
  current_timestamp run_at`;
