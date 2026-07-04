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
  sort: z.enum(['tickerAsc', 'price1dDesc', 'volume1dDesc', 'volume3dDesc']).default('tickerAsc'),
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

const brokerCodesByAccountHolderName = new Map<string, string>([
  ['AJAIB SEKURITAS ASIA', 'XC'],
  ['BAHANA SEKURITAS', 'DX'],
  ['BCA SEKURITAS', 'SQ'],
  ['BNI SEKURITAS', 'NI'],
  ['BRI DANAREKSA SEKURITAS', 'OD'],
  ['CGS INTERNATIONAL SEKURITAS INDONESIA', 'YU'],
  ['CIPTADANA SEKURITAS ASIA', 'KI'],
  ['CLSA SEKURITAS INDONESIA', 'KZ'],
  ['INDO PREMIER SEKURITAS', 'PD'],
  ['KAY HIAN SEKURITAS', 'AI'],
  ['KB VALBURY SEKURITAS', 'CP'],
  ['KGI SEKURITAS INDONESIA', 'HD'],
  ['MANDIRI SEKURITAS', 'CC'],
  ['MAYBANK SEKURITAS INDONESIA', 'ZP'],
  ['MIRAE ASSET SEKURITAS INDONESIA', 'YP'],
  ['MNC SEKURITAS', 'EP'],
  ['NH KORINDO SEKURITAS INDONESIA', 'XA'],
  ['PANIN SEKURITAS', 'GR'],
  ['PHILLIP SEKURITAS INDONESIA', 'KK'],
  ['RHB SEKURITAS INDONESIA', 'DR'],
  ['SAMUEL SEKURITAS INDONESIA', 'IF'],
  ['SINARMAS SEKURITAS', 'DH'],
  ['STOCKBIT SEKURITAS DIGITAL', 'XL'],
  ['SUCOR SEKURITAS', 'AZ'],
  ['TRIMEGAH SEKURITAS INDONESIA', 'LG'],
]);

type CountRow = {
  total: number;
};

type LatestDateRow = {
  latestDate: string | null;
};

type DateValueRow = {
  value: string;
};

type DailyPriceRow = {
  tradeDate: string;
  ticker: string;
  name: string | null;
  price: number | null;
  price1dChangePercent: number | null;
  volume1dChangePercent: number | null;
  volume3dChangePercent: number | null;
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
  id: string;
  asOfDate: string;
  previousDate: string | null;
  sourceDate: string | null;
  kind: 'shareholder' | 'unlinkedAccounts';
  ticker: string;
  issuerName: string | null;
  shareholderName: string | null;
  investorStatus: string | null;
  previousPercent: number | null;
  previousTotalShares: number | null;
  currentPercent: number | null;
  currentTotalShares: number | null;
  reportedChange: number | null;
  actualChange: number | null;
  accountCount: number;
  accounts: FivePctOwnershipAccountRow[];
};

