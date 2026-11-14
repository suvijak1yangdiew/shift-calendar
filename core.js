// Pure logic: no DOM, no storage. Tested with `npm test`.

const s = (code, i, o, group) => ({ code, in: i, out: o, group });
export const SHIFTS = [
  s('DL', '08:00', '17:00', 'm'), s('M', '09:00', '18:00', 'm'), s('M1', '09:30', '18:30', 'm'),
  s('A1', '10:00', '19:00', 'a'), s('A', '11:00', '20:00', 'a'), s('AO', '11:00', '22:00', 'a'), s('A2', '12:00', '21:00', 'a'),
  s('N', '13:00', '22:00', 'n'), s('N1', '13:30', '22:30', 'n'), s('N2', '17:00', '02:00', 'n'),
  ...['X', 'AL', 'BL', 'RPH', 'PH', 'TN'].map(c => s(c, '', '', 'x')),
];

export const shiftByCode = code => SHIFTS.find(x => x.code === code);

const pad = n => String(n).padStart(2, '0');
export const dateKey = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

// Sunday-first cells; null = blank cell.
export function monthCells(y, m0) {
  const lead = new Date(y, m0, 1).getDay();
  const days = new Date(y, m0 + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthTitle = (y, m0) => `${MONTHS[m0]} ${y}`;

export const isEmptyDay = r =>
  !r.shift && !r.in && !r.out && !(r.note || '').trim() && !(r.photos && r.photos.length);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const okTime = t => t === '' || (typeof t === 'string' && TIME.test(t));

export function validateBackup(obj) {
  const bad = error => ({ ok: false, error });
  if (!obj || typeof obj !== 'object' || obj.app !== 'shiftcal' || obj.version !== 1) return bad('not a shiftcal backup');
  if (!Array.isArray(obj.days)) return bad('days missing');
  for (const d of obj.days) {
    if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('bad date');
    if (d.shift !== '' && !shiftByCode(d.shift)) return bad('bad shift');
    if (!okTime(d.in) || !okTime(d.out)) return bad('bad time');
    if (typeof d.note !== 'string') return bad('bad note');
    if (!Array.isArray(d.photos) || !d.photos.every(p => typeof p === 'string' && p.startsWith('data:image/'))) return bad('bad photos');
  }
  return { ok: true, days: obj.days };
}
