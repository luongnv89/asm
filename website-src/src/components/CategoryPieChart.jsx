/**
 * Zero-dependency pie chart for category distribution data.
 * Accepts entries as [label, value] tuples (same shape as StatsPage catEntries).
 */

const SLICE_COLORS = [
  "#34d399",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#facc15",
  "#22d3ee",
  "#94a3b8",
  "#f87171",
  "#4ade80",
];

function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeSlice(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export default function CategoryPieChart({ entries }) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) return null;

  const cx = 80;
  const cy = 80;
  const radius = 70;

  // Compute slice angles with reduce to avoid mutating a render-phase variable.
  const slices = entries.reduce(
    (acc, [label, value], index) => {
      const sliceAngle = (value / total) * 360;
      const startAngle = acc.angle;
      const endAngle = startAngle + sliceAngle;
      acc.slices.push({
        label,
        value,
        color: SLICE_COLORS[index % SLICE_COLORS.length],
        path:
          sliceAngle >= 359.99
            ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
            : describeSlice(cx, cy, radius, startAngle, endAngle),
      });
      acc.angle = endAngle;
      return acc;
    },
    { slices: [], angle: 0 },
  ).slices;

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
      <svg
        viewBox="0 0 160 160"
        className="w-80 h-80 shrink-0"
        role="img"
        aria-label={`Category distribution pie chart, ${total} category tags`}
      >
        {slices.map((slice) => (
          <path
            key={slice.label}
            d={slice.path}
            fill={slice.color}
            stroke="var(--bg-card)"
            strokeWidth="1"
          />
        ))}
      </svg>
      <ul className="flex-1 space-y-1.5 text-sm min-w-0">
        {slices.map((slice) => {
          const pct = Math.round((slice.value / total) * 100);
          return (
            <li
              key={slice.label}
              className="grid grid-cols-[0.75rem_minmax(0,1fr)_2.5rem_2.5rem] items-center gap-2"
            >
              <span
                className="h-3 w-3 rounded-sm shrink-0"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              <span className="truncate text-[var(--fg)]" title={slice.label}>
                {slice.label}
              </span>
              <span className="text-right font-mono text-[var(--fg-dim)]">
                {slice.value}
              </span>
              <span className="text-right text-[var(--fg-muted)] text-xs">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
