export function Sparkline({
  values,
  color,
  width = 72,
  height = 20,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2)
    return <svg width={width} height={height} aria-hidden="true" />;
  const abs = values.map((v) => Math.abs(v));
  const min = Math.min(...abs);
  const max = Math.max(...abs);
  const span = max - min || 1;
  const pts = abs
    .map(
      (v, i) =>
        `${(i / (abs.length - 1)) * (width - 2) + 1},${height - 2 - ((v - min) / span) * (height - 4)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
