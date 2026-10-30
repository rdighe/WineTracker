/**
 * A wine's fit for the person (lib/types.ts Fit): "85% · Strong fit" and how
 * confident that is, as three small bars. Never a predicted star rating, and
 * never how it was worked out.
 */
import { Text, View } from 'react-native';
import type { Fit } from '../lib/types';
import { radius, space, type, useTheme } from './ui';

export const BAND: Record<Fit['band'], string> = { strong: 'Strong fit', good: 'Good fit', maybe: 'Could go either way', unlikely: 'Probably not your style' };
const CONFIDENCE: Record<Fit['confidence'], string> = { high: 'high confidence', medium: 'some confidence', low: 'an early read' };
const BARS: Record<Fit['confidence'], number> = { high: 3, medium: 2, low: 1 };

export function fitWords(f: Fit): string {
  return `${f.percent !== null ? `${f.percent}% fit, ` : ''}${BAND[f.band].toLowerCase()}, ${CONFIDENCE[f.confidence]}.`;
}

export function FitBadge({ fit, compact }: { fit: Fit | null | undefined; compact?: boolean }) {
  const { c } = useTheme();
  if (!fit) return null;
  const tone = fit.band === 'strong' || fit.band === 'good' ? c.positive : fit.band === 'maybe' ? c.ink2 : c.ink3;
  return (
    <View accessible accessibilityLabel={fitWords(fit)} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: space[2], paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
      {fit.percent !== null ? <Text style={[type.footnote, type.tabular, { fontWeight: '700', color: tone }]}>{`${fit.percent}%`}</Text> : null}
      <Text style={[type.footnote, { fontWeight: '600', color: c.ink }]} numberOfLines={1}>{compact && fit.percent !== null ? 'fit' : BAND[fit.band]}</Text>
      {/* Confidence: three bars, filled as far as the fit can be leaned on. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 11 }}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ width: 3, height: 4 + i * 2.5, borderRadius: 1, backgroundColor: i <= BARS[fit.confidence] ? tone : c.hairline }} />
        ))}
      </View>
    </View>
  );
}
