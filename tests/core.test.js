import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIFTS, shiftByCode, dateKey, monthCells, monthTitle, isEmptyDay, validateBackup, parseShiftLine } from '../core.js';

test('shift table matches spec', () => {
  assert.deepEqual(SHIFTS.map(s => s.code),
    ['DL','M','M1','A1','A','AO','A2','N','N1','N2','X','AL','BL','RPH','PH','TN']);
  assert.deepEqual(shiftByCode('N2'), { code:'N2', in:'17:00', out:'02:00', group:'n' });
  assert.deepEqual(shiftByCode('AO'), { code:'AO', in:'11:00', out:'22:00', group:'a' });
  assert.equal(shiftByCode('X').in, '');
  assert.equal(shiftByCode('ZZ'), undefined);
});
test('dateKey pads', () => assert.equal(dateKey(2026, 0, 5), '2026-01-05'));
test('monthCells Nov 2026 starts Sunday, 30 days', () => {
  const c = monthCells(2026, 10);
  assert.equal(c.length, 35); assert.equal(c[0], 1); assert.equal(c[29], 30); assert.equal(c[30], null);
});
test('monthCells Dec 2026 starts Tuesday', () => {
  const c = monthCells(2026, 11);
  assert.deepEqual(c.slice(0, 3), [null, null, 1]); assert.equal(c.filter(Boolean).length, 31);
});
test('monthCells Feb 2028 leap', () => assert.equal(monthCells(2028, 1).filter(Boolean).length, 29));
test('monthTitle', () => assert.equal(monthTitle(2026, 10), 'พฤศจิกายน 2026'));
test('isEmptyDay', () => {
  assert.equal(isEmptyDay({ date:'x', shift:'', in:'', out:'', note:'', photos:[] }), true);
  assert.equal(isEmptyDay({ date:'x', shift:'', in:'', out:'', note:' ', photos:[] }), true);
  assert.equal(isEmptyDay({ date:'x', shift:'N', in:'', out:'', note:'', photos:[] }), false);
  assert.equal(isEmptyDay({ date:'x', shift:'', in:'', out:'', note:'', photos:[{}] }), false);
});
test('parseShiftLine: spaces, commas, newlines, lower case', () => {
  assert.deepEqual(parseShiftLine(' a2 N,x\nrph  n2 '), { items: ['A2', 'N', 'X', 'RPH', 'N2'], unknown: [] });
});
test('parseShiftLine: tabs keep empty cells as skipped days', () => {
  assert.deepEqual(parseShiftLine('N\t\tM\t-\tX'), { items: ['N', null, 'M', null, 'X'], unknown: [] });
});
test('parseShiftLine: unknown codes reported, empty input', () => {
  assert.deepEqual(parseShiftLine('N Q7 M zz'), { items: ['N', null, 'M', null], unknown: ['Q7', 'ZZ'] });
  assert.deepEqual(parseShiftLine('   '), { items: [], unknown: [] });
});
test('stickers: count as content, validated in backups, optional for old backups', () => {
  assert.equal(isEmptyDay({ date:'x', shift:'', in:'', out:'', note:'', photos:[], sticker:'heart' }), false);
  const day = s => ({ app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'', in:'', out:'', note:'', photos:[], ...s }] });
  assert.equal(validateBackup(day({ sticker:'heart' })).ok, true);
  assert.equal(validateBackup(day({ sticker:'' })).ok, true);
  assert.equal(validateBackup(day({})).ok, true);
  assert.equal(validateBackup(day({ sticker:'<img>' })).ok, false);
  assert.equal(validateBackup(day({ sticker:5 })).ok, false);
});
test('validateBackup accepts valid', () => {
  const r = validateBackup({ app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'N', in:'', out:'', note:'a', photos:[] }] });
  assert.equal(r.ok, true); assert.equal(r.days.length, 1);
});
test('validateBackup rejects bad input', () => {
  for (const bad of [null, 5, [], {}, { app:'other', version:1, days:[] }, { app:'shiftcal', version:1, days:'x' },
    { app:'shiftcal', version:1, days:[{ date:'19/11/2026' }] },
    { app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'ZZ', in:'', out:'', note:'', photos:[] }] },
    { app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'', in:'', out:'', note:5, photos:[] }] },
    { app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'', in:'25:99x', out:'', note:'', photos:[] }] },
    { app:'shiftcal', version:1, days:[{ date:'2026-11-19', shift:'', in:'', out:'', note:'', photos:['http://x/a.jpg'] }] }])
    assert.equal(validateBackup(bad).ok, false, JSON.stringify(bad));
});
