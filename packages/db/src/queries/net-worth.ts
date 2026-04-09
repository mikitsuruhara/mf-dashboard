import { eq, sql, and, inArray, or, ne, isNull, not } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";
import { resolveGroupId } from "../shared/group-filter";

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
  /** Whether this point has full asset+liability breakdown (holding_values) or asset-only (asset_history). */
  source: "holding_values" | "asset_history";
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
 * Computes historical net worth using:
 * - assets: always from asset_history.total_assets (authoritative — includes all MF-tracked assets
 *   regardless of group_accounts membership, matching what MF's own history page shows).
 * - liabilities: from holding_values (only available for dates the crawler has run).
 *   Mortgage (住宅ローン) is excluded since the property value is not tracked on the asset side.
 *
 * Points where holding_values data exists are marked source="holding_values" and used for
 * change chip comparisons. All other points are source="asset_history".
 *
 * Returns data in ascending date order.
 */
export async function getNetWorthHistory(
  options?: { groupId?: string },
  db: Db = getDb(),
): Promise<NetWorthHistoryPoint[]> {
  const groupId = await resolveGroupId(db, options?.groupId);
  if (!groupId) return [];

  // Step 1: get all asset_history rows for this group (authoritative asset values).
  const ahRows = await db
    .select({
      date: schema.assetHistory.date,
      totalAssets: schema.assetHistory.totalAssets,
    })
    .from(schema.assetHistory)
    .where(eq(schema.assetHistory.groupId, groupId))
    .all();

  if (ahRows.length === 0) return [];

  const assetsByDate = new Map(ahRows.map((r) => [r.date, r.totalAssets]));

  // Step 2: get liabilities per date from holding_values.
  // Use the latest snapshot per date; no account filter — liabilities are account-agnostic.
  const snapshotsByDate = await db
    .select({
      date: schema.dailySnapshots.date,
      snapshotId: sql<number>`MAX(${schema.dailySnapshots.id})`,
    })
    .from(schema.dailySnapshots)
    .groupBy(schema.dailySnapshots.date)
    .all();

  const liabilitiesByDate = new Map<string, number>();

  if (snapshotsByDate.length > 0) {
    const snapshotIds = snapshotsByDate.map((s) => s.snapshotId);
    const snapshotDateMap = new Map(snapshotsByDate.map((s) => [s.snapshotId, s.date]));

    // Exclude mortgage liabilities (no corresponding property value on the asset side).
    const mortgageExclusion = or(
      ne(schema.holdings.type, "liability"),
      isNull(schema.holdings.liabilityCategory),
      not(inArray(schema.holdings.liabilityCategory, [...EXCLUDED_LIABILITY_CATEGORIES])),
    );

    const liabilityData = await db
      .select({
        snapshotId: schema.holdingValues.snapshotId,
        total: sql<number>`COALESCE(SUM(${schema.holdingValues.amount}), 0)`,
      })
      .from(schema.holdingValues)
      .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
      .where(
        and(
          inArray(schema.holdingValues.snapshotId, snapshotIds),
          eq(schema.holdings.type, "liability"),
          mortgageExclusion,
        ),
      )
      .groupBy(schema.holdingValues.snapshotId)
      .all();

    for (const row of liabilityData) {
      const date = snapshotDateMap.get(row.snapshotId);
      if (date) liabilitiesByDate.set(date, row.total);
    }
  }

  // Step 3: combine. For each date in asset_history, use total_assets as assets
  // and holding_values liabilities if available.
  return Array.from(assetsByDate.entries())
    .map(([date, assets]) => {
      const liabilities = liabilitiesByDate.get(date) ?? 0;
      const hasLiabilityData = liabilitiesByDate.has(date);
      return {
        date,
        assets,
        liabilities,
        netWorth: assets - liabilities,
        source: (hasLiabilityData
          ? "holding_values"
          : "asset_history") as NetWorthHistoryPoint["source"],
      };
    })
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

  // Only compute changes if the latest point has full asset+liability data.
  // Comparing holding_values net worth against asset_history total (no liabilities) produces
  // misleading numbers — e.g. assets-only historical value looks like a massive drop.
  if (latest.source !== "holding_values") {
    return CHANGE_PERIODS.map((period) => ({
      period,
      currentValue: latest.netWorth,
      previousValue: 0,
      absoluteChange: 0,
      percentChange: null,
      available: false,
    }));
  }

  const currentValue = latest.netWorth;

  return CHANGE_PERIODS.map((period) => {
    const targetDateStr = comparisonDate(latest.date, period);

    // Only use holding_values points as comparison targets — asset_history net worth
    // (= total assets, no liabilities deducted) is not comparable to holding_values net worth.
    let previousPoint: NetWorthHistoryPoint | undefined;
    for (let i = history.length - 2; i >= 0; i--) {
      if (history[i].date <= targetDateStr && history[i].source === "holding_values") {
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
