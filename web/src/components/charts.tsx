/**
 * Small SVG charts on the design system: one accent series, hairline grids,
 * 2px lines, 4px rounded bar ends, a crosshair or per-mark tooltip, and the
 * numbers repeated in text or a table so nothing hides behind a hover.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { STYLE_NAMES, type WineStyle } from '../lib/format';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Clean ticks between lo and hi. */
function ticks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

interface Tip { x: number; y: number; body: ReactNode }

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), width - 160);
  return <div className="tooltip" style={{ left, top: Math.max(0, tip.y - 52) }}>{tip.body}</div>;
}

/** A line over time (one series) with an optional horizontal reference, e.g. what you paid. */
export function LineChart({ points, format, height = 220, reference, label }: {
  points: { t: number; v: number }[]; format: (v: number) => string; height?: number;
  reference?: { v: number; label: string }; label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;
  const pad = { l: 48, r: 16, t: 12, b: 26 };
  const vals = points.map((p) => p.v).concat(reference ? [reference.v] : []);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // Pad by at least 8% of the price, so a $3 wobble doesn't fill the chart.
  const extra = Math.max((hi - lo) * 0.15, hi * 0.08) || 1;
  lo = Math.max(0, lo - extra);
  hi += extra;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const yt = ticks(lo, hi);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${path}L${x(t1).toFixed(1)},${height - pad.b}L${x(t0).toFixed(1)},${height - pad.b}Z`;
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const xt = points.length > 1 ? [t0, t0 + (t1 - t0) / 2, t1] : [t0];
  const last = points[points.length - 1]!;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + pad.l;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(points[best]!.t) - px)) best = i; });
    const p = points[best]!;
    setHover(best);
    setTip({ x: x(p.t), y: y(p.v), body: <><strong>{format(p.v)}</strong>{fmtDate(p.t)}</> });
  };

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={label}>
        {yt.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={pad.l - 8} y={y(v) + 4} textAnchor="end">{format(v)}</text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text key={t} className="axis-text" x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'}>{fmtDate(t)}</text>
        ))}
        {points.length > 1 ? <path className="series-area" d={area} /> : null}
        {reference ? (
          <g>
            <line className="ref-line" x1={pad.l} x2={width - pad.r} y1={y(reference.v)} y2={y(reference.v)} strokeDasharray="0" />
            <text className="axis-text" x={width - pad.r} y={y(reference.v) - 6} textAnchor="end">{reference.label}</text>
          </g>
        ) : null}
        <path className="series-line" d={path} />
        {hover != null ? <line className="crosshair" x1={x(points[hover]!.t)} x2={x(points[hover]!.t)} y1={pad.t} y2={height - pad.b} /> : null}
        <circle className="marker" cx={x((hover != null ? points[hover]! : last).t)} cy={y((hover != null ? points[hover]! : last).v)} r={5} />
        <rect x={pad.l} y={0} width={Math.max(0, width - pad.l - pad.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHover(null); }} />
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Per category: the p10–p90 band as a soft bar and the median as a marker (the vintage ladder). */
export function RangeColumns({ items, format, height = 220, highlight, label, onSelect }: {
  items: { key: string; median: number; lo: number; hi: number; note?: string }[]; format: (v: number) => string; height?: number;
  highlight?: string; label: string; onSelect?: (key: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (!items.length) return null;
  const pad = { l: 48, r: 8, t: 12, b: 26 };
  const lo = Math.max(0, Math.min(...items.map((i) => i.lo)) * 0.85);
  const hi = Math.max(...items.map((i) => i.hi)) * 1.08;
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const slot = (width - pad.l - pad.r) / items.length;
  const bw = Math.min(24, slot * 0.6);
  const yt = ticks(lo, hi);
  const every = Math.ceil(items.length / Math.max(1, Math.floor((width - pad.l) / 42)));
  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={label}>
        {yt.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={pad.l - 8} y={y(v) + 4} textAnchor="end">{format(v)}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const on = hover === it.key || highlight === it.key;
          return (
            <g key={it.key}>
              <rect x={cx - bw / 2} y={y(it.hi)} width={bw} height={Math.max(4, y(it.lo) - y(it.hi))} rx={4} fill={on ? 'var(--accent-soft)' : 'var(--fill-quiet)'} stroke={on ? 'var(--accent)' : 'none'} />
              <line x1={cx - bw / 2 - 3} x2={cx + bw / 2 + 3} y1={y(it.median)} y2={y(it.median)} stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" />
              {i % every === 0 || on ? <text className="axis-text" x={cx} y={height - 6} textAnchor="middle" style={on ? { fill: 'var(--ink)', fontWeight: 600 } : undefined}>{it.key}</text> : null}
              <rect
                className="hit" x={cx - slot / 2} y={pad.t} width={slot} height={height - pad.t - pad.b} tabIndex={0}
                style={onSelect ? { cursor: 'pointer' } : undefined} onClick={() => onSelect?.(it.key)} onKeyDown={(e) => e.key === 'Enter' && onSelect?.(it.key)}
                aria-label={`${it.key}: ${format(it.median)}, range ${format(it.lo)} to ${format(it.hi)}`}
                onPointerEnter={() => { setHover(it.key); setTip({ x: cx, y: y(it.hi), body: <><strong>{format(it.median)}</strong>{it.key} · {format(it.lo)}–{format(it.hi)}{it.note ? <><br />{it.note}</> : null}</> }); }}
                onFocus={() => { setHover(it.key); setTip({ x: cx, y: y(it.hi), body: <><strong>{format(it.median)}</strong>{it.key} · {format(it.lo)}–{format(it.hi)}</> }); }}
                onPointerLeave={() => { setHover(null); setTip(null); }}
                onBlur={() => { setHover(null); setTip(null); }}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Vertical columns over time (counts per month). */
export function Columns({ items, height = 160, label, format = String }: { items: { key: string; label: string; v: number }[]; height?: number; label: string; format?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  if (!items.length) return null;
  const pad = { l: 28, r: 4, t: 10, b: 24 };
  const hi = Math.max(1, ...items.map((i) => i.v));
  const yt = ticks(0, hi, 3).filter((v) => Number.isInteger(v));
  const y = (v: number) => pad.t + (1 - v / (yt[yt.length - 1] || hi)) * (height - pad.t - pad.b);
  const slot = (width - pad.l - pad.r) / items.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const every = Math.ceil(items.length / Math.max(1, Math.floor((width - pad.l) / 48)));
  const base = height - pad.b;
  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={label}>
        {yt.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const top = y(it.v);
          const h = base - top;
          const r = Math.min(4, h, bw / 2);
          return (
            <g key={it.key}>
              {it.v > 0 ? <path className="bar" d={`M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z`} /> : null}
              {i % every === 0 ? <text className="axis-text" x={cx} y={height - 6} textAnchor="middle">{it.label}</text> : null}
              <rect className="hit" x={cx - slot / 2} y={pad.t} width={slot} height={base - pad.t}
                onPointerEnter={() => setTip({ x: cx, y: top, body: <><strong>{format(it.v)}</strong>{it.label}</> })} onPointerLeave={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Horizontal bars with the value at the tip; HTML, so labels never clip. */
export function BarList({ items, max, format }: { items: { key: string; label: ReactNode; v: number; note?: string }[]; max?: number; format: (v: number) => string }) {
  const top = max ?? Math.max(...items.map((i) => i.v), 0.0001);
  return (
    <div className="bars">
      {items.map((it) => (
        <div className="barrow" key={it.key} title={it.note}>
          <span className="label">{it.label}</span>
          <span className="track"><span className="fill" style={{ width: `${(it.v / top) * 100}%` }} /></span>
          <span className="val">{format(it.v)}{it.note ? <span className="faint" style={{ fontWeight: 400 }}> · {it.note}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

/** Rating against price paid, one dot per wine, colored by style (named in the legend). */
export function Scatter({ points, label, xFormat }: {
  points: { id: string; x: number; y: number; style: WineStyle; name: string }[]; label: string; xFormat: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (!points.length) return null;
  const height = 260;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  // Prices spread over orders of magnitude: a log scale keeps cheap bottles readable.
  const lx = points.map((p) => Math.log(Math.max(p.x, 100)));
  const x0 = Math.min(...lx) - 0.15;
  const x1 = Math.max(...lx) + 0.15;
  const x = (v: number) => pad.l + ((Math.log(Math.max(v, 100)) - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - 0.5) / 4.75) * (height - pad.t - pad.b);
  const xt = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000].filter((v) => Math.log(v) >= x0 && Math.log(v) <= x1);
  const styles = [...new Set(points.map((p) => p.style))];
  return (
    <div className="stack">
      <div className="chart" ref={ref}>
        <svg height={height} role="img" aria-label={label}>
          {[1, 2, 3, 4, 5].map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
              <text className="axis-text" x={pad.l - 8} y={y(v) + 4} textAnchor="end">{v}★</text>
            </g>
          ))}
          {xt.map((v) => <text key={v} className="axis-text" x={x(v)} y={height - 8} textAnchor="middle">{xFormat(v)}</text>)}
          {points.map((p) => (
            <g key={p.id}>
              <circle cx={x(p.x)} cy={y(p.y)} r={hover === p.id ? 7 : 5} fill={`var(--style-${p.style})`} stroke="var(--surface)" strokeWidth={2} opacity={hover && hover !== p.id ? 0.45 : 0.9} />
              <circle cx={x(p.x)} cy={y(p.y)} r={12} className="hit"
                onPointerEnter={() => { setHover(p.id); setTip({ x: x(p.x), y: y(p.y), body: <><strong>{p.y}★ · {xFormat(p.x)}</strong>{p.name}</> }); }}
                onPointerLeave={() => { setHover(null); setTip(null); }} />
            </g>
          ))}
        </svg>
        <Tooltip tip={tip} width={width} />
      </div>
      {styles.length > 1 ? (
        <div className="legend">{styles.map((s) => <span key={s}><span className={`dot ${s}`} />{STYLE_NAMES[s]}</span>)}</div>
      ) : null}
    </div>
  );
}
