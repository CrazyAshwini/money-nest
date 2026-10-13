"use client";
import { formatMoney } from "@/lib/finance";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  usePlotArea,
} from "recharts";

function SpendingTooltip() {
  const plot = usePlotArea();
  return (
    <Tooltip
      isAnimationActive={false}
      wrapperStyle={{
        maxWidth: Math.max(1, Math.min(280, plot?.width ?? 280)),
      }}
      contentStyle={{
        background: "var(--raised)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        color: "var(--text)",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
      }}
      formatter={(v, _name, entry) => {
        const amountText: unknown = entry.payload?.amountText;
        const formatted =
          typeof amountText === "string"
            ? formatMoney(amountText, {
                decimals: Math.min(
                  2,
                  (amountText.split(".")[1] ?? "").replace(/0+$/, "").length,
                ),
              })
            : `₹${Number(v).toLocaleString("en-IN")}`;
        return [formatted, "Spending"];
      }}
    />
  );
}

export default function SpendingChart({
  points,
}: {
  points: { label: string; amount: number; amountText?: string }[];
}) {
  return (
    <div
      className="spending-chart"
      role="group"
      aria-label="Spending by day"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        initialDimension={{ width: 400, height: 185 }}
      >
        <AreaChart
          data={points}
          accessibilityLayer
          aria-label={`Spending by day: ${points.map((p) => `${p.label} ${formatMoney(p.amountText ?? p.amount)}`).join(", ")}`}
          margin={{ top: 15, right: 8, left: 4, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            minTickGap={40}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) => `₹${v >= 1000 ? `${v / 1000}k` : v}`}
          />
          <SpendingTooltip />
          <Area
            dataKey="amount"
            type="monotone"
            stroke="var(--blue)"
            strokeWidth={2}
            fill="var(--blue)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Spending by day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Spending</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{formatMoney(point.amountText ?? point.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
