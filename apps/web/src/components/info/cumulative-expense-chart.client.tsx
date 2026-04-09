"use client";

import type { CumulativeExpensePoint } from "@mf-dashboard/db";
import { TrendingDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { semanticColors } from "../../lib/colors";
import { formatCurrency } from "../../lib/format";
import { ChartTooltipContent } from "../charts/chart-tooltip";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface TooltipEntry {
  dataKey: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number;
}

const LINE_COLORS = {
  current: semanticColors.expense,
  previous: "var(--color-muted-foreground, #888)",
  average: "var(--color-chart-3, #a78bfa)",
} as const;

function CumulativeTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) return null;

  return (
    <ChartTooltipContent>
      <div className="font-semibold mb-2 text-foreground">{label}日</div>
      {payload.map((entry) => {
        if (!entry.value || isNaN(entry.value)) return null;
        const name =
          entry.dataKey === "current"
            ? "今月"
            : entry.dataKey === "previous"
              ? "前月"
              : "12ヶ月平均";
        return (
          <div key={entry.dataKey} className="flex justify-between gap-6">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {name}
            </span>
            <AmountDisplay amount={entry.value} size="sm" weight="medium" />
          </div>
        );
      })}
    </ChartTooltipContent>
  );
}

interface CumulativeExpenseChartClientProps {
  data: CumulativeExpensePoint[];
  month: string;
}

export function CumulativeExpenseChartClient({ data, month }: CumulativeExpenseChartClientProps) {
  const [year, mon] = month.split("-").map(Number);

  // Latest current value for the header
  const latestPoint = [...data].reverse().find((d) => !isNaN(d.current) && d.current > 0);
  const currentTotal = latestPoint?.current ?? 0;
  const prevMonthTotal = data[data.length - 1]?.previous ?? null;

  const monthLabel = `${year}年${mon}月`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle icon={TrendingDown}>今月の支出ペース</CardTitle>
          <div className="flex items-baseline gap-3 mt-1">
            <AmountDisplay amount={currentTotal} type="expense" size="xl" weight="bold" />
            {prevMonthTotal !== null && (
              <span className="text-sm text-muted-foreground">
                前月 {formatCurrency(prevMonthTotal)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{monthLabel} 累計支出</p>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d) => `${d}日`}
              interval={4}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${Math.round(v / 10_000)}万`}
            />
            <Tooltip content={<CumulativeTooltip />} />
            <ReferenceLine y={0} className="stroke-border" strokeWidth={1} />

            {/* 12-month average — subtle dotted */}
            <Line
              type="monotone"
              dataKey="average"
              name="12ヶ月平均"
              stroke={LINE_COLORS.average}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls={false}
            />

            {/* Previous month — dashed */}
            <Line
              type="monotone"
              dataKey="previous"
              name="前月"
              stroke={LINE_COLORS.previous}
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
            />

            {/* Current month — solid, prominent */}
            <Line
              type="monotone"
              dataKey="current"
              name="今月"
              stroke={LINE_COLORS.current}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex gap-4 justify-center mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-0.5"
              style={{ backgroundColor: LINE_COLORS.current }}
            />
            今月
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-0.5 border-t-2 border-dashed"
              style={{ borderColor: LINE_COLORS.previous }}
            />
            前月
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-0.5 border-t-2 border-dotted"
              style={{ borderColor: LINE_COLORS.average }}
            />
            12ヶ月平均
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
