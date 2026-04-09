"use client";

import type { NetWorthChangeSummary, NetWorthHistoryPoint } from "@mf-dashboard/db";
import type { NetWorthChangePeriod } from "@mf-dashboard/db";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NET_WORTH_PERIOD_OPTIONS, filterNetWorthByPeriod, type Period } from "../../lib/chart";
import { semanticColors } from "../../lib/colors";
import { cn } from "../../lib/utils";
import { ChartTooltipContent } from "../charts/chart-tooltip";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
// ============================================================
// Change period label map
// ============================================================
import { PeriodToggle } from "../ui/period-toggle";

const PERIOD_LABELS: Record<NetWorthChangePeriod, string> = {
  "1d": "1日",
  "1w": "1週",
  "1m": "1ヶ月",
  "3m": "3ヶ月",
  "6m": "6ヶ月",
  "1y": "1年",
  "3y": "3年",
};

// ============================================================
// Change chip
// ============================================================

interface NetWorthChangeChipProps {
  summary: NetWorthChangeSummary;
}

function NetWorthChangeChip({ summary }: NetWorthChangeChipProps) {
  const label = PERIOD_LABELS[summary.period];

  if (!summary.available) {
    return (
      <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-muted/40 border border-border/50 min-w-[72px]">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className="text-xs text-muted-foreground/60 mt-0.5">N/A</span>
      </div>
    );
  }

  const isPositive = summary.absoluteChange >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const colorClass = isPositive ? "text-balance-positive" : "text-balance-negative";
  const bgClass = isPositive ? "bg-balance-positive/10" : "bg-balance-negative/10";
  const borderClass = isPositive ? "border-balance-positive/20" : "border-balance-negative/20";

  return (
    <div
      className={cn(
        "flex flex-col items-center px-3 py-1.5 rounded-lg border min-w-[72px]",
        bgClass,
        borderClass,
      )}
    >
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className={cn("flex items-center gap-0.5 mt-0.5", colorClass)}>
        <Icon className="w-3 h-3 shrink-0" />
        <AmountDisplay
          amount={summary.absoluteChange}
          type="balance"
          showSign
          showUnit={false}
          size="sm"
          weight="semibold"
        />
      </div>
      {summary.percentChange !== null && (
        <span className={cn("text-xs", colorClass)}>
          {summary.absoluteChange >= 0 ? "+" : ""}
          {(summary.percentChange * 100).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

// ============================================================
// Custom tooltip
// ============================================================

interface TooltipPayloadEntry {
  name: string;
  value: number;
  fill?: string;
  stroke?: string;
  dataKey: string;
  payload?: Record<string, unknown>;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  period: Period;
}

function NetWorthTooltip({ active, payload, label, period }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) return null;

  const [year, month, day] = label.split("-");
  const dateLabel =
    period === "10d" || period === "1m"
      ? `${year}/${Number(month)}/${Number(day)}`
      : `${year}/${Number(month)}`;

  // All fields come from the data entry (single Bar with custom shape)
  const entry = payload[0]?.payload as
    | { assets: number; liabilities: number; netWorth: number }
    | undefined;
  if (!entry) return null;

  return (
    <ChartTooltipContent>
      <div className="font-semibold mb-2 text-foreground">{dateLabel}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">資産</span>
        <AmountDisplay amount={entry.assets} size="sm" weight="medium" />
      </div>
      {entry.liabilities > 0 && (
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">負債</span>
          <AmountDisplay amount={entry.liabilities} size="sm" weight="medium" />
        </div>
      )}
      <div className="flex justify-between gap-6 mt-1.5 pt-1.5 border-t">
        <span className="font-medium">純資産</span>
        <AmountDisplay amount={entry.netWorth} type="balance" size="sm" weight="semibold" />
      </div>
    </ChartTooltipContent>
  );
}

// ============================================================
// Custom bar shape: assets go up from 0, liabilities go down from 0
// ============================================================

interface CombinedBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { assets: number; liabilities: number };
}

function CombinedBar({ x = 0, y = 0, width = 0, height = 0, payload }: CombinedBarProps) {
  if (!width || height <= 0 || !payload?.assets) return null;

  // For a positive bar in Recharts: y = top of bar, y + height = the zero-line y pixel.
  // This holds regardless of whether the y-axis domain includes negatives.
  const baselineY = y + height;
  const scale = height / payload.assets; // pixels per currency unit
  const liabilityHeight = payload.liabilities > 0 ? payload.liabilities * scale : 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={semanticColors.totalAssets}
        fillOpacity={0.7}
        rx={2}
      />
      {liabilityHeight > 0 && (
        <rect
          x={x}
          y={baselineY}
          width={width}
          height={liabilityHeight}
          fill={semanticColors.liability}
          fillOpacity={0.7}
          rx={2}
        />
      )}
    </g>
  );
}

// ============================================================
// Main chart client component
// ============================================================

interface NetWorthChartClientProps {
  history: NetWorthHistoryPoint[];
  summaries: NetWorthChangeSummary[];
  height?: number;
}

export function NetWorthChartClient({
  history,
  summaries,
  height = 350,
}: NetWorthChartClientProps) {
  const [period, setPeriod] = useState<Period>("10d");

  const filteredData = filterNetWorthByPeriod(history, period);

  const chartData = filteredData.map((p) => ({
    date: p.date,
    assets: p.assets,
    liabilities: p.liabilities,
    liabilitiesNeg: -p.liabilities,
    netWorth: p.netWorth,
  }));

  // Y-axis minimum must accommodate liability bars below zero
  const maxLiability = Math.max(...chartData.map((d) => d.liabilities), 0);
  const yDomainMin = maxLiability > 0 ? -maxLiability * 1.2 : 0;

  const formatDateLabel = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-");
    const m = Number(month);
    const d = Number(day);
    if (period === "10d" || period === "1m") return `${m}/${d}`;
    if (period === "3m" || period === "6m") return `${m}月`;
    return `${year}/${m}`;
  };

  const formatYAxis = (value: number) => {
    if (value < 0) return `-${Math.abs(value / 10_000).toFixed(0)}万`;
    return `${(value / 10_000).toFixed(0)}万`;
  };

  // Latest values for header display
  const latest = history[history.length - 1];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle icon={TrendingUp}>純資産推移</CardTitle>
              {latest && (
                <div className="mt-1 flex items-baseline gap-3">
                  <AmountDisplay amount={latest.netWorth} type="balance" size="xl" weight="bold" />
                  <span className="text-sm text-muted-foreground">
                    資産 <AmountDisplay amount={latest.assets} size="sm" weight="medium" />
                    {" / "}
                    負債 <AmountDisplay amount={latest.liabilities} size="sm" weight="medium" />
                  </span>
                </div>
              )}
            </div>
            <PeriodToggle
              options={NET_WORTH_PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
              className="self-start sm:self-auto shrink-0"
            />
          </div>

          {/* Change chips */}
          <div className="flex flex-wrap gap-2">
            {summaries.map((s) => (
              <NetWorthChangeChip key={s.period} summary={s} />
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <ReferenceLine y={0} className="stroke-border" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tickFormatter={formatDateLabel}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={[yDomainMin, "auto"]}
              tickFormatter={formatYAxis}
            />
            <Tooltip
              content={<NetWorthTooltip period={period} />}
              cursor={{ fill: "transparent" }}
            />

            {/* Single bar: assets go up from 0, liabilities go down from 0 via custom shape */}
            <Bar
              dataKey="assets"
              name="資産"
              maxBarSize={40}
              shape={(props: CombinedBarProps) => <CombinedBar {...props} />}
            />

            {/* Net worth line */}
            <Line
              type="monotone"
              dataKey="netWorth"
              name="純資産"
              stroke={semanticColors.netAssets}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              animationDuration={300}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
