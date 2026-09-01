"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminHeardAboutInsights,
  adminValueRangeInsights,
} from "@/lib/adminApi";
import {
  LoadingIndicator,
  formatDateShort,
} from "@/components/admin/adminShared";
import {
  normalizeOrderStatus,
  orderDisplayLabel,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";
import { formatMoney } from "@/lib/servicePricing";

const HEARD_ABOUT_COLORS = {
  Instagram: "#E879A9",
  Facebook: "#60A5FA",
  Discord: "#818CF8",
  "Card show": "#FBBF24",
  Friend: "#4ADE80",
  Other: "#C4B5FD",
};

const RANGE_COLORS = [
  "#93C5FD",
  "#86EFAC",
  "#FCD34D",
  "#F9A8D4",
  "#C4B5FD",
  "#94A3B8",
];

const FALLBACK_COLORS = [
  "#F9A8D4",
  "#93C5FD",
  "#A5B4FC",
  "#FCD34D",
  "#86EFAC",
  "#DDD6FE",
  "#94A3B8",
];

const VALUE_CHART_TITLES = {
  card_quote: "Card quote",
  card_market: "Market price",
  order_quote: "Order quote",
};

function colorForLabel(label, index, colorMode = "heard") {
  if (colorMode === "range") {
    return RANGE_COLORS[index % RANGE_COLORS.length];
  }
  return (
    HEARD_ABOUT_COLORS[label] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
  );
}

/** Build SVG arc paths for a pie. Full-circle slices use a special path. */
function buildPiePaths(slices, cx, cy, radius, colorMode = "heard") {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  if (total <= 0) return [];

  let angle = -Math.PI / 2;
  return slices.map((slice, index) => {
    const sweep = (slice.count / total) * 2 * Math.PI;
    const start = angle;
    angle += sweep;

    let d;
    if (slice.count === total) {
      d = [
        `M ${cx} ${cy - radius}`,
        `A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
        `A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
        "Z",
      ].join(" ");
    } else {
      const x1 = cx + radius * Math.cos(start);
      const y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(angle);
      const y2 = cy + radius * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
    }

    return {
      ...slice,
      d,
      color: colorForLabel(slice.label, index, colorMode),
      percent: (slice.count / total) * 100,
    };
  });
}

function PieChart({
  slices,
  highlightLabel,
  selectedLabel,
  onHover,
  onSelect,
  emptyLabel = "No data yet.",
  ariaLabel = "Pie chart",
  colorMode = "heard",
  sizeClassName = "mx-auto h-56 w-56 sm:h-64 sm:w-64",
}) {
  const paths = useMemo(
    () => buildPiePaths(slices, 100, 100, 90, colorMode),
    [slices, colorMode]
  );

  if (paths.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-ink/50 ${sizeClassName}`}
      >
        {emptyLabel}
      </div>
    );
  }

  const focusLabel = highlightLabel || selectedLabel;

  return (
    <svg
      viewBox="0 0 200 200"
      className={sizeClassName}
      role="img"
      aria-label={ariaLabel}
    >
      {paths.map((slice) => {
        const active = !focusLabel || focusLabel === slice.label;
        return (
          <path
            key={slice.label}
            d={slice.d}
            fill={slice.color}
            opacity={active ? 1 : 0.35}
            stroke="#0B1020"
            strokeWidth="1.5"
            className="cursor-pointer transition-opacity duration-150"
            onMouseEnter={() => onHover?.(slice.label)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(slice.label)}
            onFocus={() => onHover?.(slice.label)}
            onBlur={() => onHover?.(null)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(slice.label);
              }
            }}
          >
            <title>
              {slice.label}: {slice.count} ({slice.percent.toFixed(0)}%)
            </title>
          </path>
        );
      })}
    </svg>
  );
}

function SliceLegend({ paths, selectedLabel, hoverLabel, onHover, onSelect }) {
  if (paths.length === 0) {
    return <p className="px-3 py-2 text-sm text-ink/50">No data yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {paths.map((slice) => {
        const selected = selectedLabel === slice.label;
        return (
          <li key={slice.label}>
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                selected || hoverLabel === slice.label
                  ? "bg-ink/10"
                  : "hover:bg-ink/5"
              }`}
              onMouseEnter={() => onHover?.(slice.label)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onSelect?.(slice.label)}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">
                {slice.label}
              </span>
              <span className="tabular-nums text-ink/55">
                {slice.count}
                <span className="ml-2 text-ink/35">
                  {slice.percent.toFixed(0)}%
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function OrdersForSource({ title, orders, onOpenOrder }) {
  if (!orders?.length) {
    return (
      <p className="text-sm text-ink/50">No orders for this selection.</p>
    );
  }

  return (
    <div>
      <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/45">
        {title} · {orders.length}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-ink/15">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Order</th>
              <th className="whitespace-nowrap px-3 py-2">Customer</th>
              <th className="whitespace-nowrap px-3 py-2">Status</th>
              <th className="whitespace-nowrap px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const status = normalizeOrderStatus(order.status);
              return (
                <tr
                  key={order.id}
                  onClick={() => onOpenOrder?.(order.id)}
                  className="cursor-pointer border-t border-ink/10 transition hover:bg-ink/10"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums text-ink">
                    #{order.display_id}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-ink">
                    {order.customer_name || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(
                        status,
                        order.pending_kind
                      )}`}
                    >
                      {orderDisplayLabel(status, order.pending_kind)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/60">
                    {formatDateShort(order.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RangePiePanel({
  title,
  subtitle,
  average,
  counted,
  unitLabel,
  slices,
  selectedLabel,
  hoverLabel,
  onHover,
  onSelect,
  ariaLabel,
}) {
  const paths = useMemo(
    () => buildPiePaths(slices, 100, 100, 90, "range"),
    [slices]
  );
  const focusLabel = hoverLabel || selectedLabel;
  const focusSlice = paths.find((row) => row.label === focusLabel) ?? null;

  return (
    <section className="space-y-4 rounded-xl border border-ink/10 p-4 sm:p-5">
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm text-ink/50">{subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums text-ink">
        <p>
          <span className="font-semibold text-ink/55">Average</span>{" "}
          <span className="font-bold">
            {average != null ? formatMoney(average) : "—"}
          </span>
        </p>
        <p>
          <span className="font-semibold text-ink/55">{unitLabel}</span>{" "}
          <span className="font-bold">{counted}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] sm:items-start">
        <div className="flex flex-col items-center gap-3">
          <PieChart
            slices={slices}
            highlightLabel={hoverLabel}
            selectedLabel={selectedLabel}
            onHover={onHover}
            onSelect={onSelect}
            emptyLabel="No amounts yet."
            ariaLabel={ariaLabel}
            colorMode="range"
            sizeClassName="mx-auto h-44 w-44 sm:h-48 sm:w-48"
          />
          {focusSlice ? (
            <p className="text-center text-sm text-ink/70">
              {focusSlice.label} — {focusSlice.count} (
              {focusSlice.percent.toFixed(0)}%)
            </p>
          ) : (
            <p className="text-center text-sm text-ink/40">
              Click a slice to list orders
            </p>
          )}
        </div>
        <SliceLegend
          paths={paths}
          selectedLabel={selectedLabel}
          hoverLabel={hoverLabel}
          onHover={onHover}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}

export default function CustomerInsights({ onOpenOrder }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [heardAbout, setHeardAbout] = useState(null);
  const [valueRanges, setValueRanges] = useState(null);
  const [hoverLabel, setHoverLabel] = useState(null);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [selectedOther, setSelectedOther] = useState(null);
  const [valueSelection, setValueSelection] = useState(null);
  const [valueHover, setValueHover] = useState({ chart: null, label: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [heardPayload, valuePayload] = await Promise.all([
          adminHeardAboutInsights(),
          adminValueRangeInsights(),
        ]);
        if (!cancelled) {
          setHeardAbout(heardPayload);
          setValueRanges(valuePayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not load insights.");
          setHeardAbout(null);
          setValueRanges(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const heardPaths = useMemo(
    () => buildPiePaths(heardAbout?.slices ?? [], 100, 100, 90),
    [heardAbout?.slices]
  );
  const focusLabel = hoverLabel || selectedLabel;
  const focusSlice = heardPaths.find((row) => row.label === focusLabel) ?? null;

  const selectedOrders = useMemo(() => {
    if (valueSelection) {
      const metric = valueRanges?.[valueSelection.chart];
      const slice = (metric?.slices ?? []).find(
        (row) => row.label === valueSelection.label
      );
      return slice?.orders ?? [];
    }
    if (selectedOther) {
      const detail = (heardAbout?.other_details ?? []).find(
        (row) => row.label === selectedOther
      );
      return detail?.orders ?? [];
    }
    if (!selectedLabel) return null;
    const slice = (heardAbout?.slices ?? []).find(
      (row) => row.label === selectedLabel
    );
    return slice?.orders ?? [];
  }, [heardAbout, valueRanges, selectedLabel, selectedOther, valueSelection]);

  function selectSlice(label) {
    setValueSelection(null);
    setSelectedOther(null);
    setSelectedLabel((current) => (current === label ? null : label));
  }

  function selectOtherDetail(label) {
    setValueSelection(null);
    if (selectedOther === label) {
      setSelectedOther(null);
      setSelectedLabel(null);
      return;
    }
    setSelectedLabel("Other");
    setSelectedOther(label);
  }

  function selectValueSlice(chart, label) {
    setSelectedLabel(null);
    setSelectedOther(null);
    setValueSelection((current) =>
      current?.chart === chart && current?.label === label
        ? null
        : { chart, label }
    );
  }

  if (loading) {
    return <LoadingIndicator label="Loading insights…" />;
  }

  if (error) {
    return (
      <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
        {error}
      </p>
    );
  }

  const total = heardAbout?.total ?? 0;
  const answered = heardAbout?.answered ?? 0;
  const otherDetails = heardAbout?.other_details ?? [];
  const orderListTitle = valueSelection
    ? `${VALUE_CHART_TITLES[valueSelection.chart] ?? "Selection"} · ${valueSelection.label}`
    : selectedOther
      ? `Other · ${selectedOther}`
      : selectedLabel || "";

  const valueCharts = [
    {
      key: "card_quote",
      title: VALUE_CHART_TITLES.card_quote,
      subtitle: "Per-card service quote (including high-value fee)",
      unitLabel: "Cards",
      ariaLabel: "Pie chart of card quote ranges",
      metric: valueRanges?.card_quote,
    },
    {
      key: "card_market",
      title: "Card market price",
      subtitle: "Per-card market value (raw NM)",
      unitLabel: "Cards",
      ariaLabel: "Pie chart of card market price ranges",
      metric: valueRanges?.card_market,
    },
    {
      key: "order_quote",
      title: VALUE_CHART_TITLES.order_quote,
      subtitle: "Full order quote total",
      unitLabel: "Orders",
      ariaLabel: "Pie chart of order quote ranges",
      metric: valueRanges?.order_quote,
    },
  ];

  return (
    <div className="space-y-10">
      <section className="space-y-8">
        <div>
          <h2 className="font-semibold text-ink">How did you hear about us?</h2>
          <p className="mt-1 text-sm text-ink/50">
            Acquisition source from submitted orders
          </p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm tabular-nums text-ink">
          <p>
            <span className="font-semibold text-ink/55">Orders</span>{" "}
            <span className="font-bold">{total}</span>
          </p>
          <p>
            <span className="font-semibold text-ink/55">Answered</span>{" "}
            <span className="font-bold">{answered}</span>
            {total > 0 ? (
              <span className="text-ink/45">
                {" "}
                ({Math.round((answered / total) * 100)}%)
              </span>
            ) : null}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:items-start">
          <div className="flex flex-col items-center gap-4">
            <PieChart
              slices={heardAbout?.slices ?? []}
              highlightLabel={hoverLabel}
              selectedLabel={selectedLabel}
              onHover={setHoverLabel}
              onSelect={selectSlice}
              emptyLabel="No answered sources yet."
              ariaLabel="Pie chart of where customers heard about PokePatch"
            />
            {focusSlice ? (
              <p className="text-center text-sm text-ink/70">
                {focusSlice.label} — {focusSlice.count} (
                {focusSlice.percent.toFixed(0)}%)
              </p>
            ) : (
              <p className="text-center text-sm text-ink/40">
                Click a slice to list orders
              </p>
            )}
          </div>

          <SliceLegend
            paths={heardPaths}
            selectedLabel={selectedOther ? null : selectedLabel}
            hoverLabel={hoverLabel}
            onHover={setHoverLabel}
            onSelect={selectSlice}
          />
        </div>

        {otherDetails.length > 0 ? (
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/45">
              Other responses
            </h3>
            <ul className="divide-y divide-ink/10 border-y border-ink/10">
              {otherDetails.map((row) => (
                <li key={row.label}>
                  <button
                    type="button"
                    onClick={() => selectOtherDetail(row.label)}
                    className={`flex w-full items-baseline justify-between gap-4 py-2.5 text-left text-sm transition ${
                      selectedOther === row.label
                        ? "bg-ink/10"
                        : "hover:bg-ink/5"
                    }`}
                  >
                    <span className="min-w-0 break-words text-ink">
                      {row.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink/55">
                      {row.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="font-semibold text-ink">Quote & market value</h2>
          <p className="mt-1 text-sm text-ink/50">
            Dollar amounts bucketed into ranges (canceled orders excluded)
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          {valueCharts.map((chart) => (
            <RangePiePanel
              key={chart.key}
              title={chart.title}
              subtitle={chart.subtitle}
              average={chart.metric?.average}
              counted={chart.metric?.counted ?? 0}
              unitLabel={chart.unitLabel}
              slices={chart.metric?.slices ?? []}
              selectedLabel={
                valueSelection?.chart === chart.key
                  ? valueSelection.label
                  : null
              }
              hoverLabel={
                valueHover.chart === chart.key ? valueHover.label : null
              }
              onHover={(label) =>
                setValueHover({ chart: label ? chart.key : null, label })
              }
              onSelect={(label) => selectValueSlice(chart.key, label)}
              ariaLabel={chart.ariaLabel}
            />
          ))}
        </div>
      </section>

      {selectedOrders ? (
        <OrdersForSource
          title={orderListTitle}
          orders={selectedOrders}
          onOpenOrder={onOpenOrder}
        />
      ) : null}
    </div>
  );
}
