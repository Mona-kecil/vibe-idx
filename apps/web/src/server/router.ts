import { initTRPC } from '@trpc/server';
import { z } from 'zod';

import { withReadonlyDatabase } from './db.js';

export type ServerContext = {
  databaseUrl?: string;
};

const t = initTRPC.context<ServerContext>().create();

const paginationInput = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
};

const pricesListInput = z.object({
  tradeDate: z.string().optional(),
  q: z.string().optional(),
  ticker: z.string().optional(),
  ...paginationInput,
});

const fivePctListInput = z.object({
  asOfDate: z.string().optional(),
  q: z.string().optional(),
  ticker: z.string().optional(),
  view: z.enum(['all', 'percentageChanges']).default('all'),
  ...paginationInput,
});

const onePctListInput = z.object({
  asOfDate: z.string().optional(),
  investor: z.string().optional(),
  q: z.string().optional(),
  ticker: z.string().optional(),
  ...paginationInput,
});

const insiderTransactionsListInput = z.object({
  publishedDate: z.string().optional(),
  transactionDate: z.string().optional(),
  q: z.string().optional(),
  ticker: z.string().optional(),
  type: z.enum(['BUY', 'SELL', 'BUYBACK', 'GRANT', 'TRANSFER', 'OTHER']).optional(),
  ...paginationInput,
});

type PricesListInput = z.infer<typeof pricesListInput>;
type FivePctListInput = z.infer<typeof fivePctListInput>;
type OnePctListInput = z.infer<typeof onePctListInput>;
type InsiderTransactionsListInput = z.infer<typeof insiderTransactionsListInput>;

type CountRow = {
  total: number;
};

type LatestDateRow = {
  latestDate: string | null;
};

type DailyPriceRow = {
  tradeDate: string;
  ticker: string;
  name: string | null;
  previous: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  value: number | null;
  frequency: number | null;
  foreignBuy: number | null;
  foreignSell: number | null;
  listedShares: number | null;
  tradeableShares: number | null;
};

type FivePctOwnershipRow = {
  asOfDate: string;
  previousDate: string | null;
  sourceDate: string | null;
  ticker: string;
  issuerName: string | null;
  shareholderName: string | null;
  accountName: string | null;
  investorStatus: string | null;
  previousShares: number | null;
  previousSidTotal: number | null;
  previousPercent: number | null;
  currentShares: number | null;
  currentSidTotal: number | null;
  currentPercent: number | null;
  reportedChange: number | null;
  actualChange: number | null;
};

type OnePctOwnershipRow = {
  asOfDate: string;
  ticker: string;
  issuerName: string;
  investorName: string;
  investorClassification: string | null;
  localForeign: string | null;
  nationality: string | null;
  domicile: string | null;
  holdingsScripless: number | null;
  holdingsScrip: number | null;
  totalHoldingShares: number | null;
  percentage: number | null;
};

type InsiderTransactionRow = {
  id: string;
  publishedAt: string | null;
  publishedDate: string | null;
  transactionDate: string | null;
  ticker: string | null;
  issuerName: string | null;
  reporterName: string | null;
  sidName: string | null;
  position: string | null;
  sharesBefore: number | null;
  votingPercentBefore: number | null;
  sharesAfter: number | null;
  votingPercentAfter: number | null;
  deltaTotal: number | null;
  transactionTypeRaw: string | null;
  transactionType: string;
  ownershipStatus: string | null;
  directOwnerName: string | null;
  shares: number | null;
  shareClassification: string | null;
  price: number | null;
  purpose: string | null;
};

function normalizeLike(value: string) {
  return `%${value.trim().toLowerCase()}%`;
}

