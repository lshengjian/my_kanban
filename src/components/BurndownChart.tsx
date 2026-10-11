/**
 * A single line chart, shared by the sprint and release burndowns.
 *
 * Deliberately plain SVG: the shapes are simple, and rendering them by hand
 * keeps the axes honest about the unit they are showing.
 */
export type BurndownChartProps = {
  /** x labels, one per point. */
  labels: string[];
  /** The real reading, drawn as the solid line. */
  remaining: number[];
  /** The straight target line, drawn dashed behind it. */
  ideal: number[];
  /** "剩余工时（小时）" or "剩余故事点". */
  unitLabel: string;
  /** Shown when there is nothing worth plotting yet. */
  emptyHint?: string;
};

const W = 640;
const H = 220;
const PAD = { top: 12, right: 14, bottom: 26, left: 44 };

export default function BurndownChart({
  labels,
  remaining,
  ideal,
  unitLabel,
  emptyHint = "暂无数据",
}: BurndownChartProps) {
  const n = labels.length;
  if (n === 0) {
    return <div className="faint burndown-empty">{emptyHint}</div>;
  }

  const max = Math.max(1, ...remaining, ...ideal);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const area = `${path(remaining)} L${x(n - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  // Show at most a handful of x labels so they never collide on a phone.
  const stride = Math.max(1, Math.ceil(n / 6));
  const gridValues = [0, max / 2, max];

  return (
    <figure className="burndown">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${unitLabel}燃尽图`}
      >
        <defs>
          <linearGradient id="bd-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="bd-axis">
              {Math.round(v)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#bd-fill)" />

        {/* Ideal burn: a straight line from the opening scope to zero. */}
        <path
          d={path(ideal)}
          fill="none"
          stroke="var(--text-faint)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <path
          d={path(remaining)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {labels.map((label, i) =>
          i % stride === 0 || i === n - 1 ? (
            <text key={label + i} x={x(i)} y={H - 8} textAnchor="middle" className="bd-axis">
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="burndown-key">
        <span className="bd-item">
          <i className="bd-swatch actual" />
          实际剩余
        </span>
        <span className="bd-item">
          <i className="bd-swatch ideal" />
          理想剩余
        </span>
        <span className="bd-item muted">{unitLabel}</span>
      </figcaption>
    </figure>
  );
}