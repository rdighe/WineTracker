/** Line icons (24px grid, stroke) used across the app. */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { color: string; size?: number; strokeWidth?: number };

const base = (size = 22) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const });

export function ScanIcon({ color, size, strokeWidth = 1.7 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
    </Svg>
  );
}

export function GlassIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 3h8l-1 6a3 3 0 0 1-3 3 3 3 0 0 1-3-3L8 3zM12 12v8M8 21h8" />
    </Svg>
  );
}

export function SparkleIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
      <Path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />
    </Svg>
  );
}

export function SearchIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M20 20l-4.2-4.2" />
    </Svg>
  );
}

export function PhotosIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="4" width="18" height="16" rx="3" />
      <Circle cx="9" cy="10" r="2" />
      <Path d="M21 16l-5-5-9 9" />
    </Svg>
  );
}

export function DocumentIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <Path d="M14 3v5h5M9 13h6M9 17h4" />
    </Svg>
  );
}

export function BackIcon({ color, size = 18, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function CheckIcon({ color, size = 13, strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function BookmarkIcon({ color, size = 18, filled }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.6} strokeLinejoin="round">
      <Path d="M6 3h12v18l-6-4-6 4V3z" />
    </Svg>
  );
}

export function PlusIcon({ color, size, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** A wine bottle: the cellar. */
export function BottleIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10 2.5h4M10.5 2.5v4.2c0 .9-.6 1.5-1.4 2.1C8 9.6 7.5 10.6 7.5 12v8a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-8c0-1.4-.5-2.4-1.6-3.2-.8-.6-1.4-1.2-1.4-2.1V2.5M7.5 14h9" />
    </Svg>
  );
}

export function ChevronIcon({ color, size = 16, strokeWidth = 1.8, direction = 'right' }: IconProps & { direction?: 'right' | 'down' | 'up' }) {
  const d = { right: 'M9.5 6l6 6-6 6', down: 'M6 9.5l6 6 6-6', up: 'M6 14.5l6-6 6 6' }[direction];
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

export function RefreshIcon({ color, size = 16, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
    </Svg>
  );
}

export function FilterIcon({ color, size = 16, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M4 6h16M7 12h10M10 18h4" />
    </Svg>
  );
}

export function GearIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function PinIcon({ color, size, strokeWidth = 1.7 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <Circle cx="12" cy="10" r="2.3" />
    </Svg>
  );
}

export function ListIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="3" width="14" height="18" rx="2" />
      <Path d="M8.5 8h5M8.5 12h5M8.5 16h5M16 8h0M16 12h0M16 16h0" />
    </Svg>
  );
}

export function ShelfIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 20h18M3 11h18" />
      <Path d="M6 11V6.5a1.5 1.5 0 0 1 3 0V11M11 11V5a1.5 1.5 0 0 1 3 0v6M16 11V7.5a1.5 1.5 0 0 1 3 0V11M6 20v-5.5a1.5 1.5 0 0 1 3 0V20M12 20v-4.5a1.5 1.5 0 0 1 3 0V20" />
    </Svg>
  );
}

export function HomeIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z" />
    </Svg>
  );
}

export function BookIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6" />
    </Svg>
  );
}

export function StoreIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9.5 20v-6h5v6" />
    </Svg>
  );
}

/** A rack seen from the front: bottle ends in a grid. */
export function RackIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Circle cx="8" cy="9" r="1.8" />
      <Circle cx="16" cy="9" r="1.8" />
      <Circle cx="8" cy="15" r="1.8" />
      <Circle cx="16" cy="15" r="1.8" />
    </Svg>
  );
}

export function PeopleIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="9" cy="8" r="3.2" />
      <Path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.8c1.8.6 3 2.2 3.5 4.7" />
    </Svg>
  );
}

export function ShareIcon({ color, size, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V3.5M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
    </Svg>
  );
}

/** Google's "G", in its own colors (for the sign-in button). */
export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}
