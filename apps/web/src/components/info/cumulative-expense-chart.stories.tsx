import { getCumulativeExpense } from "@mf-dashboard/db";
import type { CumulativeExpensePoint } from "@mf-dashboard/db";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mocked } from "storybook/test";
import { CumulativeExpenseChart } from "./cumulative-expense-chart";

function makeData(opts: {
  currentDays: number;
  prevMultiplier?: number;
  avgMultiplier?: number;
}): CumulativeExpensePoint[] {
  const { currentDays, prevMultiplier = 1.3, avgMultiplier = 1.1 } = opts;
  const dailyBase = 5000;
  const points: CumulativeExpensePoint[] = [];
  let cumCurrent = 0;
  let cumPrev = 0;
  let cumAvg = 0;

  for (let day = 1; day <= 30; day++) {
    const spend = dailyBase + Math.sin(day * 0.4) * 2000 + 1000;
    cumPrev += spend * prevMultiplier;
    cumAvg += spend * avgMultiplier;
    if (day <= currentDays) {
      cumCurrent += spend;
    }

    points.push({
      day,
      current: day <= currentDays ? Math.round(cumCurrent) : NaN,
      previous: Math.round(cumPrev),
      average: Math.round(cumAvg),
    });
  }
  return points;
}

const meta = {
  title: "Info/CumulativeExpenseChart",
  component: CumulativeExpenseChart,
  tags: ["autodocs"],
} satisfies Meta<typeof CumulativeExpenseChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidMonth: Story = {
  args: { month: "2026-04" },
  beforeEach() {
    mocked(getCumulativeExpense).mockResolvedValue(makeData({ currentDays: 15 }));
  },
};

export const EndOfMonth: Story = {
  args: { month: "2026-03" },
  beforeEach() {
    mocked(getCumulativeExpense).mockResolvedValue(makeData({ currentDays: 30 }));
  },
};

export const LowerThanAverage: Story = {
  args: { month: "2026-04" },
  beforeEach() {
    mocked(getCumulativeExpense).mockResolvedValue(
      makeData({ currentDays: 15, prevMultiplier: 0.8, avgMultiplier: 0.9 }),
    );
  },
};
