import { describe, expect, it } from 'vitest';
import { editDistance, identityTokens, normalize, tokensMatch } from '../src/lib/normalize.js';

describe('normalize', () => {
  it('strips accents, case and punctuation, expands abbreviations', () => {
    expect(normalize('Château Lynch-Bages')).toBe('chateau lynch bages');
    expect(normalize('CH. LYNCH BAGES')).toBe('chateau lynch bages');
    expect(normalize('St. Supéry Cab. Sauv.')).toBe('saint supery cabernet sauvignon');
    expect(normalize("Château d'Yquem")).toBe('chateau dyquem');
    expect(normalize('Moët & Chandon')).toBe('moet and chandon');
  });
  it('keeps decimal sizes intact', () => {
    expect(normalize('Magnum 1.5L')).toBe('magnum 1.5l');
  });
});

describe('identityTokens', () => {
  it('drops stopwords, descriptors, years and sizes', () => {
    expect(identityTokens('Château Margaux 2015 Red Wine 750ml')).toEqual(['margaux']);
    expect(identityTokens('Domaine de la Romanée-Conti La Tâche')).toEqual(['romanee', 'conti', 'tache']);
  });
});

describe('tokensMatch', () => {
  it('tolerates a single typo on longer words only', () => {
    expect(tokensMatch('montelena', 'montelana')).toBe(true);
    expect(tokensMatch('chardonay', 'chardonnay')).toBe(true);
    expect(tokensMatch('justin', 'austin')).toBe(false);
    expect(tokensMatch('rioja', 'riojas')).toBe(false);
    expect(tokensMatch('cos', 'cas')).toBe(false);
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
  });

  it('keeps numbered cuvees as one word', () => {
    expect(normalize('N°2, Domaine Lafleur')).toBe('no2 domaine lafleur');
    expect(normalize('Nº 2 de Lafleur')).toBe('no2 de lafleur');
    expect(identityTokens('N°2, Lafleur, Pomerol')).toContain('no2');
  });
});
