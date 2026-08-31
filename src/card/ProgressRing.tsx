export interface ProgressRingProps {
  done: number;
  total: number;
  /** Outer diameter in px. */
  size?: number;
  className?: string;
}

/**
 * Checklist completion as a ring. Used by the card editor and by the canvas
 * card node at LOD `full` and `compact` (spec 7.3), so it stays dependency-free
 * and renders nothing at all when there is no checklist.
 */
export default function ProgressRing({ done, total, size = 16, className }: ProgressRingProps): JSX.Element | null {
  if (!Number.isFinite(total) || total <= 0) return null;

  const complete = Math.min(Math.max(done, 0), total);
  const fraction = complete / total;
  const stroke = Math.max(1.5, size / 8);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * fraction;
  const color = fraction >= 1 ? 'var(--temper-teal)' : 'var(--ink-muted)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`${complete} of ${total} done`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--line)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="butt"
        strokeDasharray={`${arc} ${circumference - arc}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
