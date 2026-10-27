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
