"use client";

import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatDate, formatMoney } from "@/lib/finance";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  usePlotArea,
  type BarShapeProps,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import "./charts.css";

export interface SpendingPoint {
  date?: string;
  label: string;
  amount: number;
  amountText?: string;
}

function SpendingTooltip({
  active,
  payload,
  pointOverride,
  interactive,
}: TooltipContentProps<TooltipValueType, string | number> & {
  pointOverride?: SpendingPoint;
  interactive: boolean;
}) {
  const point =
    pointOverride ?? (payload?.[0]?.payload as SpendingPoint | undefined);
  if (!active || !point) return null;
  return (
    <div className="spending-tooltip">
      <span>
        {point.date ? formatDate(point.date, { year: "numeric" }) : point.label}
      </span>
      <strong>{formatMoney(point.amountText ?? point.amount)}</strong>
      {interactive && <small>Click to view transactions</small>}
    </div>
  );
}

function ChartTooltip({
  hidden,
  keyboardPoint,
  keyboardIndex,
  count,
  interactive,
}: {
  hidden: boolean;
  keyboardPoint?: SpendingPoint;
  keyboardIndex: number;
  count: number;
  interactive: boolean;
}) {
  const plot = usePlotArea();
  return (
    <Tooltip
      active={hidden ? false : keyboardPoint ? true : undefined}
      cursor={false}
      isAnimationActive={false}
      offset={12}
      position={
        keyboardPoint && plot
          ? {
              x: Math.max(
                plot.x,
                Math.min(
                  plot.x + plot.width - Math.min(200, plot.width),
                  plot.x +
                    ((keyboardIndex + 0.5) * plot.width) / Math.max(1, count) +
                    10,
                ),
              ),
              y: plot.y + 8,
            }
          : undefined
      }
      content={(props) => (
        <SpendingTooltip
          {...props}
          pointOverride={keyboardPoint}
          interactive={interactive}
        />
      )}
      wrapperStyle={{
        pointerEvents: "none",
        zIndex: 2,
        maxWidth: Math.min(210, plot?.width ?? 210),
      }}
    />
  );
}

function DayBar({
  shape,
  count,
  selected,
  onSelect,
}: {
  shape: BarShapeProps;
  count: number;
  selected: boolean;
  onSelect?: (date: string) => void;
}) {
  const plot = usePlotArea();
  const point = shape.payload as SpendingPoint;
  if (!plot) return null;
  const binWidth = plot.width / Math.max(count, 1);
  const hitX = plot.x + shape.index * binWidth;
  const top = Math.min(shape.y, shape.y + shape.height);
  const height = Math.abs(shape.height);
  return (
    <g
      className="spending-day"
      data-date={point.date}
      data-keyboard-selected={selected || undefined}
      aria-label={`${point.date ? formatDate(point.date, { year: "numeric" }) : point.label}: ${formatMoney(point.amountText ?? point.amount)}`}
      onClick={point.date && onSelect ? () => onSelect(point.date!) : undefined}
    >
      {/* Full day bins remain tappable even when their saved total is zero. */}
      <rect
        className="spending-day-hit"
        x={hitX}
        y={plot.y}
        width={binWidth}
        height={plot.height}
        fill="transparent"
      />
      <rect
        className="spending-day-column"
        x={shape.x}
        y={top}
        width={Math.max(0, shape.width)}
        height={height}
        rx={Math.min(4, shape.width / 2, height / 2)}
        fill={point.amount < 0 ? "#738b80" : "var(--lime)"}
        pointerEvents="none"
      />
      <rect
        className="spending-day-focus"
        x={hitX + 1}
        y={plot.y + 1}
        width={Math.max(0, binWidth - 2)}
        height={Math.max(0, plot.height - 2)}
        rx={3}
        pointerEvents="none"
      />
    </g>
  );
}

