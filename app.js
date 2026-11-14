import { SHIFTS, shiftByCode, dateKey, monthCells, monthTitle, MONTHS, isEmptyDay, validateBackup } from './core.js';

const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const DOW_S = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MON_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const $ = (sel, root = document) => root.querySelector(sel);
const pad = n => String(n).padStart(2, '0');

// User text only ever goes through textContent / .value here — never innerHTML.
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(k => k != null));
  return n;
}

let toastTimer;
function toast(msg) {
  $('#toast').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 3500);
}

// ---------- storage (IndexedDB, one record per day) ----------
// Photos are stored as JPEG data URLs, not Blobs: same shape as the backup file,
// and avoids iOS WebKit's history of Blob-in-IndexedDB failures.
let dbp;
const db = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('shiftcal', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('days', { keyPath: 'date' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('days', mode);
    const req = fn(t.objectStore('days'));
    t.oncomplete = () => res(req?.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const blank = date => ({ date, shift: '', in: '', out: '', note: '', photos: [] });
const getDay = async date => (await tx('readonly', s => s.get(date))) || blank(date);
async function putDay(rec) {
  try {
    await tx('readwrite', s => (isEmptyDay(rec) ? s.delete(rec.date) : s.put(rec)));
    return true;
  } catch {
    toast('บันทึกไม่สำเร็จ พื้นที่เก็บข้อมูลอาจเต็ม');
    return false;
  }
}
const allDays = () => tx('readonly', s => s.getAll());
const monthDays = (y, m0) => {
  const ym = dateKey(y, m0, 1).slice(0, 8);
  return tx('readonly', s => s.getAll(IDBKeyRange.bound(ym + '01', ym + '31')));
};
// One transaction: if any put fails the clear is rolled back too.
const replaceAll = days => tx('readwrite', s => { s.clear(); days.forEach(d => s.put(d)); });

// ---------- state ----------
const todayKey = () => { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); };
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return [y, m - 1, d]; };
const now = new Date();
const state = { today: todayKey(), y: now.getFullYear(), m0: now.getMonth(), quick: false, quickCode: undefined };
let pending = null; // debounced save not yet written

// ---------- images ----------
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    img.src = url;
  });
}

function openViewer(src, onDelete) {
  const v = $('#viewer');
  $('img', v).src = src;
  $('#viewerDel').onclick = () => {
    if (confirm('ลบภาพนี้ใช่ไหม')) { onDelete(); v.close(); }
  };
  v.showModal();
}

