import { getNetWorthChangeSummaries, getNetWorthHistory } from "@mf-dashboard/db";
import type {
  NetWorthChangePeriod,
  NetWorthChangeSummary,
  NetWorthHistoryPoint,
} from "@mf-dashboard/db";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mocked } from "storybook/test";
import { NetWorthChart } from "./net-worth-chart";

// ============================================================
// Mock data generators
// ============================================================

function generateMockHistory(): NetWorthHistoryPoint[] {
  const days = 730; // 2 years
  const startDate = new Date(2024, 0, 1);

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const t = i / days;

    const noise = (seed: number) =>
      Math.sin(i * 0.07 + seed) * 200_000 + Math.sin(i * 0.3 + seed * 2) * 80_000;

    const assets = Math.round(8_000_000 + t * 4_000_000 + noise(1));
    const liabilities = Math.round(800_000 - t * 300_000 + Math.abs(noise(3)) * 0.2);

    return {
      date: date.toISOString().slice(0, 10),
      assets,
      liabilities,
      netWorth: assets - liabilities,
      source: "holding_values" as const,
    };
  });
}

const ALL_PERIODS: NetWorthChangePeriod[] = ["1d", "1w", "1m", "3m", "6m", "1y", "3y"];

function generateMockSummaries(available: boolean): NetWorthChangeSummary[] {
  const currentValue = 11_500_000;
  const changes: Record<NetWorthChangePeriod, number> = {
    "1d": 45_000,
    "1w": 120_000,
    "1m": -85_000,
    "3m": 380_000,
    "6m": 950_000,
    "1y": 1_800_000,
    "3y": 4_200_000,
  };

  return ALL_PERIODS.map((period) => {
    if (!available) {
      return {
        period,
        currentValue,
        previousValue: 0,
        absoluteChange: 0,
        percentChange: null,
        available: false,
      };
    }
    const absoluteChange = changes[period];
    const previousValue = currentValue - absoluteChange;
    return {
      period,
      currentValue,
      previousValue,
      absoluteChange,
      percentChange: previousValue !== 0 ? absoluteChange / Math.abs(previousValue) : null,
      available: true,
    };
  });
}

// ============================================================
// Meta
// ============================================================

const meta = {
  title: "Info/NetWorthChart",
  component: NetWorthChart,
  tags: ["autodocs"],
} satisfies Meta<typeof NetWorthChart>;

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================
// Stories
// ============================================================

export const Default: Story = {
  beforeEach() {
    mocked(getNetWorthHistory).mockResolvedValue(generateMockHistory());
    mocked(getNetWorthChangeSummaries).mockResolvedValue(generateMockSummaries(true));
  },
};

export const AllChipsUnavailable: Story = {
  beforeEach() {
    // Only one data point → all change periods unavailable
    const singlePoint: NetWorthHistoryPoint[] = [
      {
        date: "2026-04-09",
        assets: 8_500_000,
        liabilities: 500_000,
        netWorth: 8_000_000,
        source: "holding_values",
      },
    ];
    mocked(getNetWorthHistory).mockResolvedValue(singlePoint);
    mocked(getNetWorthChangeSummaries).mockResolvedValue(generateMockSummaries(false));
  },
};

export const MixedAvailability: Story = {
  beforeEach() {
    mocked(getNetWorthHistory).mockResolvedValue(generateMockHistory());
    const summaries = generateMockSummaries(true).map((s, i) => ({
      ...s,
      available: i >= 2, // 1d and 1w unavailable
    }));
    mocked(getNetWorthChangeSummaries).mockResolvedValue(summaries);
  },
};

export const NegativeNetWorth: Story = {
  beforeEach() {
    const history: NetWorthHistoryPoint[] = Array.from({ length: 60 }, (_, i) => {
      const date = new Date(2026, 2, 1);
      date.setDate(date.getDate() + i);
      return {
        date: date.toISOString().slice(0, 10),
        assets: 5_000_000 + i * 10_000,
        liabilities: 8_000_000 - i * 5_000,
        netWorth: -3_000_000 + i * 15_000,
        source: "holding_values" as const,
      };
    });
    mocked(getNetWorthHistory).mockResolvedValue(history);
    mocked(getNetWorthChangeSummaries).mockResolvedValue(generateMockSummaries(true));
  },
};

export const Empty: Story = {
  beforeEach() {
    mocked(getNetWorthHistory).mockResolvedValue([]);
    mocked(getNetWorthChangeSummaries).mockResolvedValue(generateMockSummaries(false));
  },
};