export default function SpendingChart({
  points,
  onSelectDate,
  tooltipHidden = false,
}: {
  points: SpendingPoint[];
  onSelectDate?: (date: string, trigger: SVGSVGElement | null) => void;
  tooltipHidden?: boolean;
}) {
  const chart = useRef<HTMLDivElement>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const keyboardPoint =
    keyboardMode && onSelectDate
      ? points[Math.min(keyboardIndex, points.length - 1)]
      : undefined;
  const open = useCallback(
    (date: string) =>
      onSelectDate?.(
        date,
        chart.current?.querySelector<SVGSVGElement>(
          'svg[role="application"]',
        ) ?? null,
      ),
    [onSelectDate],
  );
  // Keep the renderer stable across tooltip input-mode changes.
  const renderDayBar = useCallback(
    (shape: BarShapeProps) => (
      <DayBar
        shape={shape}
        count={points.length}
        selected={Boolean(onSelectDate) && shape.index === keyboardIndex}
        onSelect={onSelectDate ? open : undefined}
      />
    ),
    [points.length, keyboardIndex, onSelectDate, open],
  );
  return (
    <div
      ref={chart}
      className="spending-chart"
      data-interactive={Boolean(onSelectDate)}
      role="group"
      aria-label="Spending by day"
      onPointerMoveCapture={(event) => {
        if (keyboardMode && event.buttons === 0) {
          // Recharts can replace its SVG descendants when tooltip settings
          // change. Finish that hover transition before a later pointer press,
          // rather than leaving a continuous-event update queued for mousedown.
          flushSync(() => setKeyboardMode(false));
        }
      }}
      onFocusCapture={(event) => {
        if (
          event.target instanceof SVGSVGElement &&
          event.target.matches(":focus-visible")
        )
          setKeyboardMode(true);
      }}
      onBlurCapture={(event) => {
        if (
          event.target instanceof SVGSVGElement &&
          !chart.current?.contains(event.relatedTarget)
        )
          setKeyboardMode(false);
      }}
      onKeyDownCapture={(event) => {
        if (!(event.target instanceof SVGSVGElement) || !onSelectDate) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          setKeyboardMode(true);
          setKeyboardIndex((index) =>
            Math.max(
              0,
              Math.min(
                points.length - 1,
                index + (event.key === "ArrowRight" ? 1 : -1),
              ),
            ),
          );
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const point = points[Math.min(keyboardIndex, points.length - 1)];
          if (point?.date) open(point.date);
        }
      }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        initialDimension={{ width: 400, height: 230 }}
      >
        <BarChart
          data={points}
          accessibilityLayer
          aria-label={
            onSelectDate
              ? "Daily spending. Use left and right arrows to choose a date, then Enter or Space to view its transactions."
              : "Daily spending"
          }
          margin={{ top: 12, right: 2, left: 0, bottom: 0 }}
          barCategoryGap="24%"
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 5"
            pointerEvents="none"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            minTickGap={22}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
            tickFormatter={(value: number) =>
              `${value < 0 ? "−" : ""}₹${Math.abs(value) >= 1000 ? `${Math.abs(value) / 1000}k` : Math.abs(value)}`
            }
          />
          <ReferenceLine y={0} stroke="var(--border)" pointerEvents="none" />
          <ChartTooltip
            hidden={tooltipHidden}
            keyboardPoint={keyboardPoint}
            keyboardIndex={keyboardIndex}
            count={points.length}
            interactive={Boolean(onSelectDate)}
          />
          <Bar
            dataKey="amount"
            fill="var(--lime)"
            maxBarSize={26}
            isAnimationActive={false}
            activeBar={false}
            shape={renderDayBar}
          />
        </BarChart>
      </ResponsiveContainer>
      {onSelectDate && (
        <p className="sr-only">
          Arrow keys choose a date. Enter or Space opens daily transactions.
        </p>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {keyboardPoint
          ? `${keyboardPoint.date ? formatDate(keyboardPoint.date, { year: "numeric" }) : keyboardPoint.label}: ${formatMoney(keyboardPoint.amountText ?? keyboardPoint.amount)}`
          : ""}
      </p>
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
            <tr key={point.date ?? point.label}>
              <th scope="row">
                {point.date
                  ? formatDate(point.date, { year: "numeric" })
                  : point.label}
              </th>
              <td>{formatMoney(point.amountText ?? point.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
