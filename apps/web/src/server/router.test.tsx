import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vite-plus/test';

import { createCaller } from './router';

function createFixtureDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'vibe-idx-web-'));
  const path = join(dir, 'fixture.sqlite');
  const db = new Database(path);

  db.exec(`
    CREATE TABLE daily_prices (
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
      raw_file_id TEXT,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (trade_date, ticker)
    );

    INSERT INTO daily_prices (
      trade_date, ticker, name, previous, open, high, low, close, volume,
      value, frequency, foreign_buy, foreign_sell, listed_shares,
      tradeable_shares, ingested_at
    )
    VALUES
      ('2026-06-28', 'OLD', 'Old Price Tbk.', 90, 91, 92, 89, 90, 100, 9000, 2, 0, 0, 1000, 900, '2026-06-28T17:00:00Z'),
      ('2026-07-01', 'AADI', 'Adaro Andalan Indonesia Tbk.', 7800, 7850, 7900, 7700, 7875, 6710200, 52800000000, 800, 100, 50, 7786900000, 7786900000, '2026-07-01T17:00:00Z'),
      ('2026-07-01', 'ABBA', 'Mahaka Media Tbk.', 30, 30, 30, 30, 30, 0, 0, 0, 0, 0, 3935892857, 3935892857, '2026-07-01T17:00:00Z');

    CREATE TABLE ksei_5pct_reports (
      id TEXT PRIMARY KEY,
      as_of_date TEXT NOT NULL,
      previous_date TEXT,
      source_date TEXT,
      revision_no INTEGER NOT NULL,
      is_latest_revision INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      parse_status TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE ksei_5pct_rows (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
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

    INSERT INTO ksei_5pct_reports (
      id, as_of_date, previous_date, source_date, revision_no,
      is_latest_revision, page_count, parse_status, ingested_at
    )
    VALUES
      ('five-old', '2026-06-28', '2026-06-27', '2026-06-28', 1, 1, 10, 'parsed', '2026-06-28T17:00:00Z'),
      ('five-latest', '2026-06-30', '2026-06-29', '2026-06-30', 1, 1, 10, 'parsed', '2026-06-30T17:00:00Z');

    INSERT INTO ksei_5pct_rows (
      id, report_id, ticker, issuer_name, shareholder_name, account_name,
      investor_status, previous_shares, previous_sid_total, previous_percent,
      current_shares, current_sid_total, current_percent, reported_change,
      actual_change
    )
    VALUES
      ('unchanged', 'five-latest', 'AADI', 'ADARO ANDALAN INDONESIA Tbk, PT', 'ADARO STRATEGIC INVESTMENTS', NULL, NULL, 3200000000, NULL, 41.10, 3200000000, NULL, 41.10, 0, 0),
      ('changed', 'five-latest', 'BIRD', 'BLUE BIRD Tbk, PT', 'INDRA PRIAWAN DJOKOSOETONO', NULL, NULL, 119000000, NULL, 5.99, 120199400, NULL, 6.01, 1199400, 1199400),
      ('new', 'five-latest', 'FUJI', 'FUJI FINANCE INDONESIA Tbk, PT', 'BATARA BAYU SOEDARWANTO', NULL, NULL, NULL, NULL, NULL, 9000000, NULL, 6.30, NULL, NULL),
      ('old-changed', 'five-old', 'OLD', 'Old Issuer Tbk.', 'Old Holder', NULL, NULL, 1, NULL, 5.00, 2, NULL, 5.50, 1, 1);

    CREATE TABLE ksei_1pct_reports (
      id TEXT PRIMARY KEY,
      as_of_date TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      is_latest_revision INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      parse_status TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE ksei_1pct_rows (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
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

    INSERT INTO ksei_1pct_reports (
      id, as_of_date, revision_no, is_latest_revision, page_count,
      parse_status, ingested_at
    )
    VALUES
      ('one-old', '2026-04-30', 1, 1, 20, 'parsed', '2026-04-30T17:00:00Z'),
      ('one-latest', '2026-05-29', 1, 1, 33, 'parsed', '2026-05-29T17:00:00Z');

    INSERT INTO ksei_1pct_rows (
      id, report_id, as_of_date, ticker, issuer_name, investor_name,
      investor_classification, local_foreign, nationality, domicile,
      holdings_scripless, holdings_scrip, total_holding_shares, percentage
    )
    VALUES
      ('one-persada', 'one-latest', '2026-05-29', 'AADI', 'ADARO ANDALAN INDONESIA Tbk', 'PERSADA CAPITAL INVESTAMA', 'Corporate', 'L', 'INDONESIA', 'INDONESIA', 119887170, 0, 119887170, 1.54),
      ('one-saratoga', 'one-latest', '2026-05-29', 'AADI', 'ADARO ANDALAN INDONESIA Tbk', 'SARATOGA INVESTAMA SEDAYA TBK PT', 'Corporate', 'L', 'INDONESIA', 'INDONESIA', 341000000, 0, 341000000, 4.38),
      ('one-bbca', 'one-latest', '2026-05-29', 'BBCA', 'Bank Central Asia Tbk.', 'Public Investor', NULL, NULL, NULL, NULL, 1000, 0, 1000, 1.01),
      ('one-old-row', 'one-old', '2026-04-30', 'AADI', 'Old Issuer Tbk', 'PERSADA CAPITAL INVESTAMA', NULL, NULL, NULL, NULL, 1, 0, 1, 1.00);

    CREATE TABLE idx_announcements (
      id TEXT PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      ticker TEXT,
      published_at TEXT,
      keyword TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE insider_reports (
      id TEXT PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      raw_file_id TEXT NOT NULL,
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
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE insider_transactions (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
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

    INSERT INTO idx_announcements (
      id, announcement_id, title, ticker, published_at, keyword, raw_json,
      ingested_at
    )
    VALUES
      ('ann-old', 'old', 'Insider old', 'OLD', '2026-06-30T20:00:00', 'laporan kepemilikan', '{}', '2026-06-30T20:00:00Z'),
      ('ann-mice', 'mice', 'Insider MICE', 'MICE', '2026-07-01T19:06:42', 'laporan kepemilikan', '{}', '2026-07-01T19:06:42Z'),
      ('ann-beef', 'beef', 'Insider BEEF', 'BEEF', '2026-07-01T18:47:41', 'laporan kepemilikan', '{}', '2026-07-01T18:47:41Z');

    INSERT INTO insider_reports (
      id, announcement_id, raw_file_id, ticker, issuer_name, reporter_name,
      sid_name, position, is_director_or_commissioner, shares_before,
      voting_percent_before, shares_after, voting_percent_after, delta_total,
      is_controller, will_maintain_control, parse_status, ingested_at
    )
    VALUES
      ('report-old', 'ann-old', 'raw-old', 'OLD', 'Old Issuer Tbk.', 'Old Holder', NULL, 'Director', 1, 10, 1.00, 11, 1.10, 1, 0, 0, 'parsed', '2026-06-30T20:00:00Z'),
      ('report-mice', 'ann-mice', 'raw-mice', 'MICE', 'MULTI INDOCITRA Tbk, PT', 'SIWIE HONORIS', NULL, 'Shareholder', 0, 1000000, 1.00, 1300000, 1.30, 300000, 0, 0, 'parsed', '2026-07-01T19:06:42Z'),
      ('report-beef', 'ann-beef', 'raw-beef', 'BEEF', 'ESTIKA TATA TIARA Tbk, PT', 'PT ESTIKA TATA TIARA TBK', NULL, 'Issuer', 0, 500000, 0.50, 813700, 0.81, 313700, 0, 0, 'parsed', '2026-07-01T18:47:41Z');

    INSERT INTO insider_transactions (
      id, report_id, transaction_type_raw, transaction_type, is_repo,
      ownership_status, direct_owner_name, unexercised_amount,
      exercise_deadline, shares, share_classification, price,
      transaction_date, purpose
    )
    VALUES
      ('tx-old', 'report-old', 'Pembelian', 'BUY', 0, 'Langsung', NULL, NULL, NULL, 1, 'Saham Biasa', 100, '2026-06-30', 'Investasi'),
      ('tx-mice', 'report-mice', 'Pembelian', 'BUY', 0, 'Langsung', NULL, NULL, NULL, 300000, 'Saham Biasa', 120, '2026-06-29', 'Investasi'),
      ('tx-beef', 'report-beef', 'Pembelian Kembali', 'BUYBACK', 0, 'Langsung', NULL, NULL, NULL, 313700, 'Saham Biasa', 160, '2026-07-01', 'Buyback');
  `);

  return {
    caller: createCaller({ databaseUrl: `sqlite:///${path}` }),
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('prices.list', () => {
  it('defaults to the latest trade date and returns paginated rows', async () => {
    const fixture = createFixtureDatabase();

    try {
      const result = await fixture.caller.prices.list({ pageSize: 1 });

      expect(result.latestDate).toBe('2026-07-01');
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
      expect(result.rows).toEqual([
        expect.objectContaining({
          tradeDate: '2026-07-01',
          ticker: 'AADI',
          name: 'Adaro Andalan Indonesia Tbk.',
          close: 7875,
          volume: 6710200,
        }),
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('meta.latestDates', () => {
  it('returns the latest available date for every list surface', async () => {
    const fixture = createFixtureDatabase();

    try {
      await expect(fixture.caller.meta.latestDates()).resolves.toEqual({
        fivePctOwnership: '2026-06-30',
        insiderTransactions: '2026-07-01',
        onePctOwnership: '2026-05-29',
        prices: '2026-07-01',
      });
    } finally {
      fixture.cleanup();
    }
  });
});

describe('insiders.transactions.list', () => {
  it('returns transaction-level rows for the latest announcement date', async () => {
    const fixture = createFixtureDatabase();

    try {
      const result = await fixture.caller.insiders.transactions.list({});

      expect(result.latestDate).toBe('2026-07-01');
      expect(result.total).toBe(2);
      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publishedDate: '2026-07-01',
            transactionDate: '2026-07-01',
            ticker: 'BEEF',
            reporterName: 'PT ESTIKA TATA TIARA TBK',
            transactionType: 'BUYBACK',
            shares: 313700,
            price: 160,
          }),
          expect.objectContaining({
            publishedDate: '2026-07-01',
            transactionDate: '2026-06-29',
            ticker: 'MICE',
            reporterName: 'SIWIE HONORIS',
            transactionType: 'BUY',
          }),
        ]),
      );
    } finally {
      fixture.cleanup();
    }
  });
});

describe('ownership.onePct.list', () => {
  it('uses the latest 1% date and supports ticker plus investor search', async () => {
    const fixture = createFixtureDatabase();

    try {
      const result = await fixture.caller.ownership.onePct.list({
        investor: 'persada',
        ticker: 'AADI',
      });

      expect(result.latestDate).toBe('2026-05-29');
      expect(result.total).toBe(1);
      expect(result.rows).toEqual([
        expect.objectContaining({
          asOfDate: '2026-05-29',
          ticker: 'AADI',
          investorName: 'PERSADA CAPITAL INVESTAMA',
          percentage: 1.54,
          totalHoldingShares: 119887170,
        }),
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('ownership.fivePct.list', () => {
  it('returns only latest 5% rows with percentage changes in compact view', async () => {
    const fixture = createFixtureDatabase();

    try {
      const result = await fixture.caller.ownership.fivePct.list({
        view: 'percentageChanges',
      });

      expect(result.latestDate).toBe('2026-06-30');
      expect(result.total).toBe(2);
      expect(result.rows.map((row) => row.ticker)).toEqual(['BIRD', 'FUJI']);
      expect(result.rows[0]).toEqual(
        expect.objectContaining({
          previousPercent: 5.99,
          currentPercent: 6.01,
          actualChange: 1199400,
        }),
      );
      expect(result.rows[1]).toEqual(
        expect.objectContaining({
          previousPercent: null,
          currentPercent: 6.3,
        }),
      );
    } finally {
      fixture.cleanup();
    }
  });
});
