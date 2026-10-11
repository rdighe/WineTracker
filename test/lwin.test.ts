import { describe, expect, it } from 'vitest';
import { lwinRow } from '../src/catalog/lwin.js';

describe('lwinRow', () => {
  it('maps a live wine row', () => {
    expect(
      lwinRow({ lwin: '1012361', status: 'Live', display_name: 'Chateau Lynch Bages, Pauillac', producer_title: 'Chateau', producer_name: 'Lynch Bages', wine: '', country: 'France', region: 'Bordeaux', sub_region: 'Pauillac', colour: 'Red', type: 'Wine', sub_type: 'Still', classification: '5eme Cru Classe' })
    ).toMatchObject({ lwin: '1012361', producer: 'Chateau Lynch Bages', name: '', display_name: 'Chateau Lynch Bages, Pauillac', colour: 'red', wine_type: 'still', source: 'lwin' });
  });
  it('skips deleted rows, spirits and short ids', () => {
    expect(lwinRow({ lwin: '1012361', status: 'Deleted', producer_name: 'X' })).toBeNull();
    expect(lwinRow({ lwin: '1012361', status: 'Live', producer_name: 'X', type: 'Spirit' })).toBeNull();
    expect(lwinRow({ lwin: '12', producer_name: 'X' })).toBeNull();
  });
  it('detects sparkling and fortified', () => {
    expect(lwinRow({ lwin: '1000001', producer_name: 'Krug', wine: 'Grande Cuvee', type: 'Wine', sub_type: 'Sparkling', colour: 'White' })?.wine_type).toBe('sparkling');
    expect(lwinRow({ lwin: '1000002', producer_name: 'Taylor', wine: 'Vintage Port', type: 'Fortified Wine', colour: 'Red' })?.wine_type).toBe('fortified');
  });
});
