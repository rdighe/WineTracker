import { describe, expect, it } from 'vitest';
import { lwinRow } from '../src/catalog/lwin.js';

const row = (o: Record<string, unknown>) => ({
  lwin: 1000001.0, status: 'Live', display_name: '', producer_title: 'NA', producer_name: 'NA', wine: 'NA', country: 'France',
  region: 'NA', sub_region: 'NA', site: 'NA', parcel: 'NA', colour: 'Red', type: 'Wine', sub_type: 'Still', classification: 'NA', ...o,
});

describe('lwinRow', () => {
  it('treats NA as empty and reads float LWINs', () => {
    expect(
      lwinRow(row({ lwin: 1005934.0, display_name: "Chateau d'Agassac, Haut-Medoc", producer_title: 'Chateau', producer_name: "d'Agassac", region: 'Bordeaux', sub_region: 'Haut-Medoc' }))
    ).toMatchObject({ lwin: '1005934', producer: "Chateau d'Agassac", name: '', sub_region: 'Haut-Medoc', classification: '', display_name: "Chateau d'Agassac, Haut-Medoc" });
  });
  it('builds the name from wine, site and parcel', () => {
    expect(lwinRow(row({ producer_name: 'Bertrand Ambroise', sub_region: 'Beaune', site: 'Les Perrieres', classification: 'Premier Cru' }))).toMatchObject({
      producer: 'Bertrand Ambroise', name: 'Les Perrieres', sub_region: 'Beaune', classification: 'Premier Cru',
    });
    expect(lwinRow(row({ producer_name: 'Thierry Allemand', wine: 'Chaillot', sub_region: 'Cornas' }))?.name).toBe('Chaillot');
  });
  it('skips non-live rows and spirits', () => {
    expect(lwinRow(row({ producer_name: 'X', status: 'Combined' }))).toBeNull();
    expect(lwinRow(row({ producer_name: 'X', type: 'Spirit', sub_type: 'Whiskies' }))).toBeNull();
    expect(lwinRow(row({ lwin: 12, producer_name: 'X' }))).toBeNull();
  });
  it('detects sparkling and fortified', () => {
    expect(lwinRow(row({ producer_name: 'Krug', wine: 'Grande Cuvee', sub_type: 'Sparkling', colour: 'White' }))?.wine_type).toBe('sparkling');
    expect(lwinRow(row({ producer_name: 'Taylor', wine: 'Vintage Port', type: 'Fortified Wine', sub_type: 'Port' }))?.wine_type).toBe('fortified');
  });
});
