/** Shared parts on the design system: icons, buttons, chips, stars, photos, the price range. */
import { useState, type ReactNode } from 'react';
import { photoUrl } from '../lib/api';
import { dollars, STYLE_NAMES, type WineStyle } from '../lib/format';

// The app's outline icon set (mobile/src/components/icons.tsx): 24px, ~1.7 stroke, round caps.
const ICONS: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  sparkle: <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />,
  bottle: <path d="M10 2.5h4M10.5 2.5v4.2c0 .9-.6 1.5-1.4 2.1C8 9.6 7.5 10.6 7.5 12v8a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-8c0-1.4-.5-2.4-1.6-3.2-.8-.6-1.4-1.2-1.4-2.1V2.5M7.5 14h9" />,
  glass: <path d="M8 3h8l-1 6a3 3 0 0 1-3 3 3 3 0 0 1-3-3L8 3zM12 12v8M8 21h8" />,
  list: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h5M8.5 12h5M8.5 16h5M16 8h0M16 12h0M16 16h0" /></>,
  document: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-9z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  print: <><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7z" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
};
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, stroke = 1.7 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Button({ children, variant = 'primary', size, icon, busy, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'tinted' | 'secondary' | 'plain'; size?: 'sm' | 'lg'; icon?: IconName; busy?: boolean;
}) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${!children ? 'btn-icon' : ''} ${className}`} disabled={rest.disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {busy && typeof children === 'string' ? `${children.replace(/…$/, '')}…` : children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, tinted, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; tinted?: boolean; label: string }) {
  return (
    <div className={`seg ${tinted ? 'tinted' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, onClick, children, dot }: { on: boolean; onClick: () => void; children: ReactNode; dot?: WineStyle }) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      {dot ? <span className={`dot ${dot}`} /> : null}
      {children}
    </button>
  );
}

export function StyleDot({ style, label }: { style: WineStyle; label?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`dot ${style}`} aria-hidden={label ? true : undefined} title={label ? undefined : STYLE_NAMES[style]} />
      {label ? <span>{STYLE_NAMES[style]}</span> : <span className="sr-only">{STYLE_NAMES[style]}</span>}
    </span>
  );
}

export function Stars({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return <span className="faint">Not rated</span>;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="stars" aria-label={`${rating} of 5 stars`} title={`${rating} / 5`}>
      {'★'.repeat(full)}{half ? '½' : ''}<span className="off">{'★'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}</span>
    </span>
  );
}

const BOTTLE = 'M21 4h6v14c0 3 6 4 6 10v42c0 2-1 3-3 3H18c-2 0-3-1-3-3V28c0-6 6-7 6-10z';

/** Packshots sit on white in both themes and are never cropped; without one, a bottle in the style color. */
export function WinePhoto({ uri, style = 'red', className = '', emptyLabel }: { uri: string | null | undefined; style?: WineStyle; className?: string; emptyLabel?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = photoUrl(uri);
  if (!src || failed === src) {
    return (
      <div className={`photo empty-photo ${className}`}>
        <svg viewBox="0 0 48 76" style={{ height: '62%', maxHeight: 160 }} aria-hidden="true">
          <path d={BOTTLE} fill={`var(--style-${style})`} opacity={0.85} />
        </svg>
        {emptyLabel ? <span>{emptyLabel}</span> : null}
      </div>
    );
  }
  return (
    <div className={`photo ${className}`}>
      <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
    </div>
  );
}

/** The market answer in one block: median, the p10–p90 band, and where a paid price sits. */
export function PriceRange({ median, p10, p90, paid }: { median: number; p10: number; p90: number; paid?: number | null }) {
  const lo = Math.min(p10, paid ?? p10) * 0.85;
  const hi = Math.max(p90, paid ?? p90) * 1.12;
  const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <div>
      <div className="pr" role="img" aria-label={`Market ${dollars(median)}, most shops ${dollars(p10)}–${dollars(p90)}${paid ? `, you paid ${dollars(paid)}` : ''}`}>
        <div className="pr-band" style={{ left: pos(p10), width: `max(6px, calc(${pos(p90)} - ${pos(p10)}))` }} />
        <div className="pr-tick" style={{ left: pos(median) }} />
        {paid ? <div className="pr-paid" style={{ left: pos(paid) }} title={`You paid ${dollars(paid)}`} /> : null}
      </div>
      <div className="row between t-foot num">
        <span>{dollars(p10)}</span>
        <span>{p10 === p90 ? `one price, ${dollars(median)}` : `most shops ${dollars(p10)}–${dollars(p90)}`}</span>
        <span>{dollars(p90)}</span>
      </div>
    </div>
  );
}

export function Stat({ label, value, delta, deltaDir, hint }: { label: string; value: ReactNode; delta?: string; deltaDir?: 'up' | 'down' | 'flat'; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="t-label">{label}</span>
      <span className="value">{value}</span>
      {delta ? <span className={`delta ${deltaDir === 'up' ? 'up' : deltaDir === 'down' ? 'down' : 'muted'}`}>{delta}</span> : null}
      {hint ? <span className="t-foot">{hint}</span> : null}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error" role="alert">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="feature"><span className="icon-badge"><Icon name={icon} size={20} /></span></span>
      <span className="t-section" style={{ color: 'var(--ink)' }}>{title}</span>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="stack" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="skeleton" style={{ height: 22, width: '40%' }} />
      <div className="skeleton" style={{ height: 160 }} />
      <div className="skeleton" style={{ height: 22, width: '70%' }} />
    </div>
  );
}