function listPrices(context: ServerContext, input: PricesListInput) {
  return withReadonlyDatabase(context.databaseUrl, (database) => {
    const latestDate =
      input.tradeDate ??
      database
        .prepare<[], LatestDateRow>('SELECT MAX(trade_date) AS latestDate FROM daily_prices')
        .get()?.latestDate ??
      null;

    if (!latestDate) {
      return {
        latestDate: null,
        page: input.page,
        pageSize: input.pageSize,
        rows: [],
        total: 0,
      };
    }

    const filters = ['trade_date = ?'];
    const params: Array<number | string> = [latestDate];

    if (input.ticker?.trim()) {
      filters.push('ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    if (input.q?.trim()) {
      filters.push('(LOWER(ticker) LIKE ? OR LOWER(name) LIKE ?)');
      const query = normalizeLike(input.q);
      params.push(query, query);
    }

    const whereSql = filters.join(' AND ');
    const total =
      database
        .prepare<unknown[], CountRow>(
          `SELECT COUNT(*) AS total FROM daily_prices WHERE ${whereSql}`,
        )
        .get(...params)?.total ?? 0;

    const rows = database
      .prepare<unknown[], DailyPriceRow>(
        `
        SELECT
          trade_date AS tradeDate,
          ticker,
          name,
          previous,
          open,
          high,
          low,
          close,
          volume,
          value,
          frequency,
          foreign_buy AS foreignBuy,
          foreign_sell AS foreignSell,
          listed_shares AS listedShares,
          tradeable_shares AS tradeableShares
        FROM daily_prices
        WHERE ${whereSql}
        ORDER BY ticker ASC
        LIMIT ? OFFSET ?
        `,
      )
      .all(...params, input.pageSize, (input.page - 1) * input.pageSize);

    return {
      latestDate,
      page: input.page,
      pageSize: input.pageSize,
      rows,
      total,
    };
  });
}

function listFivePctOwnership(context: ServerContext, input: FivePctListInput) {
  return withReadonlyDatabase(context.databaseUrl, (database) => {
    const latestDate =
      input.asOfDate ??
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(as_of_date) AS latestDate
          FROM ksei_5pct_reports
          WHERE is_latest_revision = 1
          `,
        )
        .get()?.latestDate ??
      null;

    if (!latestDate) {
      return {
        latestDate: null,
        page: input.page,
        pageSize: input.pageSize,
        rows: [],
        total: 0,
      };
    }

    const filters = ['report.as_of_date = ?', 'report.is_latest_revision = 1'];
    const params: Array<number | string> = [latestDate];

    if (input.view === 'percentageChanges') {
      filters.push('row.previous_percent IS NOT row.current_percent');
    }

    if (input.ticker?.trim()) {
      filters.push('row.ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    if (input.q?.trim()) {
      filters.push(
        `(
          LOWER(row.ticker) LIKE ?
          OR LOWER(row.issuer_name) LIKE ?
          OR LOWER(row.shareholder_name) LIKE ?
          OR LOWER(row.account_name) LIKE ?
        )`,
      );
      const query = normalizeLike(input.q);
      params.push(query, query, query, query);
    }

    const whereSql = filters.join(' AND ');
    const fromSql = `
      FROM ksei_5pct_rows row
      JOIN ksei_5pct_reports report ON report.id = row.report_id
    `;
    const total =
      database
        .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`)
        .get(...params)?.total ?? 0;

    const rows = database
      .prepare<unknown[], FivePctOwnershipRow>(
        `
        SELECT
          report.as_of_date AS asOfDate,
          report.previous_date AS previousDate,
          report.source_date AS sourceDate,
          row.ticker,
          row.issuer_name AS issuerName,
          row.shareholder_name AS shareholderName,
          row.account_name AS accountName,
          row.investor_status AS investorStatus,
          row.previous_shares AS previousShares,
          row.previous_sid_total AS previousSidTotal,
          row.previous_percent AS previousPercent,
          row.current_shares AS currentShares,
          row.current_sid_total AS currentSidTotal,
          row.current_percent AS currentPercent,
          row.reported_change AS reportedChange,
          row.actual_change AS actualChange
        ${fromSql}
        WHERE ${whereSql}
        ORDER BY row.ticker ASC, row.shareholder_name ASC
        LIMIT ? OFFSET ?
        `,
      )
      .all(...params, input.pageSize, (input.page - 1) * input.pageSize);

    return {
      latestDate,
      page: input.page,
      pageSize: input.pageSize,
      rows,
      total,
    };
  });
}