type FivePctOwnershipAccountRow = {
  id: string;
  accountHolderName: string | null;
  brokerCode: string | null;
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

type FivePctOwnershipRawRow = Omit<FivePctOwnershipAccountRow, 'brokerCode'> & {
  asOfDate: string;
  previousDate: string | null;
  sourceDate: string | null;
  ticker: string;
  issuerName: string | null;
  shareholderName: string | null;
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

function activeSuspensionFilterSql(priceAlias: string) {
  return `
    NOT EXISTS (
      SELECT 1
      FROM idx_suspension_events latest_suspension
      WHERE latest_suspension.ticker = ${priceAlias}.ticker
        AND latest_suspension.event_type = 'SPT'
        AND latest_suspension.event_at = (
          SELECT MAX(candidate_suspension.event_at)
          FROM idx_suspension_events candidate_suspension
          WHERE candidate_suspension.ticker = ${priceAlias}.ticker
            AND date(candidate_suspension.event_at) <= ${priceAlias}.trade_date
        )
    )
  `;
}

function dailyPriceOrderBySql(sort: PricesListInput['sort']) {
  switch (sort) {
    case 'price1dDesc':
      return 'price1dChangePercent IS NULL ASC, price1dChangePercent DESC, p.ticker ASC';
    case 'volume1dDesc':
      return 'volume1dChangePercent IS NULL ASC, volume1dChangePercent DESC, p.ticker ASC';
    case 'volume3dDesc':
      return 'volume3dChangePercent IS NULL ASC, volume3dChangePercent DESC, p.ticker ASC';
    case 'tickerAsc':
    default:
      return 'p.ticker ASC';
  }
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

    const filters = ['p.trade_date = ?', activeSuspensionFilterSql('p')];
    const params: Array<number | string> = [latestDate];

    if (input.ticker?.trim()) {
      filters.push('p.ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    if (input.q?.trim()) {
      filters.push('(LOWER(p.ticker) LIKE ? OR LOWER(p.name) LIKE ?)');
      const query = normalizeLike(input.q);
      params.push(query, query);
    }

    const whereSql = filters.join(' AND ');
    const orderBySql = dailyPriceOrderBySql(input.sort);
    const total =
      database
        .prepare<unknown[], CountRow>(
          `SELECT COUNT(*) AS total FROM daily_prices p WHERE ${whereSql}`,
        )
        .get(...params)?.total ?? 0;

    const rows = database
      .prepare<unknown[], DailyPriceRow>(
        `
        SELECT
          p.trade_date AS tradeDate,
          p.ticker,
          p.name,
          p.close AS price,
          CASE
            WHEN p.close IS NULL OR previous.close IS NULL OR previous.close = 0
            THEN NULL
            ELSE ((p.close - previous.close) * 100.0) / previous.close
          END AS price1dChangePercent,
          CASE
            WHEN p.volume IS NULL OR previous.volume IS NULL OR previous.volume = 0
            THEN NULL
            ELSE ((p.volume - previous.volume) * 100.0) / previous.volume
          END AS volume1dChangePercent,
          CASE
            WHEN p.volume IS NULL
              OR prior3.volumeCount < 3
              OR prior3.averageVolume IS NULL
              OR prior3.averageVolume = 0
            THEN NULL
            ELSE ((p.volume - prior3.averageVolume) * 100.0) / prior3.averageVolume
          END AS volume3dChangePercent,
          p.previous,
          p.open,
          p.high,
          p.low,
          p.close,
          p.volume,
          p.value,
          p.frequency,
          p.foreign_buy AS foreignBuy,
          p.foreign_sell AS foreignSell,
          p.listed_shares AS listedShares,
          p.tradeable_shares AS tradeableShares
        FROM daily_prices p
        LEFT JOIN daily_prices previous
          ON previous.ticker = p.ticker
          AND previous.trade_date = (
            SELECT MAX(history.trade_date)
            FROM daily_prices history
            WHERE history.ticker = p.ticker
              AND history.trade_date < p.trade_date
          )
        LEFT JOIN (
          SELECT
            current_price.trade_date,
            current_price.ticker,
            COUNT(history.volume) AS volumeCount,
            AVG(history.volume) AS averageVolume
          FROM daily_prices current_price
          JOIN daily_prices history
            ON history.ticker = current_price.ticker
            AND history.trade_date IN (
              SELECT prior.trade_date
              FROM daily_prices prior
              WHERE prior.ticker = current_price.ticker
                AND prior.trade_date < current_price.trade_date
              ORDER BY prior.trade_date DESC
              LIMIT 3
            )
          GROUP BY current_price.trade_date, current_price.ticker
        ) prior3
          ON prior3.trade_date = p.trade_date
          AND prior3.ticker = p.ticker
        WHERE ${whereSql}
        ORDER BY ${orderBySql}
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

function listPriceDates(context: ServerContext) {
  return withReadonlyDatabase(context.databaseUrl, (database) =>
    database
      .prepare<[], DateValueRow>(
        `
        SELECT DISTINCT trade_date AS value
        FROM daily_prices
        ORDER BY trade_date DESC
        `,
      )
      .all()
      .map((row) => row.value),
  );
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

    if (input.ticker?.trim()) {
      filters.push('row.ticker = ?');
      params.push(input.ticker.trim().toUpperCase());
    }

    const whereSql = filters.join(' AND ');
    const fromSql = `
      FROM ksei_5pct_rows row
      JOIN ksei_5pct_reports report ON report.id = row.report_id
    `;
    const rawRows = database
      .prepare<unknown[], FivePctOwnershipRawRow>(
        `
        SELECT
          row.id,
          report.as_of_date AS asOfDate,
          report.previous_date AS previousDate,
          report.source_date AS sourceDate,
          row.ticker,
          row.issuer_name AS issuerName,
          row.shareholder_name AS shareholderName,
          row.account_holder_name AS accountHolderName,
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
        ORDER BY
          row.ticker ASC,
          row.shareholder_name IS NULL ASC,
          row.shareholder_name ASC,
          row.account_holder_name ASC,
          row.account_name ASC,
          row.id ASC
        `,
      )
      .all(...params);
    const rowsForGrouping = input.q?.trim()
      ? rawRows.filter((row) => rowMatchesFivePctQuery(row, input.q!.trim()))
      : rawRows;
    const groupedRows = groupFivePctRows(rowsForGrouping, rawRows, {
      changedOnly: input.view === 'percentageChanges',
    });

    return {
      latestDate,
      page: input.page,
      pageSize: input.pageSize,
      rows: groupedRows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
      total: groupedRows.length,
    };
  });
}

function listFivePctDates(context: ServerContext) {
  return withReadonlyDatabase(context.databaseUrl, (database) =>
    database
      .prepare<[], DateValueRow>(
        `
        SELECT DISTINCT as_of_date AS value
        FROM ksei_5pct_reports
        WHERE is_latest_revision = 1
        ORDER BY as_of_date DESC
        `,
      )
      .all()
      .map((row) => row.value),
  );
}

function groupFivePctRows(
  rows: FivePctOwnershipRawRow[],
  contextRows = rows,
  options: { changedOnly?: boolean } = {},
): FivePctOwnershipRow[] {
  const groups = new Map<string, FivePctOwnershipRawRow[]>();
  const shareholderGroups = buildFivePctShareholderGroups(contextRows);

  for (const row of rows) {
    const shareholderName = normalizeNullableText(row.shareholderName);
    const matchedShareholder = shareholderName
      ? null
      : matchShareholderGroup(row, shareholderGroups);
    const groupKey =
      shareholderName || matchedShareholder
        ? `shareholder:${row.ticker}:${shareholderName ?? matchedShareholder!.shareholderName}`
        : `unlinked:${row.ticker}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }

  const groupEntries = Array.from(groups.entries()).filter(
    ([, groupRows]) => !options.changedOnly || fivePctGroupHasPrimaryShareChange(groupRows),
  );

  return groupEntries
    .map(([key, groupRows]) => {
      const metadataRow = shareholderGroups.get(key)?.row ?? groupRows[0]!;
      const shareholderName = normalizeNullableText(metadataRow.shareholderName);
      const kind: FivePctOwnershipRow['kind'] = key.startsWith('shareholder:')
        ? 'shareholder'
        : 'unlinkedAccounts';
      const accounts = groupRows.map((row) => ({
        id: row.id,
        accountHolderName: row.accountHolderName,
        brokerCode: brokerCodeForAccountHolder(row.accountHolderName),
        accountName: row.accountName,
        investorStatus: row.investorStatus,
        previousShares: row.previousShares,
        previousSidTotal: row.previousSidTotal,
        previousPercent: row.previousPercent,
        currentShares: row.currentShares,
        currentSidTotal: row.currentSidTotal,
        currentPercent: row.currentPercent,
        reportedChange: row.reportedChange,
        actualChange: row.actualChange,
      }));

      return {
        id: key,
        asOfDate: metadataRow.asOfDate,
        previousDate: metadataRow.previousDate,
        sourceDate: metadataRow.sourceDate,
        kind,
        ticker: metadataRow.ticker,
        issuerName: firstNonEmpty([
          metadataRow.issuerName,
          ...groupRows.map((row) => row.issuerName),
        ]),
        shareholderName: shareholderName ?? 'Account-only rows',
        investorStatus: firstNonEmpty(groupRows.map((row) => row.investorStatus)),
        previousPercent: firstNumber(groupRows.map((row) => row.previousPercent)),
        previousTotalShares:
          maxNumber(groupRows.map((row) => row.previousSidTotal)) ??
          sumNullable(groupRows.map((row) => row.previousShares)),
        currentPercent: firstNumber(groupRows.map((row) => row.currentPercent)),
        currentTotalShares:
          maxNumber(groupRows.map((row) => row.currentSidTotal)) ??
          sumNullable(groupRows.map((row) => row.currentShares)),
        reportedChange: sumNullable(groupRows.map((row) => row.reportedChange)),
        actualChange: sumNullable(groupRows.map((row) => row.actualChange)),
        accountCount: accounts.length,
        accounts,
      };
    })
    .sort((left, right) => {
      const tickerSort = left.ticker.localeCompare(right.ticker);
      if (tickerSort !== 0) {
        return tickerSort;
      }

      if (left.kind !== right.kind) {
        return left.kind === 'shareholder' ? -1 : 1;
      }

      return (left.shareholderName ?? '').localeCompare(right.shareholderName ?? '');
    });
}

function fivePctGroupHasPrimaryShareChange(groupRows: FivePctOwnershipRawRow[]) {
  return groupRows
    .filter((row) => normalizeNullableText(row.shareholderName))
    .some((row) => hasNonZeroNumber(row.actualChange) || hasOwnershipBoundaryChange(row));
}

function hasOwnershipBoundaryChange(row: FivePctOwnershipRawRow) {
  return (
    (row.previousPercent === null && row.currentPercent !== null) ||
    (row.previousPercent !== null && row.currentPercent === null) ||
    (row.previousShares === null && row.currentShares !== null) ||
    (row.previousShares !== null && row.currentShares === null)
  );
}

function hasNonZeroNumber(value: number | null) {
  return value !== null && value !== 0;
}

type FivePctShareholderGroup = {
  key: string;
  row: FivePctOwnershipRawRow;
  shareholderName: string;
  tokens: string[];
};

function buildFivePctShareholderGroups(rows: FivePctOwnershipRawRow[]) {
  const groups = new Map<string, FivePctShareholderGroup>();

  for (const row of rows) {
    const shareholderName = normalizeNullableText(row.shareholderName);
    if (!shareholderName) {
      continue;
    }

    const key = `shareholder:${row.ticker}:${shareholderName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        row,
        shareholderName,
        tokens: tokenizeOwnershipName(shareholderName),
      });
    }
  }

  return groups;
}

function matchShareholderGroup(
  row: FivePctOwnershipRawRow,
  shareholderGroups: Map<string, FivePctShareholderGroup>,
) {
  const accountTokens = tokenizeOwnershipName(row.accountName);
  let bestMatch: { group: FivePctShareholderGroup; score: number } | null = null;

  if (accountTokens.length === 0) {
    return null;
  }

  for (const group of shareholderGroups.values()) {
    if (group.row.ticker !== row.ticker) {
      continue;
    }

    const score = shareholderAccountMatchScore(group.tokens, accountTokens);
    if (score === 0) {
      continue;
    }

    if (
      !bestMatch ||
      score > bestMatch.score ||
      group.tokens.length > bestMatch.group.tokens.length
    ) {
      bestMatch = { group, score };
    }
  }

  return bestMatch?.group ?? null;
}

function shareholderAccountMatchScore(shareholderTokens: string[], accountTokens: string[]) {
  if (shareholderTokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const shareholderToken of shareholderTokens) {
    const hasToken = accountTokens.some(
      (accountToken) =>
        accountToken === shareholderToken ||
        (accountToken.length >= 3 && shareholderToken.startsWith(accountToken)) ||
        (shareholderToken.length >= 3 && accountToken.startsWith(shareholderToken)),
    );
    if (hasToken) {
      score += 1;
    }
  }

  const requiredScore = shareholderTokens.length <= 2 ? shareholderTokens.length : 2;
  return score >= requiredScore ? score : 0;
}

function tokenizeOwnershipName(value: string | null) {
  return (
    value
      ?.toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 1 &&
          !['A', 'AC', 'AG', 'BANK', 'LTD', 'NA', 'PT', 'RE', 'SA', 'TBK'].includes(token),
      ) ?? []
  );
}

function brokerCodeForAccountHolder(value: string | null) {
  const normalized = normalizeBrokerName(value);
  return normalized ? (brokerCodesByAccountHolderName.get(normalized) ?? null) : null;
}

function normalizeBrokerName(value: string | null) {
  return (
    value
      ?.toUpperCase()
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token && !['PERSERO', 'PT', 'TBK'].includes(token))
      .join(' ')
      .trim() || null
  );
}

function rowMatchesFivePctQuery(row: FivePctOwnershipRawRow, query: string) {
  const normalizedQuery = query.toLowerCase();
  return [
    row.ticker,
    row.issuerName,
    row.shareholderName,
    row.accountHolderName,
    row.accountName,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function normalizeNullableText(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function firstNonEmpty(values: Array<string | null>) {
  for (const value of values) {
    const normalized = normalizeNullableText(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function firstNumber(values: Array<number | null>) {
  return values.find((value) => value !== null) ?? null;
}

function maxNumber(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => value !== null);
  return numericValues.length > 0 ? Math.max(...numericValues) : null;
}

function sumNullable(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => value !== null);
  return numericValues.length > 0 ? numericValues.reduce((total, value) => total + value, 0) : null;
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
      dates: t.procedure.query(({ ctx }) => {
        return listFivePctDates(ctx);
      }),
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
    dates: t.procedure.query(({ ctx }) => {
      return listPriceDates(ctx);
    }),
    list: t.procedure.input(pricesListInput).query(({ ctx, input }) => {
      return listPrices(ctx, input);
    }),
  }),
});

export type AppRouter = typeof appRouter;

export function createCaller(context: ServerContext) {
  return appRouter.createCaller(context);
}
