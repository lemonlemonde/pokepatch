"use client";

import { useEffect, useMemo, useState } from "react";
import { adminHeardAboutInsights } from "@/lib/adminApi";
import { LoadingIndicator } from "@/components/admin/adminShared";

const SLICE_COLORS = {
  Instagram: "#E879A9",
  Facebook: "#60A5FA",
  Discord: "#818CF8",
  "Card show": "#FBBF24",
  Friend: "#4ADE80",
  Other: "#C4B5FD",
  "Not specified": "#64748B",
};

const FALLBACK_COLORS = [
  "#F9A8D4",
  "#93C5FD",
  "#A5B4FC",
  "#FCD34D",
  "#86EFAC",
  "#DDD6FE",
  "#94A3B8",
];

function colorForLabel(label, index) {
  return SLICE_COLORS[label] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** Build SVG arc paths for a pie. Full-circle slices use a special path. */
function buildPiePaths(slices, cx, cy, radius) {
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
      color: colorForLabel(slice.label, index),
      percent: (slice.count / total) * 100,
    };
  });
}

function PieChart({ slices, activeLabel, onHover }) {
  const paths = useMemo(() => buildPiePaths(slices, 100, 100, 90), [slices]);

  if (paths.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-ink/50">
        No orders yet.
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 200 200"
      className="mx-auto h-56 w-56 sm:h-64 sm:w-64"
      role="img"
      aria-label="Pie chart of where customers heard about PokePatch"
    >
      {paths.map((slice) => {
        const active = !activeLabel || activeLabel === slice.label;
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
            onFocus={() => onHover?.(slice.label)}
            onBlur={() => onHover?.(null)}
            tabIndex={0}
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

export default function CustomerInsights() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activeLabel, setActiveLabel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const payload = await adminHeardAboutInsights();
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not load insights.");
          setData(null);
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

  const paths = useMemo(
    () => buildPiePaths(data?.slices ?? [], 100, 100, 90),
    [data?.slices]
  );
  const activeSlice = paths.find((row) => row.label === activeLabel) ?? null;

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

  const total = data?.total ?? 0;
  const answered = data?.answered ?? 0;
  const otherDetails = data?.other_details ?? [];

  return (
    <div className="space-y-8">
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
            slices={data?.slices ?? []}
            activeLabel={activeLabel}
            onHover={setActiveLabel}
          />
          {activeSlice ? (
            <p className="text-center text-sm text-ink/70">
              {activeSlice.label} — {activeSlice.count} (
              {activeSlice.percent.toFixed(0)}%)
            </p>
          ) : (
            <p className="text-center text-sm text-ink/40">
              Hover a slice for details
            </p>
          )}
        </div>

        <ul className="space-y-2">
          {paths.map((slice) => (
            <li key={slice.label}>
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                  activeLabel === slice.label
                    ? "bg-ink/10"
                    : "hover:bg-ink/5"
                }`}
                onMouseEnter={() => setActiveLabel(slice.label)}
                onMouseLeave={() => setActiveLabel(null)}
                onFocus={() => setActiveLabel(slice.label)}
                onBlur={() => setActiveLabel(null)}
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
          ))}
          {paths.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink/50">No data yet.</li>
          ) : null}
        </ul>
      </div>

      {otherDetails.length > 0 ? (
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/45">
            Other responses
          </h3>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {otherDetails.map((row) => (
              <li
                key={row.label}
                className="flex items-baseline justify-between gap-4 py-2.5 text-sm"
              >
                <span className="min-w-0 break-words text-ink">{row.label}</span>
                <span className="shrink-0 tabular-nums text-ink/55">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