function listOnePctOwnership(context: ServerContext, input: OnePctListInput) {
  return withReadonlyDatabase(context.databaseUrl, (database) => {
    const latestDate =
      input.asOfDate ??
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(as_of_date) AS latestDate
          FROM ksei_1pct_reports
          WHERE is_latest_revision = 1
          `,
        )
        .get()?.latestDate ??
      null;

    if (!latestDate) {
      return {
        latestDate: null,
        page: input.page,
        pageSize: input.pageSize,
        rows: [],
        total: 0,
      };
    }

    const filters = ['report.as_of_date = ?', 'report.is_latest_revision = 1'];
    const params: Array<number | string> = [latestDate];

    if (input.ticker?.trim()) {
      filters.push('row.ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    if (input.investor?.trim()) {
      filters.push('LOWER(row.investor_name) LIKE ?');
      params.push(normalizeLike(input.investor));
    }

    if (input.q?.trim()) {
      filters.push(
        `(
          LOWER(row.ticker) LIKE ?
          OR LOWER(row.issuer_name) LIKE ?
          OR LOWER(row.investor_name) LIKE ?
        )`,
      );
      const query = normalizeLike(input.q);
      params.push(query, query, query);
    }

    const whereSql = filters.join(' AND ');
    const fromSql = `
      FROM ksei_1pct_rows row
      JOIN ksei_1pct_reports report ON report.id = row.report_id
    `;
    const total =
      database
        .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`)
        .get(...params)?.total ?? 0;

    const rows = database
      .prepare<unknown[], OnePctOwnershipRow>(
        `
        SELECT
          row.as_of_date AS asOfDate,
          row.ticker,
          row.issuer_name AS issuerName,
          row.investor_name AS investorName,
          row.investor_classification AS investorClassification,
          row.local_foreign AS localForeign,
          row.nationality,
          row.domicile,
          row.holdings_scripless AS holdingsScripless,
          row.holdings_scrip AS holdingsScrip,
          row.total_holding_shares AS totalHoldingShares,
          row.percentage
        ${fromSql}
        WHERE ${whereSql}
        ORDER BY row.ticker ASC, row.percentage DESC, row.investor_name ASC
        LIMIT ? OFFSET ?
        `,
      )
      .all(...params, input.pageSize, (input.page - 1) * input.pageSize);

    return {
      latestDate,
      page: input.page,
      pageSize: input.pageSize,
      rows,
      total,
    };
  });
}

