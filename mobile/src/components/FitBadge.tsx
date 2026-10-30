/**
 * A wine's fit for the person (lib/types.ts Fit): "85% fit" in the band's
 * words, and whether Jev agrees. Never a predicted star rating: a percentage
 * in steps of 5 and a band say as much as the model knows.
 */
import { Text, View } from 'react-native';
import type { Fit } from '../lib/types';
import { CheckIcon } from './icons';
import { radius, space, type, useTheme } from './ui';

export const BAND: Record<Fit['band'], string> = { strong: 'Strong fit', good: 'Good fit', maybe: 'Could go either way', unlikely: 'Probably not your style' };

export function fitWords(f: Fit): string {
  const jev = f.jev === 'agrees' ? ' Jev agrees.' : f.jev === 'unsure' ? " Jev isn't sure." : '';
  return `${f.percent !== null ? `${f.percent}% fit, ` : ''}${BAND[f.band].toLowerCase()}, from ${f.basis} ${f.basis === 1 ? 'rating' : 'ratings'}.${jev}`;
}

export function FitBadge({ fit, compact }: { fit: Fit | null | undefined; compact?: boolean }) {
  const { c } = useTheme();
  if (!fit) return null;
  const tone = fit.band === 'strong' || fit.band === 'good' ? c.positive : fit.band === 'maybe' ? c.ink2 : c.ink3;
  return (
    <View accessibilityLabel={fitWords(fit)} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[2], paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
        {fit.percent !== null ? <Text style={[type.footnote, type.tabular, { fontWeight: '700', color: tone }]}>{`${fit.percent}%`}</Text> : null}
        <Text style={[type.footnote, { fontWeight: '600', color: c.ink }]}>{compact && fit.percent !== null ? 'fit' : BAND[fit.band]}</Text>
      </View>
      {fit.jev ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {fit.jev === 'agrees' ? <CheckIcon color={c.positive} size={12} /> : null}
          <Text style={[type.footnote, { color: fit.jev === 'agrees' ? c.positive : c.caution }]}>{fit.jev === 'agrees' ? 'Jev agrees' : "Jev isn't sure"}</Text>
        </View>
      ) : null}
    </View>
  );
}
