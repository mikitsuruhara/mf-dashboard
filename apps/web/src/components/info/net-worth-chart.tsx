import { getNetWorthChangeSummaries, getNetWorthHistory } from "@mf-dashboard/db";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { NetWorthChartClient } from "./net-worth-chart.client";

interface NetWorthChartProps {
  groupId?: string;
}

export async function NetWorthChart({ groupId }: NetWorthChartProps) {
  const [history, summaries] = await Promise.all([
    getNetWorthHistory({ groupId }),
    getNetWorthChangeSummaries({ groupId }),
  ]);

  if (history.length === 0) {
    return <EmptyState icon={TrendingUp} title="純資産推移" />;
  }

  return <NetWorthChartClient history={history} summaries={summaries} />;
}