function listInsiderTransactions(context: ServerContext, input: InsiderTransactionsListInput) {
  return withReadonlyDatabase(context.databaseUrl, (database) => {
    const latestDate =
      input.publishedDate ??
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(date(published_at)) AS latestDate
          FROM idx_announcements
          WHERE published_at IS NOT NULL
          `,
        )
        .get()?.latestDate ??
      null;

    if (!latestDate) {
      return {
        latestDate: null,
        page: input.page,
        pageSize: input.pageSize,
        rows: [],
        total: 0,
      };
    }

    const filters = ['date(announcement.published_at) = ?'];
    const params: Array<number | string> = [latestDate];

    if (input.transactionDate?.trim()) {
      filters.push('tx.transaction_date = ?');
      params.push(input.transactionDate.trim());
    }

    if (input.ticker?.trim()) {
      filters.push('report.ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    if (input.type) {
      filters.push('tx.transaction_type = ?');
      params.push(input.type);
    }

    if (input.q?.trim()) {
      filters.push(
        `(
          LOWER(report.ticker) LIKE ?
          OR LOWER(report.issuer_name) LIKE ?
          OR LOWER(report.reporter_name) LIKE ?
          OR LOWER(tx.purpose) LIKE ?
        )`,
      );
      const query = normalizeLike(input.q);
      params.push(query, query, query, query);
    }

    const whereSql = filters.join(' AND ');
    const fromSql = `
      FROM insider_transactions tx
      JOIN insider_reports report ON report.id = tx.report_id
      JOIN idx_announcements announcement ON announcement.id = report.announcement_id
    `;
    const total =
      database
        .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`)
        .get(...params)?.total ?? 0;

    const rows = database
      .prepare<unknown[], InsiderTransactionRow>(
        `
        SELECT
          tx.id,
          announcement.published_at AS publishedAt,
          date(announcement.published_at) AS publishedDate,
          tx.transaction_date AS transactionDate,
          report.ticker,
          report.issuer_name AS issuerName,
          report.reporter_name AS reporterName,
          report.sid_name AS sidName,
          report.position,
          report.shares_before AS sharesBefore,
          report.voting_percent_before AS votingPercentBefore,
          report.shares_after AS sharesAfter,
          report.voting_percent_after AS votingPercentAfter,
          report.delta_total AS deltaTotal,
          tx.transaction_type_raw AS transactionTypeRaw,
          tx.transaction_type AS transactionType,
          tx.ownership_status AS ownershipStatus,
          tx.direct_owner_name AS directOwnerName,
          tx.shares,
          tx.share_classification AS shareClassification,
          tx.price,
          tx.purpose
        ${fromSql}
        WHERE ${whereSql}
        ORDER BY announcement.published_at DESC, report.ticker ASC, tx.transaction_date DESC, tx.id ASC
        LIMIT ? OFFSET ?
        `,
      )
      .all(...params, input.pageSize, (input.page - 1) * input.pageSize);

    return {
      latestDate,
      page: input.page,
      pageSize: input.pageSize,
      rows,
      total,
    };
  });
}

function latestDates(context: ServerContext) {
  return withReadonlyDatabase(context.databaseUrl, (database) => {
    const prices =
      database
        .prepare<[], LatestDateRow>('SELECT MAX(trade_date) AS latestDate FROM daily_prices')
        .get()?.latestDate ?? null;
    const fivePctOwnership =
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(as_of_date) AS latestDate
          FROM ksei_5pct_reports
          WHERE is_latest_revision = 1
          `,
        )
        .get()?.latestDate ?? null;
    const onePctOwnership =
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(as_of_date) AS latestDate
          FROM ksei_1pct_reports
          WHERE is_latest_revision = 1
          `,
        )
        .get()?.latestDate ?? null;
    const insiderTransactions =
      database
        .prepare<[], LatestDateRow>(
          `
          SELECT MAX(date(published_at)) AS latestDate
          FROM idx_announcements
          WHERE published_at IS NOT NULL
          `,
        )
        .get()?.latestDate ?? null;

    return {
      fivePctOwnership,
      insiderTransactions,
      onePctOwnership,
      prices,
    };
  });
}

export const appRouter = t.router({
  meta: t.router({
    latestDates: t.procedure.query(({ ctx }) => {
      return latestDates(ctx);
    }),
  }),
  ownership: t.router({
    fivePct: t.router({
      list: t.procedure.input(fivePctListInput).query(({ ctx, input }) => {
        return listFivePctOwnership(ctx, input);
      }),
    }),
    onePct: t.router({
      list: t.procedure.input(onePctListInput).query(({ ctx, input }) => {
        return listOnePctOwnership(ctx, input);
      }),
    }),
  }),
  insiders: t.router({
    transactions: t.router({
      list: t.procedure.input(insiderTransactionsListInput).query(({ ctx, input }) => {
        return listInsiderTransactions(ctx, input);
      }),
    }),
  }),
  prices: t.router({
    list: t.procedure.input(pricesListInput).query(({ ctx, input }) => {
      return listPrices(ctx, input);
    }),
  }),
});

export type AppRouter = typeof appRouter;

export function createCaller(context: ServerContext) {
  return appRouter.createCaller(context);
}
