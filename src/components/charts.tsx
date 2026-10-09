"use client";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
export default function SpendingChart({
  points,
}: {
  points: { label: string; amount: number }[];
}) {
  return (
    <div
      className="spending-chart"
      role="img"
      aria-label={`Spending by day: ${points.map((p) => `${p.label} ₹${p.amount}`).join(", ")}`}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        initialDimension={{ width: 400, height: 185 }}
      >
        <AreaChart
          data={points}
          margin={{ top: 15, right: 5, left: -25, bottom: 0 }}
        >
          <defs>
            <linearGradient id="spending-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a7b7ee" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#a7b7ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#ffffff09" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            tickFormatter={(v) => `₹${v >= 1000 ? `${v / 1000}k` : v}`}
          />
          <Tooltip
            contentStyle={{
              background: "#242427",
              border: "1px solid #36363a",
              borderRadius: 10,
              color: "#fafafa",
            }}
            formatter={(v) => [
              `₹${Number(v).toLocaleString("en-IN")}`,
              "Spending",
            ]}
          />
          <Area
            dataKey="amount"
            type="monotone"
            stroke="#a7b7ee"
            strokeWidth={2}
            fill="url(#spending-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
