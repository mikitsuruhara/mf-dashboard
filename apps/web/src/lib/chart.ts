export type Period = "10d" | "1m" | "3m" | "6m" | "1y" | "3y" | "all";

export const CHART_PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "1m", label: "1ヶ月" },
  { value: "3m", label: "3ヶ月" },
  { value: "6m", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "all", label: "全期間" },
];

/** Period options for the net-worth chart — includes 3y between 1y and all. */
export const NET_WORTH_PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "10d", label: "10日" },
  { value: "3m", label: "3ヶ月" },
  { value: "6m", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "3y", label: "3年" },
  { value: "all", label: "全期間" },
];

export type ComparisonPeriod = "daily" | "weekly" | "monthly";

export const COMPARISON_PERIOD_OPTIONS: { value: ComparisonPeriod; label: string }[] = [
  { value: "daily", label: "前日" },
  { value: "weekly", label: "週間" },
  { value: "monthly", label: "月間" },
];

export function roundToNice(value: number): number {
  if (value <= 0) return 100000;

  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;

  const niceValues = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = niceValues.find((n) => n >= normalized) ?? 10;

  return nice * magnitude;
}

export function getCutoffDate(period: Period, now: Date = new Date()): Date | null {
  switch (period) {
    case "10d":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10);
    case "1m":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3m":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6m":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "3y":
      return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    case "all":
      return null;
  }
}

export function filterDataByPeriod<T extends { date: string }>(
  data: T[],
  period: Period,
  now: Date = new Date(),
): T[] {
  const cutoffDate = getCutoffDate(period, now);

  let filtered = cutoffDate ? data.filter((d) => new Date(d.date) >= cutoffDate) : data;

  if (period !== "1m") {
    const monthlyData = new Map<string, T>();

    for (const point of filtered) {
      const monthKey = point.date.slice(0, 7);
      if (!monthlyData.has(monthKey) || point.date > monthlyData.get(monthKey)!.date) {
        monthlyData.set(monthKey, point);
      }
    }

    filtered = Array.from(monthlyData.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  return filtered;
}

/**
 * Filters net-worth history by period with granularity rules:
 * - 10d         → daily points (all data within window)
 * - 3m, 6m, 1y → monthly points (last point per month; current month = latest available day)
 * - 1y          → monthly points (last point per month)
 * - 3y, all     → monthly points (last point per month)
 *
 * Data must be in ascending date order (as returned by getNetWorthHistory).
 */
export function filterNetWorthByPeriod<T extends { date: string }>(
  data: T[],
  period: Period,
  now: Date = new Date(),
): T[] {
  const cutoffDate = getCutoffDate(period, now);
  const filtered = cutoffDate ? data.filter((d) => new Date(d.date) >= cutoffDate) : data;

  // 10d → daily (show every data point)
  if (period === "10d" || period === "1m") {
    return filtered;
  }

  // 3m, 6m, 1y, 3y, all → monthly (last point per month)
  const monthMap = new Map<string, T>();
  for (const point of filtered) {
    const monthKey = point.date.slice(0, 7);
    if (!monthMap.has(monthKey) || point.date > monthMap.get(monthKey)!.date) {
      monthMap.set(monthKey, point);
    }
  }
  return Array.from(monthMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}
