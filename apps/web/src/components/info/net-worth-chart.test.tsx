import type { NetWorthChangeSummary, NetWorthHistoryPoint } from "@mf-dashboard/db";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NetWorthChartClient } from "./net-worth-chart.client";

const HISTORY: NetWorthHistoryPoint[] = [
  {
    date: "2025-01-01",
    assets: 10_000_000,
    liabilities: 500_000,
    netWorth: 9_500_000,
    source: "holding_values",
  },
  {
    date: "2025-04-01",
    assets: 11_000_000,
    liabilities: 400_000,
    netWorth: 10_600_000,
    source: "holding_values",
  },
  {
    date: "2025-07-01",
    assets: 12_000_000,
    liabilities: 300_000,
    netWorth: 11_700_000,
    source: "holding_values",
  },
];

const ALL_PERIODS: Array<NetWorthChangeSummary["period"]> = [
  "1d",
  "1w",
  "1m",
  "3m",
  "6m",
  "1y",
  "3y",
];

function makeSummaries(available: boolean): NetWorthChangeSummary[] {
  return ALL_PERIODS.map((period) => ({
    period,
    currentValue: 11_700_000,
    previousValue: available ? 9_500_000 : 0,
    absoluteChange: available ? 2_200_000 : 0,
    percentChange: available ? 2_200_000 / 9_500_000 : null,
    available,
  }));
}

describe("NetWorthChartClient", () => {
  it("renders all 7 change chip period labels", () => {
    render(<NetWorthChartClient history={HISTORY} summaries={makeSummaries(true)} />);
    // Labels appear in both the period toggle and the change chips — use getAllByText
    for (const label of ["1日", "1週", "1ヶ月", "3ヶ月", "6ヶ月", "1年", "3年"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders 3y period toggle option", () => {
    render(<NetWorthChartClient history={HISTORY} summaries={makeSummaries(true)} />);
    expect(screen.getAllByText("3年").length).toBeGreaterThan(0);
  });

  it("renders N/A for unavailable periods", () => {
    render(<NetWorthChartClient history={HISTORY} summaries={makeSummaries(false)} />);
    const naElements = screen.getAllByText("N/A");
    expect(naElements.length).toBe(7);
  });

  it("renders latest net worth in header", () => {
    render(<NetWorthChartClient history={HISTORY} summaries={makeSummaries(true)} />);
    // The latest net worth is 11,700,000
    expect(screen.getByText(/11,700,000/)).toBeDefined();
  });

  it("shows 純資産推移 as chart title", () => {
    render(<NetWorthChartClient history={HISTORY} summaries={makeSummaries(true)} />);
    expect(screen.getByText("純資産推移")).toBeDefined();
  });
});