// ---------- day card (used for "today" and for the day sheet) ----------
async function renderDayCard(box, date, onChange = () => {}) {
  const rec = await getDay(date);
  const [y, m0, d] = parseKey(date);
  const dow = new Date(y, m0, d).getDay();

  const status = el('div', { class: 'sv' });
  let timer;
  const save = async () => {
    clearTimeout(timer);
    pending = null;
    const ok = await putDay(rec);
    status.textContent = ok ? 'บันทึกแล้ว ✓' : 'ยังไม่ได้บันทึก';
    if (ok) onChange();
    return ok;
  };
  const later = () => {
    status.textContent = 'กำลังบันทึก…';
    clearTimeout(timer);
    pending = save;
    timer = setTimeout(save, 400);
  };

  // shift
  const chip = el('button', { type: 'button' });
  const picker = el('div', { class: 'picker', hidden: true });
  const paintChip = () => {
    const sh = shiftByCode(rec.shift);
    chip.className = 'chip big ' + (sh ? sh.group : 'none');
    chip.replaceChildren(sh ? sh.code : '+ กะ');
    if (sh?.in) chip.append(el('small', { textContent: `${sh.in}–${sh.out}` }));
    chip.setAttribute('aria-label', sh ? `กะ ${sh.code} แตะเพื่อเปลี่ยน` : 'เลือกกะ');
  };
  const pick = code => { rec.shift = code; paintChip(); picker.hidden = true; save(); };
  picker.append(
    ...SHIFTS.map(sh => el('button', { type: 'button', class: 'chip ' + sh.group, textContent: sh.code, onclick: () => pick(sh.code) })),
    el('button', { type: 'button', class: 'chip none', textContent: 'ไม่ระบุ', onclick: () => pick('') }),
  );
  chip.addEventListener('click', () => { picker.hidden = !picker.hidden; });
  paintChip();

  // actual clock in / out — optional, fill any time
  const timeField = (label, key) => {
    const id = `t-${key}-${date}-${box.id}`;
    const input = el('input', { type: 'time', id, value: rec[key] });
    const nowBtn = el('button', { type: 'button', class: 'now', textContent: 'ตอนนี้', hidden: !!rec[key] });
    nowBtn.setAttribute('aria-label', `ใส่เวลา${label}เป็นตอนนี้`);
    input.addEventListener('change', () => { rec[key] = input.value; nowBtn.hidden = !!rec[key]; save(); });
    nowBtn.addEventListener('click', () => {
      const t = new Date();
      input.value = rec[key] = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
      nowBtn.hidden = true;
      save();
    });
    return el('div', { class: 'tf' }, el('label', { htmlFor: id }, label, input), nowBtn);
  };

  // note
  const note = el('textarea', { value: rec.note, rows: 3, placeholder: 'จดงานที่ทำ…' });
  note.setAttribute('aria-label', 'บันทึก');
  const grow = () => { note.style.height = 'auto'; note.style.height = note.scrollHeight + 'px'; };
  note.addEventListener('input', () => { rec.note = note.value; grow(); later(); });
  note.addEventListener('change', save);

  // photos
  const photos = el('div', { class: 'im' });
  const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const paintPhotos = () => photos.replaceChildren(
    ...rec.photos.map((src, i) => el('button', {
      type: 'button', class: 'pic', 'aria-label': `ดูภาพที่ ${i + 1}`,
      onclick: () => openViewer(src, () => { rec.photos.splice(rec.photos.indexOf(src), 1); paintPhotos(); save(); }),
    }, el('img', { src, alt: '' }))),
    el('button', { type: 'button', class: 'pic add', textContent: '+ ภาพ', onclick: () => file.click() }),
    file,
  );
  file.addEventListener('change', async () => {
    const before = rec.photos.length;
    for (const f of file.files) {
      try { rec.photos.push(await shrinkImage(f)); } catch { toast('เปิดภาพนี้ไม่ได้'); }
    }
    file.value = '';
    if (rec.photos.length === before) return;
    if (!(await save())) rec.photos.length = before; // storage full: keep the day as it was saved
    paintPhotos();
  });
  paintPhotos();

  box.replaceChildren(
    el('div', { class: 'th-row' },
      date === state.today
        ? el('h1', {}, 'วันนี้', el('small', { textContent: `${DOW[dow]} ${d} ${MON_S[m0]} ${y}` }))
        : el('h1', {}, `${d} ${MON_S[m0]}`, el('small', { textContent: `วัน${DOW[dow]} ${y}` })),
      chip),
    picker,
    el('div', { class: 'tm' }, timeField('เข้างาน', 'in'), timeField('ออกงาน', 'out')),
    note, photos, status,
  );
  grow();
}

// ---------- month grid + notes list ----------
let seq = 0;
async function renderMonth() {
  const my = ++seq;
  const { y, m0 } = state;
  const days = await monthDays(y, m0);
  if (my !== seq) return; // a newer render started
  const by = new Map(days.map(r => [r.date, r]));
  $('#title').textContent = monthTitle(y, m0);

  $('#grid').replaceChildren(
    ...DOW_S.map((t, i) => el('div', { class: 'h' + (i ? '' : ' su'), textContent: t })),
    ...monthCells(y, m0).map((d, i) => {
      if (!d) return el('div', { class: 'c' });
      const key = dateKey(y, m0, d);
      const r = by.get(key);
      const sh = r && shiftByCode(r.shift);
      const text = r?.note.trim();
      return el('button', {
        type: 'button',
        class: 'c' + (i % 7 ? '' : ' su') + (key === state.today ? ' td' : ''),
        'aria-label': [`${DOW[i % 7]} ${d} ${MONTHS[m0]}`, sh && `กะ ${sh.code}`, text, r?.photos.length && `${r.photos.length} ภาพ`].filter(Boolean).join(', '),
        onclick: () => tapDay(key),
      },
        el('span', { class: 'num', textContent: d }),
        r?.photos.length ? el('span', { class: 'ph' }) : null,
        sh ? el('b', { class: sh.group, textContent: sh.code }) : null,
        text ? el('p', { textContent: text }) : null);
    }),
  );

  const noted = days.filter(r => r.note.trim() || r.photos.length);
  $('#noteCount').textContent = noted.length ? `${noted.length} วัน` : '';
  $('#notes').replaceChildren(...(noted.length ? noted.map(r => {
    const [, , d] = parseKey(r.date);
    const sh = shiftByCode(r.shift);
    const times = r.in || r.out ? `เข้า ${r.in || '–'} · ออก ${r.out || '–'}` : sh?.in ? `${sh.in}–${sh.out}` : '';
    return el('button', { type: 'button', class: 'r', onclick: () => openSheet(r.date) },
      el('span', { class: 'd' }, el('strong', { textContent: d }), el('small', { textContent: DOW_S[new Date(state.y, state.m0, d).getDay()] + '.' })),
      el('span', { class: 't' },
        sh || times ? el('span', { class: 'meta' }, sh ? el('b', { class: sh.group, textContent: sh.code }) : null, times) : null,
        r.note.trim(),
        r.photos.length ? el('span', { class: 'im' }, ...r.photos.map(src => el('span', { class: 'pic' }, el('img', { src, alt: '' })))) : null));
  }) : [el('p', { class: 'empty', textContent: 'ยังไม่มีบันทึกในเดือนนี้' })]));
}

