import { eq, sql, and, inArray, or, ne, isNull, not } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";
import { resolveGroupId, getAccountIdsForGroup } from "../shared/group-filter";

/**
 * Liability categories excluded from net worth.
 * Mortgage is excluded because the corresponding property value is not tracked on the asset side.
 */
const EXCLUDED_LIABILITY_CATEGORIES = ["住宅ローン"] as const;

// ============================================================
// Types
// ============================================================

export type NetWorthChangePeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | "3y";

export interface NetWorthHistoryPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface NetWorthChangeSummary {
  period: NetWorthChangePeriod;
  currentValue: number;
  previousValue: number;
  absoluteChange: number;
  percentChange: number | null;
  available: boolean;
}

// ============================================================
// Helpers
// ============================================================

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function comparisonDate(latestDate: string, period: NetWorthChangePeriod): string {
  const [year, month, day] = latestDate.split("-").map(Number);
  switch (period) {
    case "1d":
      return toDateStr(new Date(year, month - 1, day - 1));
    case "1w":
      return toDateStr(new Date(year, month - 1, day - 7));
    case "1m":
      return toDateStr(new Date(year, month - 2, day));
    case "3m":
      return toDateStr(new Date(year, month - 4, day));
    case "6m":
      return toDateStr(new Date(year, month - 7, day));
    case "1y":
      return toDateStr(new Date(year - 1, month - 1, day));
    case "3y":
      return toDateStr(new Date(year - 3, month - 1, day));
  }
}

// ============================================================
// Historical net worth query
// ============================================================

/**
 * Computes historical net worth at query time from dailySnapshots + holdingValues + holdings.
 *
 * - assets = sum of holding_values.amount where holdings.type = 'asset'
 * - liabilities = sum of holding_values.amount where holdings.type = 'liability' (positive magnitude)
 * - netWorth = assets - liabilities
 *
 * When groupId is provided, filters holdings to the group's current account IDs applied
 * across all dates (no historical group membership reconstruction).
 *
 * Returns data in ascending date order.
 */
export async function getNetWorthHistory(
  options?: { groupId?: string },
  db: Db = getDb(),
): Promise<NetWorthHistoryPoint[]> {
  const groupId = await resolveGroupId(db, options?.groupId);
  if (!groupId) return [];

  const accountIds = await getAccountIdsForGroup(db, groupId);

  // Step 1: get max snapshot id per date (use latest run when multiple on same day)
  const snapshotsByDate = await db
    .select({
      date: schema.dailySnapshots.date,
      snapshotId: sql<number>`MAX(${schema.dailySnapshots.id})`,
    })
    .from(schema.dailySnapshots)
    .groupBy(schema.dailySnapshots.date)
    .all();

  if (snapshotsByDate.length === 0) return [];

  const snapshotIds = snapshotsByDate.map((s) => s.snapshotId);
  const snapshotDateMap = new Map(snapshotsByDate.map((s) => [s.snapshotId, s.date]));

  // Step 2: sum asset/liability amounts per snapshot, optionally filtered by account.
  // Exclude mortgage liabilities (no corresponding property value on the asset side).
  const snapshotFilter = inArray(schema.holdingValues.snapshotId, snapshotIds);
  const accountFilter =
    accountIds.length > 0 ? inArray(schema.holdings.accountId, accountIds) : undefined;
  // Keep a row unless: type='liability' AND liabilityCategory IS NOT NULL AND liabilityCategory IN exclusion list.
  // Must use OR decomposition to correctly handle NULL liabilityCategory (NULL IN (...) = NULL, falsy in WHERE).
  const mortgageExclusion = or(
    ne(schema.holdings.type, "liability"),
    isNull(schema.holdings.liabilityCategory),
    not(inArray(schema.holdings.liabilityCategory, [...EXCLUDED_LIABILITY_CATEGORIES])),
  );
  const whereCondition = accountFilter
    ? and(snapshotFilter, accountFilter, mortgageExclusion)
    : and(snapshotFilter, mortgageExclusion);

  const holdingData = await db
    .select({
      snapshotId: schema.holdingValues.snapshotId,
      type: schema.holdings.type,
      total: sql<number>`COALESCE(SUM(${schema.holdingValues.amount}), 0)`,
    })
    .from(schema.holdingValues)
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .where(whereCondition)
    .groupBy(schema.holdingValues.snapshotId, schema.holdings.type)
    .all();

  // Step 3: combine into NetWorthHistoryPoint[] in application code
  const byDate = new Map<string, { assets: number; liabilities: number }>();

  for (const row of holdingData) {
    const date = snapshotDateMap.get(row.snapshotId);
    if (!date) continue;

    if (!byDate.has(date)) {
      byDate.set(date, { assets: 0, liabilities: 0 });
    }

    const entry = byDate.get(date)!;
    if (row.type === "asset") {
      entry.assets += row.total;
    } else if (row.type === "liability") {
      entry.liabilities += row.total;
    }
  }

  return Array.from(byDate.entries())
    .map(([date, { assets, liabilities }]) => ({
      date,
      assets,
      liabilities,
      netWorth: assets - liabilities,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Change summaries
// ============================================================

const CHANGE_PERIODS: NetWorthChangePeriod[] = ["1d", "1w", "1m", "3m", "6m", "1y", "3y"];

/**
 * Computes net-worth change summaries for each of the 7 standard periods.
 *
 * For each period:
 *   - currentValue: latest snapshot net worth
 *   - previousValue: net worth of the latest snapshot on or before the comparison date
 *   - absoluteChange = currentValue - previousValue
 *   - percentChange = absoluteChange / |previousValue|  (null when previousValue === 0)
 *   - available: false if no comparison snapshot exists or it equals the latest
 */
export async function getNetWorthChangeSummaries(
  options?: { groupId?: string },
  db: Db = getDb(),
): Promise<NetWorthChangeSummary[]> {
  // history is ASC order
  const history = await getNetWorthHistory(options, db);

  if (history.length === 0) {
    return CHANGE_PERIODS.map((period) => ({
      period,
      currentValue: 0,
      previousValue: 0,
      absoluteChange: 0,
      percentChange: null,
      available: false,
    }));
  }

  const latest = history[history.length - 1];
  const currentValue = latest.netWorth;

  return CHANGE_PERIODS.map((period) => {
    const targetDateStr = comparisonDate(latest.date, period);

    // Find the latest point on or before targetDateStr (descending scan from second-to-last)
    let previousPoint: NetWorthHistoryPoint | undefined;
    for (let i = history.length - 2; i >= 0; i--) {
      if (history[i].date <= targetDateStr) {
        previousPoint = history[i];
        break;
      }
    }

    if (!previousPoint) {
      return {
        period,
        currentValue,
        previousValue: 0,
        absoluteChange: 0,
        percentChange: null,
        available: false,
      };
    }

    const previousValue = previousPoint.netWorth;
    const absoluteChange = currentValue - previousValue;
    const percentChange = previousValue === 0 ? null : absoluteChange / Math.abs(previousValue);

    return {
      period,
      currentValue,
      previousValue,
      absoluteChange,
      percentChange,
      available: true,
    };
  });
}
