interface Point { ts: number; value: number | null }

export function Sparkline({
  points, width = 220, height = 48, color = 'var(--amber)',
}: { points: Point[]; width?: number; height?: number; color?: string }) {
  const values = points.map(p => p.value).filter((v): v is number => v != null);
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className="block opacity-30">
        <text x={4} y={height / 2} className="text-xs font-mono fill-current">NO DATA</text>
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const range = max - min;
  const stepX = width / Math.max(points.length - 1, 1);
  const d = points.map((p, i) => {
    if (p.value == null) return '';
    const x = i * stepX;
    const y = height - ((p.value - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="block">
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1={0} x2={width} y1={height * r} y2={height * r}
          stroke="currentColor" strokeDasharray="2,4" opacity={0.12} />
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth={1} />
    </svg>
  );
}
