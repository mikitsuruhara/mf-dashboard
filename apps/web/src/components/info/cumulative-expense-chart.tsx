import { getCumulativeExpense } from "@mf-dashboard/db";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { CumulativeExpenseChartClient } from "./cumulative-expense-chart.client";

interface CumulativeExpenseChartProps {
  month: string;
  groupId?: string;
}

export async function CumulativeExpenseChart({ month, groupId }: CumulativeExpenseChartProps) {
  const data = await getCumulativeExpense(month, groupId);

  if (data.length === 0 || data.every((d) => isNaN(d.current) || d.current === 0)) {
    return <EmptyState icon={TrendingUp} title="今月の支出ペース" />;
  }

  return <CumulativeExpenseChartClient data={data} month={month} />;
}
