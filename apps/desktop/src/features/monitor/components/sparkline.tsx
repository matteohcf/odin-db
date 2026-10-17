/** A tiny line chart of recent values, newest on the right. */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const width = 160;
  const height = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map(
      (value, index) =>
        `${(index * step).toFixed(1)},${(height - (value / max) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-9 w-full text-primary"
    >
      {values.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