async function tapDay(key) {
  if (!state.quick) return openSheet(key);
  if (state.quickCode === undefined) return toast('เลือกกะก่อน แล้วค่อยแตะวัน');
  const rec = await getDay(key);
  rec.shift = state.quickCode;
  if (!(await putDay(rec))) return;
  renderMonth();
  if (key === state.today) renderDayCard($('#today'), state.today, renderMonth);
}

async function openSheet(key) {
  await pending?.();
  await renderDayCard($('#sheetBody'), key, renderMonth);
  $('#sheet').showModal();
}

function setQuick(on) {
  state.quick = on;
  state.quickCode = undefined;
  $('#quickBar').hidden = !on;
  $('#quickOpen').hidden = on;
  for (const b of $('#quickChips').children) b.classList.remove('sel');
}

// ---------- backup ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const store = { // localStorage can throw in private mode
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* cosmetic only */ } },
};

function renderBackupLine() {
  const last = store.get('lastBackup');
  const line = $('#backupLine');
  if (!last) { line.textContent = 'ยังไม่เคยสำรองข้อมูล'; line.className = ''; return; }
  const n = Math.floor((Date.now() - new Date(last)) / 86400000);
  line.textContent = n ? `สำรองล่าสุด ${n} วันก่อน` : 'สำรองล่าสุดวันนี้';
  line.className = n > 14 ? 'warn' : '';
}

async function exportData() {
  await pending?.();
  const name = `shiftcal-${state.today}.json`;
  try {
    const days = await allDays();
    const file = new File([JSON.stringify({ app: 'shiftcal', version: 1, exportedAt: new Date().toISOString(), days })], name, { type: 'application/json' });
    // iOS home-screen apps cannot download files; the share sheet ("Save to Files") can.
    if (isIOS && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else {
      const a = el('a', { href: URL.createObjectURL(file), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast('สำรองข้อมูลไม่สำเร็จ');
    return;
  }
  store.set('lastBackup', new Date().toISOString());
  renderBackupLine();
}

async function importData(file) {
  let obj = null;
  try { obj = JSON.parse(await file.text()); } catch { /* handled by validateBackup */ }
  const r = validateBackup(obj);
  if (!r.ok) return toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
  if (!confirm(`ข้อมูลในเครื่องนี้ทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์ (${r.days.length} วัน) ทำต่อไหม`)) return;
  try {
    await replaceAll(r.days.map(d => ({ date: d.date, shift: d.shift, in: d.in, out: d.out, note: d.note, photos: d.photos })));
    toast('นำเข้าข้อมูลแล้ว');
  } catch {
    toast('นำเข้าไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ');
  }
  refresh();
}

// ---------- wiring ----------
async function refresh() {
  state.today = todayKey();
  await renderDayCard($('#today'), state.today, renderMonth);
  await renderMonth();
  renderBackupLine();
}

function shiftMonth(delta) {
  const d = new Date(state.y, state.m0 + delta, 1);
  state.y = d.getFullYear(); state.m0 = d.getMonth();
  renderMonth();
}
$('#prev').onclick = () => shiftMonth(-1);
$('#next').onclick = () => shiftMonth(1);
$('#goToday').onclick = () => { const [y, m0] = parseKey(state.today); state.y = y; state.m0 = m0; renderMonth(); };

$('#quickChips').append(...[...SHIFTS.map(s => [s.code, s.code, s.group]), ['', 'ลบกะ', 'none']].map(([code, label, cls]) =>
  el('button', {
    type: 'button', class: 'chip ' + cls, textContent: label,
    onclick: e => {
      state.quickCode = code;
      for (const b of $('#quickChips').children) b.classList.toggle('sel', b === e.currentTarget);
    },
  })));
$('#quickOpen').onclick = () => setQuick(true);
$('#quickDone').onclick = () => setQuick(false);

$('#sheetClose').onclick = () => $('#sheet').close();
$('#sheet').addEventListener('close', async () => { await pending?.(); refresh(); });
$('#viewerClose').onclick = () => $('#viewer').close();

$('#exportBtn').onclick = exportData;
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importData(f); };

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pending?.();
  else if (todayKey() !== state.today && !$('#sheet').open) refresh(); // app left open past midnight
});

$('#hint').hidden = !(isIOS && !navigator.standalone);
navigator.storage?.persist?.();
refresh().catch(() => toast('เปิดที่เก็บข้อมูลไม่ได้ ลองปิดโหมดส่วนตัวของเบราว์เซอร์'));
