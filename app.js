// 75 Hard: shared tracker for two people, live-synced through Supabase.
const SB_URL = 'https://zwvgmrutbussrpbjfwmj.supabase.co';
// Public "anon" key: safe to ship in the page. Row Level Security in the database does the protecting.
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dmdtcnV0YnVzc3JwYmpmd21qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MDY3NjYsImV4cCI6MjEwODk4Mjc2Nn0.VdMrWr_2wtSZCa54abM5jnmEWIZ3NB3hPuMqIYN0Pxc';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const WLEN = 45 * 60e3, GAP = 3 * 3600e3, WATER = 128;
const COLORS = { indoor: '#ff3b30', outdoor: '#ffd60a', water: '#0a84ff', reading: '#30d158', photo: '#f2f2f7' };   // Traffic control, with neon glow
const WATERBLUE = '#0a84ff';
const RCOL = COLORS;
const NAMES = { indoor: 'Indoor', outdoor: 'Outdoor', water: 'Water', reading: 'Reading', photo: 'Photo' };
const MSGS = [
  'Look at you. Every box closed. That is what showing up looks like.',
  "Another day done. Tomorrow's version of you says thank you.",
  'You did the hard thing again. That is the whole game.',
  'Rings closed. Water drunk. Pages read. Proud of you.',
  'Quiet discipline wins. You just proved it again.'
];
const MILE = {
  1: 'Day 1 done. The hardest step is behind you.',
  25: 'Day 25. A third of the way, and you are not the same person who started.',
  50: 'Day 50. Two thirds done. Nothing about this is accidental.',
  75: 'Day 75. You finished what you said you would. Go be proud.'
};
const NT = [['10 am', "First jug time. Let's get ahead of the day."], ['12 pm', "Halfway through the day. Where's jug number two?"], ['2 pm', 'Afternoon check-in. Sip, sip, sip.'], ['4 pm', "Two hours to go. You've got this."], ['6 pm', null]];
const DAYN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const CHECKS = [10, 20, 30, 40, 50, 60, 70, 75];

// ---------- dates ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
const pretty = s => parseYmd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
let TD = ymd(new Date());

// ---------- state ----------
const S = { tab: 'today', view: 'me', user: null, me: null, wtype: {}, ovr: {}, nIdx: 0, urls: {}, dirty: false, restartSnooze: false, authMode: 'in', busy: false };
const D = { detail: {}, plans: {}, profiles: [], daily: {}, workouts: {}, books: {}, weigh: {}, groceries: [], meals: {}, sets: {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const dkey = (u, d) => u + '|' + d;
const me = () => S.me;
const partner = () => D.profiles.find(p => p.id !== S.me?.id) || null;
const viewed = () => (S.view === 'partner' && partner()) ? partner() : S.me;
// On the wide (iPad) screen either profile can be logged for, whoever is signed in; on phones only your own.
const WIDE = () => window.innerWidth >= 768;
const canEdit = id => !!id && (id === S.me?.id || WIDE());
const actor = () => (S.me && WIDE() && S.view === 'partner' && partner()) ? partner() : S.me;
const editable = () => canEdit(viewed()?.id);

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500); }
async function must(p) { const r = await p; if (r.error) { toast(r.error.message); throw r.error; } return r.data; }

// ---------- data ----------
// The database hands back at most 1000 rows per request, so fetch the lift log in pages.
async function allSets() {
  let out = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('lift_sets').select('*').order('created_at').order('id').range(from, from + 999);
    if (r.error) return r;
    out = out.concat(r.data); if (r.data.length < 1000) break;
  }
  return { data: out, error: null };
}
async function loadAll() {
  const [p, d, w, b, wi, g, m, lf, wp, fp, ml, sm] = await Promise.all([
    sb.from('profiles').select('*'), sb.from('daily').select('*'), sb.from('workouts').select('*'),
    sb.from('books').select('*').order('created_at'), sb.from('weigh_ins').select('*').order('day_num'),
    sb.from('groceries').select('*').order('created_at'), sb.from('meal_plan').select('*'), allSets(), sb.from('workout_plans').select('*'), sb.from('fun_photos').select('*').order('created_at', { ascending: false }), sb.from('meal_log').select('*').order('created_at'), sb.from('saved_meals').select('*').order('created_at', { ascending: false })
  ]);
  for (const r of [p, d, w, b, wi, g, m, lf, wp, fp, ml, sm]) if (r.error) { toast(r.error.message); return; }
  D.profiles = p.data;
  D.daily = {}; d.data.forEach(r => D.daily[dkey(r.user_id, r.day)] = r);
  D.workouts = {}; w.data.forEach(r => D.workouts[r.user_id + '|' + r.day + '|' + r.kind] = r);
  D.books = {}; b.data.forEach(r => (D.books[r.user_id] ||= []).push(r));
  D.weigh = {}; wi.data.forEach(r => (D.weigh[r.user_id] ||= []).push(r));
  D.plans = {}; D.detail = {}; wp.data.forEach(r => { D.plans[r.user_id + '|' + r.day] = r.items; D.detail[r.user_id + '|' + r.day] = r.detail; });
  D.mlog = ml.data; D.saved = sm.data; D.fun = fp.data; D.groceries = g.data;
  D.sets = {}; lf.data.forEach(r => (D.sets[r.user_id] ||= []).push(r));
  D.meals = {}; m.data.forEach(r => D.meals[r.day_idx + '|' + r.slot] = r.text);
  S.me = D.profiles.find(x => x.id === S.user.id) || null;
}
let reloadT;
function scheduleReload() { clearTimeout(reloadT); reloadT = setTimeout(async () => { await loadAll(); softRender(); }, 250); }
function softRender() {
  const a = document.activeElement;
  if (a && (a.matches('input,textarea,select') || a.isContentEditable)) { S.dirty = true; return; }
  render();
}
document.addEventListener('focusout', () => { if (S.dirty) setTimeout(() => { const a = document.activeElement; if (!(a && (a.matches('input,textarea,select') || a.isContentEditable))) { S.dirty = false; render(); } }, 50); });

// ---------- derived day state ----------
function dailyRow(u, d) { return D.daily[dkey(u, d)] || { water_oz: 0, pages: 0, diet: false, photo_path: null }; }
function wRow(u, d, k) { return D.workouts[u + '|' + d + '|' + k]; }
function wInfo(row) {
  if (!row) return { st: 'idle', frac: 0 };
  const start = +new Date(row.started_at);
  if (row.done_at) return { st: 'done', frac: 1, start, end: +new Date(row.done_at) };
  const pms = row.paused_ms || 0;
  if (row.paused_at) { const el = +new Date(row.paused_at) - start - pms; return { st: 'paused', frac: Math.min(el / WLEN, 1), start, left: WLEN - el }; }
  const el = Date.now() - start - pms;
  if (el >= WLEN) return { st: 'done', frac: 1, start, end: start + pms + WLEN, persist: true };
  return { st: 'running', frac: el / WLEN, start, left: WLEN - el };
}
function rings(u, d) {
  const r = dailyRow(u, d);
  return { indoor: wInfo(wRow(u, d, 'indoor')).frac, outdoor: wInfo(wRow(u, d, 'outdoor')).frac, water: Math.min(r.water_oz / WATER, 1), reading: Math.min(r.pages / 10, 1), photo: r.photo_path ? 1 : 0 };
}
const ringsDone = (u, d) => Object.values(rings(u, d)).every(v => v >= 1);
const complete = (u, d) => Object.values(rings(u, d)).every(v => v >= 1);
const dayNum = (p, d = TD) => diffDays(d, p.start_date) + 1;
function missing(u, d) {
  const f = rings(u, d), r = dailyRow(u, d), out = [];
  if (f.indoor < 1) out.push('indoor workout'); if (f.outdoor < 1) out.push('outdoor workout');
  if (f.water < 1) out.push('water'); if (f.reading < 1) out.push('reading'); if (f.photo < 1) out.push('progress photo');
  return out;
}
function firstMissedDay(p) {
  const n = dayNum(p);
  for (let i = 0; i < Math.min(n - 1, 75); i++) { const d = addDays(p.start_date, i); if (!complete(p.id, d)) return d; }
  return null;
}
function notify45(k) {
  const key = `n45-${S.user.id}-${TD}-${k}`; try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { }
  const msg = `${k === 'indoor' ? 'Indoor' : 'Outdoor'} workout: 45 minutes are up!`;
  toast(msg); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (_) { }
  if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification('Workout complete', { body: msg, tag: 'w45-' + k })).catch(() => { });
}
async function persistDone() {
  for (const row of Object.values(D.workouts)) {
    if (!canEdit(row.user_id) || row.done_at) continue;
    const i = wInfo(row);
    if (i.persist) { if (row.day === TD) notify45(row.kind); row.done_at = new Date(i.end).toISOString(); sb.from('workouts').update({ done_at: row.done_at }).match({ user_id: row.user_id, day: row.day, kind: row.kind }); }
  }
}

// ---------- writes (own rows only; the database enforces this too) ----------
async function saveDaily(date, patch) {
  const u = actor().id, k = dkey(u, date);
  const before = dailyRow(u, date).water_oz;
  if (patch.water_oz !== undefined && date === TD && before < 128 && patch.water_oz >= 128) setTimeout(water128, 250);
  D.daily[k] = { ...dailyRow(u, date), user_id: u, day: date, ...patch };
  render();
  const { error } = await sb.from('daily').upsert({ user_id: u, day: date, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' });
  if (error) { toast(error.message); await loadAll(); render(); }
}
async function saveWorkout(row) {
  D.workouts[row.user_id + '|' + row.day + '|' + row.kind] = row; render();
  const { error } = await sb.from('workouts').upsert(row, { onConflict: 'user_id,day,kind' });
  if (error) { toast(error.message); await loadAll(); render(); }
}
async function compress(file, max = 1280) {
  const bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const sc = Math.min(1, max / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = Math.round(bm.width * sc); c.height = Math.round(bm.height * sc);
  c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .82));
}
async function uploadPhoto(file, date) {
  try {
    toast('Saving photo...');
    const blob = await compress(file), path = `${actor().id}/${date}.jpg`;
    const { error } = await sb.storage.from('progress-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    S.urls[path] = URL.createObjectURL(blob);
    await saveDaily(date, { photo_path: path });
    toast('Photo saved.');
  } catch (e) { toast('Photo upload failed: ' + (e.message || e)); }
}
async function ensureUrls() {
  const need = new Set();
  Object.values(D.daily).forEach(r => { if (r.photo_path && !S.urls[r.photo_path]) need.add(r.photo_path); });
  [S.me, partner()].filter(Boolean).forEach(p => { for (let i = 0; i < 75; i++) { const r = D.daily[dkey(p.id, addDays(p.start_date, i))]; if (r?.photo_path && !S.urls[r.photo_path]) need.add(r.photo_path); } });
  (D.fun || []).forEach(f => { if (!S.urls[f.path]) need.add(f.path); });
  [...(D.mlog || []), ...(D.saved || [])].forEach(r => { if (r.photo_path && !S.urls[r.photo_path]) need.add(r.photo_path); });
  if (!need.size) return;
  const { data } = await sb.storage.from('progress-photos').createSignedUrls([...need], 3600);
  (data || []).forEach(x => { if (x.signedUrl) S.urls[x.path] = x.signedUrl; });
  if (S.tab === 'progress' || S.tab === 'meals') softRender();
}

// ---------- ring + small ui helpers ----------
function ring(size, stroke, frac, color, inner = '') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<span class="ringwrap" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" style="transform:rotate(-90deg);color:${color}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${stroke}"/>
  <circle class="glow" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(frac, .001))}"/></svg><span class="mid">${inner}</span></span>`;
}
// Concentric "all rings" graphic. Rings start from where they last were so the 1s refresh does not replay the animation.
let ARC_LAST = {}, ARC_TAB = null;
const lite = (hex, a) => { const n = parseInt(hex.slice(1), 16), m = x => Math.round(x + (255 - x) * a); return `rgb(${m(n >> 16)},${m(n >> 8 & 255)},${m(n & 255)})`; };
function allRings(u, o = {}) {
  const f = rings(u, TD), keys = Object.keys(NAMES), size = o.size || 300, stroke = o.stroke || 22, step = o.step || stroke + 3, c0 = size / 2;
  const defs = keys.map(k => `<linearGradient id="g-${u}-${k}-${size}" gradientUnits="userSpaceOnUse" x1="0" y1="${size}" x2="${size}" y2="0"><stop offset="0" stop-color="${RCOL[k]}"/><stop offset="1" stop-color="${lite(RCOL[k], .35)}"/></linearGradient>`).join('');
  const svg = keys.map((k, i) => {
    const r = (size - stroke) / 2 - i * step, c = 2 * Math.PI * r, last = ARC_LAST[u + k] || 0;
    return `<circle cx="${c0}" cy="${c0}" r="${r}" fill="none" stroke="#04100a" stroke-width="${stroke + 4}"/>` +
      `<circle cx="${c0}" cy="${c0}" r="${r}" fill="none" stroke="${RCOL[k]}" stroke-opacity=".16" stroke-width="${stroke}"/>` +
      `<circle class="arc" data-arc="${u + k}" data-f="${Math.max(f[k], .001)}" data-c="${c}" style="transition-delay:${i * 120}ms;filter:drop-shadow(0 0 3px ${RCOL[k]}) drop-shadow(0 0 9px ${RCOL[k]})" cx="${c0}" cy="${c0}" r="${r}" fill="none" stroke="url(#g-${u}-${k}-${size})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(last, .001))}"/>`;
  }).join('');
  const legend = o.legend === false ? '' : `<div class="arclegend">${keys.map(k => `<div class="lg"><i style="background:${RCOL[k]}"></i><span>${NAMES[k]}</span><b>${Math.round(f[k] * 100)}%</b></div>`).join('')}</div>`;
  return `<div class="big"><span class="ringwrap" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" style="transform:rotate(-90deg)"><defs>${defs}</defs>${svg}</svg></span></div>${legend}`;
}
function animateArcs() {
  if (ARC_TAB !== S.tab) { ARC_LAST = {}; ARC_TAB = S.tab; }
  const els = document.querySelectorAll('.arc'); if (!els.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => els.forEach(e => { const f = +e.dataset.f, c = +e.dataset.c; e.style.strokeDashoffset = c * (1 - f); ARC_LAST[e.dataset.arc] = f <= .001 ? 0 : f; })));
}
const tick = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mmss = ms => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
const hms = ms => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60); };
const ICONS = {
  today: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  workouts: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  meals: '<path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  water: '<path d="M12 3C9 8 6 11 6 15a6 6 0 0012 0c0-4-3-7-6-12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  reading: '<path d="M4 5h6a2 2 0 012 2v12a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v12a2 2 0 012-2h6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  progress: '<path d="M4 18l5-6 4 3 7-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 21h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};
const TABS = [['today', 'Today'], ['workouts', 'Workouts'], ['meals', 'Meals'], ['water', 'Water'], ['progress', 'Progress']];

// ---------- views ----------
function header(title) {
  const v = viewed(), pr = partner();
  const label = S.view === 'split' ? `${esc(S.me.name)} + ${esc(pr?.name || '')}` : 'Hi, ' + esc(S.me.name);
  const ro = !editable() && S.view !== 'split' ? `<div class="roBar">You're looking at ${esc(v.name)}'s side. It's view-only.</div>` : '';
  return `<div class="top"><div class="hello">${label} &middot; ${pretty(TD)}</div><h1>${title}</h1></div>
  <div class="seg">
    <button data-view="me" class="${S.view === 'me' ? 'on' : ''}">${esc(S.me.name)}</button>
    ${pr ? `<button data-view="partner" class="${S.view === 'partner' ? 'on' : ''}">${esc(pr.name)}</button><button data-view="split" class="${S.view === 'split' ? 'on' : ''}">Split</button>` : ''}
  </div>${ro}`;
}
function dayCounter(p) {
  const n = dayNum(p);
  if (n < 1) return { left: 75, sub: 'days left', note: `Day 1 starts ${pretty(p.start_date)}`, frac: 0 };
  if (n > 75) return { left: 0, sub: 'complete', note: '', frac: 1 };
  return { left: 75 - n + 1, sub: 'days left', note: '', frac: (n - 1) / 75 + .013 };
}
function testBar(p) { return dayNum(p) < 1 ? `<div class="roBar" style="color:var(--acc2)">Practice mode until ${pretty(p.start_date)}. Log whatever you like to try things out. None of it counts toward your 75 days.</div>` : ''; }

const GRIP = '<button class="grip" aria-label="Drag to reorder"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg></button>';
const TILE_IDS = ['days', 'all', 'single', 'cal', 'reading', 'photo'];
function tileOrder() {
  try {
    let o = JSON.parse(localStorage.getItem('tileOrder'));
    if (Array.isArray(o)) { o = o.filter(k => TILE_IDS.includes(k)); for (const k of TILE_IDS) if (!o.includes(k)) o.push(k); if (o.length === TILE_IDS.length) return o; }
  } catch (_) { }
  return TILE_IDS.slice();
}
function saveTileOrder(o) { try { localStorage.setItem('tileOrder', JSON.stringify(o)); } catch (_) { } }
// Drag any tile by its grip; the tiles it passes slide out of the way. Release to drop it in that spot.
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.grip'); if (!g) return;
  const tile = g.closest('.dtile'), box = tile && tile.parentElement; if (!tile || !box || !box.dataset.dragbox) return;
  const tiles = [...box.children], i = tiles.indexOf(tile), R = tiles.map(t => t.getBoundingClientRect());
  e.preventDefault(); S.dragging = true;
  const x0 = e.clientX, y0 = e.clientY, c = R.map(r => [r.left + r.width / 2, r.top + r.height / 2]);
  tile.style.zIndex = 5; tile.style.transition = 'none'; tile.style.boxShadow = '0 14px 40px rgba(0,0,0,.6)';
  tiles.forEach((t, k) => { if (k !== i) t.style.transition = 'transform .22s ease'; });
  let j = i;
  const mv = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0, cx = c[i][0] + dx, cy = c[i][1] + dy;
    tile.style.transform = `translate(${dx}px,${dy}px)`;
    let best = Infinity; j = i; c.forEach((q, k) => { const dd = (q[0] - cx) ** 2 + (q[1] - cy) ** 2; if (dd < best) { best = dd; j = k; } });
    tiles.forEach((t, k) => {
      if (k === i) return;
      const to = (i < j && k > i && k <= j) ? k - 1 : (i > j && k < i && k >= j) ? k + 1 : k;
      t.style.transform = to === k ? '' : `translate(${R[to].left - R[k].left}px,${R[to].top - R[k].top}px)`;
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (j !== i) {
      if (box.dataset.dragbox === 'lifts') { const o = lKeys(); const [m] = o.splice(i, 1); o.splice(j, 0, m); S.lorder = o; lSave(); }
      else if (box.dataset.dragbox === 'progress') { const o = progOrder(); const [m] = o.splice(i, 1); o.splice(j, 0, m); try { localStorage.setItem('progOrder', JSON.stringify(o)); } catch (_) { } }
      else { const o = tileOrder(); const [m] = o.splice(i, 1); o.splice(j, 0, m); saveTileOrder(o); }
    }
    S.dragging = false; render();
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});

function vToday() {
  const pr = partner(), v = viewed();
  if (S.view === 'split') {
    const c = dayCounter(S.me);
    const RS = Math.max(100, Math.min(160, Math.floor((Math.min(window.innerWidth, 520) - 32 - 10) / 2 - 34)));
    const col = p => { const done = complete(p.id, TD);
      return `<div class="p"><h3>${esc(p.name)}</h3>${allRings(p.id, { size: RS, stroke: RS < 150 ? 9 : 11, step: RS < 150 ? 11 : 14 })}
      <div style="margin-top:10px"><span class="badge ${done ? 'good' : ''}">${done ? 'Day complete' : 'In progress'}</span></div></div>`; };
    return header('Today') + `<div class="card" style="text-align:center${WIDE() ? '' : ';padding:12px'}"><div class="big">${ring(WIDE() ? 200 : 140, WIDE() ? 12 : 10, c.frac, '#00e676', `<span class="days" style="font-size:${WIDE() ? 64 : 44}px">${c.left}</span><span class="dayslbl">${c.sub}</span>`)}</div></div><div class="split">${col(S.me)}${col(pr)}</div>
      <p class="note" style="margin-top:12px">Live view. When ${esc(pr.name)} checks something off, it shows up here.</p>`;
  }
  const f = rings(v.id, TD), c = dayCounter(v);
  const go = n => n === 'indoor' || n === 'outdoor' ? 'workouts' : n === 'water' ? 'water' : n === 'reading' ? 'today' : 'progress';
  const small = Object.keys(NAMES).map(n => `<button data-go="${go(n)}">${ring(60, 7, f[n], COLORS[n], `<span class="num" style="font-size:12px">${Math.round(f[n] * 100)}%</span>`)}<span class="n">${NAMES[n]}</span></button>`).join('');
  let other = '';
  if (pr && editable()) { const n = Object.values(rings(pr.id, TD)).filter(x => x >= 1).length; other = `<div class="card"><div class="lbl">${esc(pr.name)} right now</div><div style="margin:6px 0 10px;font-size:15px">${n} of 5 rings closed</div>${allRings(pr.id, { size: 200, stroke: 14, step: 17 })}</div>`; }
  if (!pr) other = `<div class="card"><div class="lbl">Waiting for your partner</div><p class="note" style="margin:8px 0 0">Once they create their account, their rings show up here live.</p></div>`;
  return header('Good <em>' + greet() + '</em>') + testBar(v) +
    `<div id="tiles" data-dragbox="today">${tileOrder().map(k => k === 'days'
      ? `<div class="card dtile" data-tile="days">${GRIP}<div class="big">${ring(280, 13, c.frac, '#00e676', `<span class="days">${c.left}</span><span class="dayslbl">${c.sub}</span>`)}</div>${c.note ? `<p class="note" style="text-align:center;margin:0">${c.note}</p>` : ''}</div>`
      : k === 'all'
        ? `<div class="card dtile" data-tile="all">${GRIP}${allRings(v.id)}</div>`
        : k === 'cal' ? calTile(v)
        : k === 'reading' ? readTile(v)
        : k === 'photo' ? photoTile(v)
        : `<div class="card dtile" data-tile="single">${GRIP}<div class="lbl" style="margin-bottom:14px">Today's rings</div><div class="rings">${small}</div></div>`).join('')}</div>
    <div style="height:14px"></div>${other}
    <div style="text-align:center;margin-top:8px"><button class="link" id="signout">Sign out</button></div>`;
}

// ---------- calendar tile ----------
const CAL_OPTS = ['Chest', 'Triceps', 'Biceps', 'Legs', 'Back', 'Shoulders', 'Abs', 'Cardio', 'Yoga', 'Pilates', 'Treadmill', 'Cycling', 'HIIT', 'Rest day'];
const planOf = (u, day) => D.plans[u + '|' + day] || [];
const detailOf = (u, day) => { const d = D.detail[u + '|' + day]; return d && d.sel && d.sel.length ? d : null; };
function detSummary(d) {
  const lines = d.sel.map(m => `<b>${MNAME[m] || m}</b>: ${esc((d.plan[m] || []).join(', ') || 'full plan not built yet')}`);
  return (d.type === 'Lift' ? 'Lifting' : esc(d.type)) + '<br>' + lines.join('<br>');
}
function calTile(v) {
  const fin = ringsDone(v.id, TD);
  if (S.calTD !== TD || (fin && S.calFin !== TD)) { S.calTD = TD; S.calFin = fin ? TD : null; S.calSel = fin ? addDays(TD, 1) : TD; S.calMonth = S.calSel.slice(0, 7); S.calWk = S.calSel; }
  if (!fin) S.calFin = null;
  const view = S.calView || 'week';
  const sel = S.calSel, ed = editable() && canEdit(v.id), saved = planOf(v.id, sel), editing = ed && (S.calEditing === sel || !saved.length);
  if (S.calDraftDay !== sel || !editing) { S.calDraftDay = sel; if (!editing) S.calDraft = saved.slice(); else if (S.calDraftFor !== sel) S.calDraft = saved.slice(); }
  S.calDraftFor = editing ? sel : null;
  const seg = (k, n) => `<button class="${view === k ? 'on' : ''}" data-calview="${k}">${n}</button>`;
  let main;
  if (view === 'day') {
    const dt = parseYmd(sel), title = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    main = `<div class="row sp" style="margin-bottom:6px"><button class="btn ghost sm" data-calstep="-1" aria-label="Previous day">&lsaquo;</button><div style="text-align:center"><b style="font-size:16px">${title}</b>${sel === TD ? '<div><span class="badge good">Today</span></div>' : ''}</div><button class="btn ghost sm" data-calstep="1" aria-label="Next day">&rsaquo;</button></div>`;
  } else if (view === 'week') {
    const w0 = S.calWk || (S.calWk = sel), days = Array.from({ length: 7 }, (_, i) => addDays(w0, i));
    const kind = ds => { const dt = detailOf(v.id, ds), pl = planOf(v.id, ds), r = wRow(v.id, ds, 'indoor');
      if (dt) return [dt.type === 'Lift' ? 'Lifting' : dt.type, dt.type === 'Lift' ? dt.sel.map(m => MNAME[m] || m).join(', ') : ''];
      if (r && r.type) return [r.type === 'Lift' ? 'Lifting' : r.type, 'Logged'];
      if (pl.length) return [pl.join(' + '), '']; return ['', '']; };
    const rows = days.map(ds => { const [t, sub] = kind(ds), dt = parseYmd(ds);
      return `<button class="wd ${ds === TD ? 'today' : ''} ${ds === sel ? 'sel' : ''}" data-calday="${ds}"><span class="dn"><small>${dt.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</small><b>${dt.getDate()}</b></span><span class="wt">${t ? `<b>${esc(t)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}` : '<i>Nothing planned</i>'}</span></button>`; }).join('');
    main = `<div class="row sp" style="margin-bottom:8px"><button class="btn ghost sm" data-calweek="-1" aria-label="Previous week">&lsaquo;</button><b style="font-size:16px">${pretty(days[0])} - ${pretty(days[6])}</b><button class="btn ghost sm" data-calweek="1" aria-label="Next week">&rsaquo;</button></div><div class="wk">${rows}</div>`;
  } else {
    const [y, m] = S.calMonth.split('-').map(Number), first = new Date(y, m - 1, 1), nd = new Date(y, m, 0).getDate();
    const cells = []; for (let i = 0; i < first.getDay(); i++) cells.push('<span></span>');
    for (let d = 1; d <= nd; d++) {
      const ds = `${y}-${pad(m)}-${pad(d)}`;
      cells.push(`<button class="cd ${ds === TD ? 'today' : ''} ${ds === sel ? 'sel' : ''} ${planOf(v.id, ds).length ? 'has' : ''}" data-calday="${ds}">${d}</button>`);
    }
    main = `<div class="row sp" style="margin-bottom:8px"><button class="btn ghost sm" data-calmonth="-1" aria-label="Previous month">&lsaquo;</button><b style="font-size:16px">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class="btn ghost sm" data-calmonth="1" aria-label="Next month">&rsaquo;</button></div>
      <div class="cal7">${'SMTWTFS'.split('').map(x => `<span class="wd">${x}</span>`).join('')}${cells.join('')}</div>`;
  }
  const draft = S.calDraft || [], opts = [...CAL_OPTS, ...draft.filter(x => !CAL_OPTS.includes(x))];
  const head = `<div class="row sp"><div class="lbl">${view === 'day' ? 'Workout plan' : 'Plan for ' + pretty(sel)}</div>${sel !== TD ? '<button class="link" data-caltoday="1">Jump to today</button>' : ''}</div>`;
  const body = editing
    ? `<div class="chips">${opts.map(o => `<button class="ctl ${draft.includes(o) ? 'on' : ''}" data-calpick="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <div class="row" style="gap:8px"><input type="text" class="ctl" id="calcustom" placeholder="Something else (e.g. Knee rehab)" maxlength="40"><button class="btn ghost sm ctl" data-caladd="1">Add</button></div>
      <div class="row" style="margin-top:12px;gap:8px"><button class="btn ctl" data-calsave="1" style="flex:1">Save plan</button>${saved.length ? '<button class="btn ghost ctl" data-calcancel="1">Cancel</button>' : ''}</div>`
    : saved.length
      ? `<div style="margin:10px 0 0;font-size:20px;font-weight:700;line-height:1.3">${esc(saved.join(' + '))}</div>${ed ? '<div class="row" style="margin-top:12px"><button class="btn ghost sm ctl" data-caledit="1">Change plan</button></div>' : ''}`
      : '<p class="note" style="margin:8px 0 0">Nothing planned.</p>';
  const hideP = ed && sel >= TD, jump = sel !== TD ? '<button class="link" data-caltoday="1">Jump to today</button>' : '';
  const planner = hideP ? '' : `<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px">${head}${body}</div>`;
  let go = '';
  const det = detailOf(v.id, sel);
  if (ed && sel === TD) {
    const w = wInfo(wRow(v.id, TD, 'indoor'));
    go = `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px">${w.st === 'idle' ? liftPick(v, true) : `<div class="lbl">Today's workout</div><p class="note" style="margin:6px 0 10px">Your indoor workout is ${w.st === 'done' ? 'done' : 'in progress'}.</p><button class="btn ctl" data-calopen="1">Open workout</button>`}</div>`;
  } else if (ed && sel > TD) {
    if (S.cdDay !== sel) { S.cdDay = sel; S.cdEditing = null; S.cd = det ? { type: det.type, sel: det.sel.slice(), plan: JSON.parse(JSON.stringify(det.plan)), step: 'plan' } : { type: 'Lift', sel: [], plan: {}, step: 'pick' }; }
    if (det && S.cdEditing !== sel) go = `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="row sp"><div class="lbl">Planned workout</div>${jump}</div><div style="margin:8px 0 12px;font-size:14px;line-height:1.5">${detSummary(det)}</div><div class="row" style="gap:8px"><button class="btn ghost sm ctl" data-cedit="1">Edit workout</button><button class="btn ghost sm ctl" data-cdel="1">Remove</button></div></div>`;
    else { CTX = true; const h = liftPick(v, true); CTX = false; go = `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="row sp" style="margin-bottom:8px"><div class="lbl">Plan this day's workout</div>${jump}</div>${saved.length && !det ? `<p class="note" style="margin:0 0 10px">Earlier plan: ${esc(saved.join(' + '))}</p>` : ''}${h}</div>`; }
  } else if (det) {
    go = `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="lbl">Planned workout</div><div style="margin-top:8px;font-size:14px;line-height:1.5">${detSummary(det)}</div></div>`;
  }
  return `<div class="card dtile" data-tile="cal">${GRIP}<div class="row sp" style="padding-right:44px;margin-bottom:12px"><div class="lbl">Calendar</div><div class="seg">${seg('day', 'Day')}${seg('week', 'Week')}${seg('month', 'Month')}</div></div>${main}${planner}${go}</div>`;
}
async function saveDayPlan(u, day, items, detail) {
  const k = u + '|' + day, det = detail === undefined ? D.detail[k] : detail;
  if (items.length) D.plans[k] = items; else delete D.plans[k];
  if (det) D.detail[k] = det; else delete D.detail[k];
  render();
  const { error } = items.length || det ? await sb.from('workout_plans').upsert({ user_id: u, day, items, detail: det || null }) : await sb.from('workout_plans').delete().match({ user_id: u, day });
  if (error) { toast(error.message); await loadAll(); render(); }
}
function photoTile(v) {
  const done = !!dailyRow(v.id, TD).photo_path, ed = editable() && canEdit(v.id);
  const r = ring(130, 12, done ? 1 : 0, COLORS.photo, `<span class="num" style="font-size:26px;font-weight:800">${done ? tick : '+'}</span><span class="lbl">${done ? 'photo done' : 'add photo'}</span>`);
  return `<div class="card dtile" data-tile="photo">${GRIP}<div class="lbl" style="margin-bottom:12px">Progress photo</div><div class="big">${ed ? `<button class="ctl" data-phopen="1" style="background:none;border:0;padding:0;color:inherit" aria-label="Take or choose today's photo">${r}</button>` : r}</div><p class="note" style="text-align:center;margin:10px 0 0">${done ? 'Saved to your Progress page. Tap the ring to replace it.' : 'Tap the ring to take or choose today\'s photo.'}</p>${done && ed ? '<div class="row" style="justify-content:center;margin-top:12px"><button class="btn amber sm ctl" data-phundo="1">Undo</button></div>' : ''}</div>`;
}
function readTile(v) {
  const pages = dailyRow(v.id, TD).pages, done = pages >= 10, ed = editable() && canEdit(v.id);
  const r = ring(130, 12, Math.min(pages / 10, 1), COLORS.reading, `<span class="num" style="font-size:30px;font-weight:800">${pages}</span><span class="lbl">of 10 pages</span>`);
  return `<div class="card dtile" data-tile="reading">${GRIP}<div class="lbl" style="margin-bottom:12px">Reading</div><div class="big">${ed ? `<button class="ctl" data-rclose="1" style="background:none;border:0;padding:0;color:inherit" aria-label="${done ? 'Reading done. Tap to undo' : 'Tap to close the reading ring'}">${r}</button>` : r}</div><p class="note" style="text-align:center;margin:10px 0 0">${done ? 'Reading is done. Tap the ring to undo.' : 'Finished your 10 pages? Tap the ring to close it.'}</p></div>`;
}
function greet() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }

function lateRow(k, p) {
  if (!canEdit(p.id)) return '';
  const n = new Date(), hhmm = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  return `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="lbl" style="margin-bottom:8px">Forgot to start it?</div><div class="row" style="gap:8px"><input type="time" id="late-${k}" value="${hhmm}" style="flex:1"><button class="btn ghost sm" data-late="${k}">Mark complete</button></div><p class="note" style="margin-top:6px">Pick the time you finished. It counts as a full 45 minutes.</p></div>`;
}
function wCard(k, p) {
  const w = wInfo(wRow(p.id, TD, k)), other = wInfo(wRow(p.id, TD, k === 'indoor' ? 'outdoor' : 'indoor'));
  const label = k === 'indoor' ? 'Indoor Workout' : 'Outdoor Workout';
  const types = k === 'indoor' ? ['Lift', 'Yoga', 'Pilates', 'Treadmill', 'Cycling', 'HIIT'] : ['Walk', 'Run', 'Hike', 'Bike ride', 'Sports'];
  const row = wRow(p.id, TD, k);
  let body = '';
  if (k === 'indoor' && w.st === 'idle') return '';
  if (w.st === 'done') body = `<div class="timer">Done</div><div class="note">${esc(row.type)} &middot; 45 min complete</div>`;
  else if (w.st === 'running' || w.st === 'paused') {
    const ps = w.st === 'paused', mine = canEdit(p.id);
    body = `<div class="timer" id="t-${k}">${mmss(w.left)}</div><div class="note">${esc(row.type)} ${ps ? 'is paused. The clock is stopped.' : 'in progress. It closes on its own at 45 minutes.'}</div>` +
      (mine ? `<div class="lbtns"><button class="btn sm amber" data-${ps ? 'resume' : 'pause'}="${k}">${ps ? 'Resume' : 'Pause'}</button><button class="btn sm blue" data-restart="${k}">Restart Timer</button>${k === 'indoor' ? '<button class="btn sm violet" data-lplan="1">Modify/Add Workouts</button>' : `<button class="btn sm red" data-stop="${k}">Stop</button>`}<button class="btn sm" data-fin="${k}">Complete Workout</button>${k === 'indoor' ? '<div style="grid-column:1/-1;display:flex;justify-content:center"><button class="btn sm red" data-wreset="indoor">Plan a new workout</button></div>' : ''}</div>` : '');
  }
  else if (other.st === 'running' || other.st === 'paused') body = `<div class="note">Finish your other workout first.</div>`;
  else body = `<select data-wtype="${k}">${types.map(t => `<option ${t === (S.wtype[k] || types[0]) ? 'selected' : ''}>${t}</option>`).join('')}</select><div class="row" style="margin-top:14px"><button class="btn" data-start="${k}">Start 45 min</button></div>`;
  if (w.st === 'idle') body += lateRow(k, p);
  return `<div class="card"><div class="row sp" style="margin-bottom:12px"><div class="lbl">${label}</div>${ring(54, 7, w.frac, COLORS[k])}</div>${body}</div>`;
}
function wLabel(k) { return k === 'indoor' ? 'Indoor workout' : 'Outdoor workout'; }
const todaySetsAny = u => (D.sets[u] || []).some(r => r.day === TD);
function vWorkouts() {
  if (S.view === 'split' && partner()) return splitWorkouts();
  const p = viewed();
  if (S.sub === 'indoor' || S.sub === 'outdoor') return vWorkoutPage(S.sub, p);
  const tile = k => {
    const row = wRow(p.id, TD, k), w = wInfo(row);
    const st = w.st === 'done' ? `Done &middot; ${esc(row.type)}` : w.st === 'running' ? `${mmss(w.left)} left &middot; ${esc(row.type)}` : w.st === 'paused' ? `Paused &middot; ${mmss(w.left)} left` : 'Not started';
    return `<div class="card wtile" data-open="${k}" role="button" tabindex="0"><div class="row sp"><div><div class="lbl">${wLabel(k)}</div><div id="ws-${k}" style="margin-top:6px;font-size:15px">${st}</div>${canEdit(p.id) && (w.st !== 'idle' || (k === 'indoor' && todaySetsAny(p.id))) ? `<div class="row" style="margin-top:10px;gap:8px"><button class="btn red sm" data-wreset="${k}">Reset</button></div>` : ''}</div><div class="row" style="gap:12px">${ring(54, 7, w.frac, COLORS[k])}<svg width="10" height="16" viewBox="0 0 10 16"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/></svg></div></div></div>`;
  };
  return header('Work<em>outs</em>') + testBar(p) + `<p class="note" style="margin-top:-4px">Tap a workout to open it.</p>` + tile('indoor') + tile('outdoor');
}
const MUSCLES = [['chest', 'Chest'], ['triceps', 'Triceps'], ['biceps', 'Biceps'], ['legs', 'Legs'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['abs', 'Abs']];
const EXTRA = [['yoga', 'Yoga'], ['pilates', 'Pilates'], ['treadmill', 'Treadmill'], ['cycling', 'Cycling'], ['hiit', 'HIIT']];
const MNAME = Object.fromEntries([...MUSCLES, ...EXTRA]);
const LMUS = MUSCLES.map(x => x[0]);
const LIB = {
  chest: ['Flat barbell bench press', 'Incline barbell bench press', 'Decline barbell bench press', 'Flat dumbbell press', 'Incline dumbbell press', 'Decline dumbbell press', 'Dumbbell fly', 'Incline dumbbell fly', 'Cable crossover', 'Low-to-high cable fly', 'Machine chest press', 'Pec deck', 'Push-up', 'Chest dips', 'Landmine press', 'Svend press'],
  triceps: ['Triceps rope pushdown', 'Straight-bar pushdown', 'Overhead dumbbell extension', 'Overhead cable extension', 'Skull crusher', 'Close-grip bench press', 'Triceps dips', 'Bench dips', 'Diamond push-up', 'Dumbbell kickback', 'Single-arm cable pushdown', 'JM press'],
  biceps: ['Barbell curl', 'EZ-bar curl', 'Dumbbell curl', 'Hammer curl', 'Incline dumbbell curl', 'Preacher curl', 'Concentration curl', 'Cable curl', 'Spider curl', 'Reverse curl', 'Zottman curl', 'Chin-up'],
  legs: ['Back squat', 'Front squat', 'Goblet squat', 'Hack squat', 'Leg press', 'Romanian deadlift', 'Stiff-leg deadlift', 'Walking lunge', 'Reverse lunge', 'Bulgarian split squat', 'Step-up', 'Leg extension', 'Seated leg curl', 'Lying leg curl', 'Hip thrust', 'Glute bridge', 'Hip abduction machine', 'Standing calf raise', 'Seated calf raise', 'Wall sit'],
  back: ['Deadlift', 'Pull-up', 'Lat pulldown', 'Close-grip lat pulldown', 'Barbell row', 'Dumbbell row', 'Seated cable row', 'T-bar row', 'Chest-supported row', 'Straight-arm pulldown', 'Face pull', 'Back extension', 'Barbell shrug', 'Dumbbell shrug', 'Rack pull', 'Dead hang'],
  shoulders: ['Barbell overhead press', 'Dumbbell shoulder press', 'Arnold press', 'Machine shoulder press', 'Push press', 'Dumbbell lateral raise', 'Cable lateral raise', 'Front raise', 'Rear delt fly', 'Reverse pec deck', 'Upright row', 'Landmine press', 'Face pull', 'Barbell shrug']
};
LIB.abs = ['Crunch', 'Bicycle crunch', 'Reverse crunch', 'Cable crunch', 'Decline sit-up', 'Sit-up', 'V-up', 'Toe touch', 'Hanging knee raise', 'Hanging leg raise', 'Captain\'s chair leg raise', 'Lying leg raise', 'Flutter kicks', 'Scissor kicks', 'Russian twist', 'Weighted Russian twist', 'Woodchopper', 'Pallof press', 'Ab wheel rollout', 'Mountain climber', 'Heel touch', 'Dead bug', 'Bird dog', 'Plank', 'Side plank', 'Plank shoulder tap', 'Hollow hold', 'Machine ab crunch', 'Landmine twist'];
Object.assign(LIB, {
  yoga: ['Sun salutation A', 'Sun salutation B', 'Vinyasa flow', 'Hatha flow', 'Power yoga', 'Ashtanga primary series', 'Yin yoga', 'Restorative yoga', 'Hot yoga (Bikram style)', 'Kundalini kriya', 'Yoga nidra', 'Morning wake-up flow', 'Evening wind-down flow', 'Hip opener sequence', 'Hamstring and low back stretch', 'Shoulder and neck release', 'Core strength flow', 'Balance flow (tree, eagle, warrior III)', 'Warrior flow (I, II, III)', 'Chair yoga', 'Yoga for runners', 'Yoga for knees and hips', 'Backbend sequence', 'Twist and detox flow', 'Standing flow', 'Seated stretch sequence', 'Moon salutation', 'Full body stretch', 'Sleep yoga', 'Breathwork and meditation (pranayama)'],
  pilates: ['The Hundred', 'Roll-up', 'Single-leg circles', 'Rolling like a ball', 'Single-leg stretch', 'Double-leg stretch', 'Scissors', 'Spine stretch forward', 'Open-leg rocker', 'Corkscrew', 'Saw', 'Swan', 'Single-leg kick', 'Double-leg kick', 'Neck pull', 'Shoulder bridge', 'Side kick series', 'Teaser', 'Swimming', 'Leg pull front', 'Leg pull back', 'Mermaid', 'Boomerang', 'Seal', 'Side bend', 'Criss-cross', 'Mat Pilates full class', 'Pilates wall workout', 'Pilates with ring', 'Pilates with small ball', 'Pilates glutes and thighs', 'Pilates core burner', 'Reformer footwork', 'Reformer full body'],
  treadmill: ['Easy jog', 'Steady-state run', 'Brisk walk', 'Incline walk (12-3-30)', 'Hill climb intervals', 'Sprint intervals (30 on / 30 off)', 'Tempo run', 'Fartlek run', 'Pyramid intervals', 'Long slow run', 'Walk/run intervals', 'Recovery walk', 'Progressive speed run', 'Incline power hike', '5K run', '10K run', 'Warm-up walk', 'Cool-down walk'],
  cycling: ['Assault bike intervals', 'Assault bike sprints', 'Zone 2 steady ride', 'Tabata ride', 'Hill climb ride', 'Sprint intervals', 'Tempo ride', 'Recovery spin', 'Pyramid ride', 'Spin class', 'Endurance ride', 'Standing climbs', 'Low-resistance cadence drills', 'Heavy-resistance strength ride', 'Warm-up spin', 'Cool-down spin'],
  hiit: ['Burpees', 'Jump squats', 'Mountain climbers', 'High knees', 'Jumping jacks', 'Kettlebell swings', 'Box jumps', 'Battle ropes', 'Skater jumps', 'Squat thrusts', 'Plank jacks', 'Jump lunges', 'Tuck jumps', 'Sled push', 'Rowing sprints', 'Medicine ball slams', 'Shadow boxing', 'Bear crawls', 'Star jumps', 'Push-up burpee combo', 'Tabata circuit', 'EMOM circuit', 'AMRAP circuit', '30/30 full body circuit', 'Jump rope intervals', 'Stair sprints']
});
const TIMED = new Set(['Wall sit', 'Dead hang', 'Plank', 'Side plank', 'Hollow hold']);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } };
const lKey = n => `${n}-${S.me ? actor().id : S.user?.id}-${TD}`;
// Lift planning is fresh every time. It is only restored while an indoor workout is actually running.
const lAct = () => { const w = wInfo(wRow(actor().id, TD, 'indoor')); return w.st === 'running' || w.st === 'paused' || w.st === 'done'; };
const sj = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
const lState = () => ({ sel: S.lsel, plan: S.plan, step: S.lstep, order: S.lorder, done: S.ldone });
function lApply(sv) {
  S.lsel = (sv && sv.sel || []).filter(m => MNAME[m]); S.plan = (sv && sv.plan) || {}; S.lstep = (sv && sv.step) || 'pick'; S.lorder = (sv && sv.order) || []; S.ldone = (sv && sv.done) || {};
}
// The lifting plan for a running workout lives on the workout row in the database, so every device sees the same one.
function lInit() {
  const u = S.me ? actor().id : S.user?.id, row = wRow(u, TD, 'indoor'), rs = row && row.session, stamp = u + '|' + (rs ? sj(rs) : '');
  if (S.linit && S.lstamp === stamp) return;
  if (S.linit && (!rs || Date.now() - (S.llast || 0) < 4000)) return;   // nothing shared yet, or we just changed it ourselves
  const first = !S.linit; S.linit = true; S.lstamp = stamp;
  lApply(rs || (lAct() ? lsGet(lKey('lsess')) : null));
  if (first) { S.opn = {}; S.hist = null; S.pick = {}; S.custom = {}; S.pOther = {}; }
}
let CTX = false;   // true while the calendar's workout builder (for another day) is being drawn or clicked
const lSave = () => {
  if (CTX) return 0;
  const st = lState(), u = actor().id, row = wRow(u, TD, 'indoor'); lsSet(lKey('lsess'), st);
  if (!row) return;
  row.session = st; S.lstamp = u + '|' + sj(st); S.llast = Date.now();
  clearTimeout(lSave.t); lSave.t = setTimeout(async () => { const { error } = await sb.from('workouts').update({ session: lState() }).match({ user_id: u, day: TD, kind: 'indoor' }); if (error) toast(error.message); }, 350);
};
function lKeys() {   // every planned lift as 'muscle|name', in the user's own drag order
  const flat = []; for (const m of lsel()) for (const n of (lplan()[m] || [])) flat.push(m + '|' + n);
  const ord = S.lorder || []; return [...ord.filter(k => flat.includes(k)), ...flat.filter(k => !ord.includes(k))];
}
const lsel = () => { if (CTX) return S.cd.sel; lInit(); return S.lsel; };
const lplan = () => { if (CTX) return S.cd.plan; lInit(); return S.plan; };
function lstep() { if (CTX) return S.cd.step === 'plan' && S.cd.sel.length ? 'plan' : 'pick'; lInit(); return (S.lstep === 'go' || S.lstep === 'plan') && S.lsel.length ? S.lstep : 'pick'; }
const savePlan = lSave;
function setLstep(v) { if (CTX) { S.cd.step = v; return; } lInit(); S.lstep = v; lSave(); }
const todaySets = (u, ex) => (D.sets[u] || []).filter(r => r.day === TD && r.exercise.toLowerCase() === ex.toLowerCase()).sort((a, b) => a.set_no - b.set_no);
function lastTime(u, ex) {
  const prev = (D.sets[u] || []).filter(r => r.day < TD && r.exercise.toLowerCase() === ex.toLowerCase());
  if (!prev.length) return null; const day = prev.reduce((m, r) => r.day > m ? r.day : m, '');
  return { day, rows: prev.filter(r => r.day === day).sort((a, b) => a.set_no - b.set_no) };
}
const fmtTime = sec => Math.floor(sec / 60) + ':' + pad(sec % 60);
function fmtSet(r) {
  const w = r.weight != null && +r.weight > 0 ? `${+r.weight} lb` : '';
  if (r.seconds != null) return (w ? w + ' &middot; ' : '') + fmtTime(r.seconds);
  return w ? `${w} x ${r.reps}` : `${r.reps} reps`;
}
function syncType(ty) {
  const key = ty.toLowerCase();
  if (CTX) {
    const c = S.cd; if (ty === 'Lift') c.sel = c.sel.filter(m => LMUS.includes(m));
    else if (c.sel.length !== 1 || c.sel[0] !== key) { c.sel = [key]; c.step = 'pick'; }
    return;
  }
  lInit();
  if (ty === 'Lift') S.lsel = S.lsel.filter(m => LMUS.includes(m));
  else if (S.lsel.length !== 1 || S.lsel[0] !== key) { S.lsel = [key]; if (S.lstep !== 'go') S.lstep = 'pick'; }
}
function liftPick(p, bare) {
  const W = h => bare ? h : `<div class="card">${h}</div>`;
  const sel = lsel(), mine = canEdit(p.id);
  if (!mine) {
    const rows = (D.sets[p.id] || []).filter(r => r.day === TD);
    const by = {}; rows.forEach(r => ((by[r.muscle] ||= {})[r.exercise] ||= []).push(r));
    const body = Object.keys(by).length ? Object.entries(by).map(([m, ex]) => `<div style="margin-top:12px"><div class="lbl">${MNAME[m]}</div>${Object.entries(ex).map(([n, rs]) => `<div style="margin-top:8px;font-size:14px"><b>${esc(n)}</b><div class="note" style="margin:2px 0 0">${rs.sort((a, b) => a.set_no - b.set_no).map(fmtSet).join(' &middot; ')}</div></div>`).join('')}</div>`).join('') : `<p class="note" style="margin:10px 0 0">No lifts logged today yet.</p>`;
    return `<div class="card"><div class="lbl">${esc(p.name)}'s lifts today</div>${body}</div>`;
  }
  const chips = MUSCLES.map(([k, n]) => `<button data-msel="${k}" class="ctl ${sel.includes(k) ? 'on' : ''}">${n}</button>`).join('');
  const logged = (D.sets[p.id] || []).filter(r => r.day === TD).length;
  const IT = [['Lift', 'Lifting'], ['Yoga', 'Yoga'], ['Pilates', 'Pilates'], ['Treadmill', 'Treadmill'], ['Cycling', 'Cycling'], ['HIIT', 'HIIT']];
  const live = wRow(p.id, TD, 'indoor'), busy = !CTX && wInfo(live).st !== 'idle';
  const ty = CTX ? S.cd.type : (busy && IT.some(x => x[0] === live.type) ? live.type : (S.wtype.indoor || 'Lift')), lift = ty === 'Lift';
  if (!CTX) S.wtype.indoor = ty; syncType(ty);
  const pdet = !CTX && !busy ? detailOf(p.id, TD) : null;
  const plannedCard = pdet ? `<div style="border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:16px"><div class="lbl">Planned for today</div><div style="margin:6px 0 10px;font-size:14px;line-height:1.5">${detSummary(pdet)}</div><button class="btn sm ctl" data-cstart="1">Start planned workout</button></div>` : '';
  const typeQ = `<div class="lbl" style="margin-bottom:8px">What indoor workout are we going to target?</div><select data-wtype="indoor">${IT.map(([v, n]) => `<option value="${v}" ${v === ty ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const sv = busy ? '' : `<button class="btn ghost ctl" id="${CTX ? 'csaveq' : 'psaveq'}" ${sel.length ? '' : 'disabled style="opacity:.45"'}>Save plan</button>`;
  if (!lift) return W(`${plannedCard}${typeQ}${(lstep() === 'plan' || busy) ? planSection() : `<div class="row" style="margin-top:14px;gap:8px">${sv}<button class="btn ctl" id="lsubmit">Next</button></div>`}`);
  return W(`${plannedCard}${typeQ}<div class="lbl" style="margin:18px 0 4px">What are we training?</div><p class="note" style="margin:0 0 4px">Pick one or more muscle groups.</p><div class="chips">${chips}</div>
    <div class="row" style="margin-top:6px;gap:8px">${sv}<button class="btn ctl" id="lsubmit" ${sel.length ? '' : 'disabled style="opacity:.45"'}>Next</button></div>
    ${lstep() === 'plan' ? planSection() : ''}
    ${logged && !CTX ? `<p class="note" style="margin:10px 0 0">${logged} set${logged === 1 ? '' : 's'} logged today.</p>` : ''}`);
}
function planSection() {
  const plan = lplan(), sel = lsel();
  const block = m => {
    const have = plan[m] || [], extra = have.filter(n => !LIB[m].includes(n)), other = (S.pOther ||= {})[m];
    const chips = [...LIB[m], ...extra].map(n => `<button class="ctl ${have.includes(n) ? 'on' : ''}" data-ptog="${m}|${esc(n)}">${esc(n)}</button>`).join('') + `<button class="ctl ${other ? 'on' : ''}" data-pother="${m}">+ Other</button>`;
    return `<div style="margin-top:18px"><div class="row sp"><div class="lbl">${MNAME[m]}</div>${have.length ? `<span class="badge">${have.length} picked</span>` : ''}</div>
      <div class="chips" style="margin:10px 0 0">${chips}</div>
      ${other ? `<div class="row" style="margin-top:10px;gap:8px"><input type="text" class="ctl" id="pcustom-${m}" placeholder="Lift name" maxlength="80"><button class="btn sm ctl" data-paddc="${m}">Add</button></div>` : ''}</div>`;
  };
  const total = sel.reduce((n, m) => n + (plan[m] || []).length, 0);
  return `<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:16px"><div class="lbl">${(S.wtype.indoor || 'Lift') === 'Lift' ? 'Pick your lifts' : 'Pick your workouts'}</div><p class="note" style="margin:6px 0 0">${(S.wtype.indoor || 'Lift') === 'Lift' ? 'Tap every lift you want to do for each muscle group.' : 'Tap every workout you want to do. Use + Other for your own.'}</p>
    ${sel.map(block).join('')}
    <div class="row" style="margin-top:18px"><button class="btn ctl" id="${CTX ? 'csave' : 'lgo'}" ${total ? '' : 'disabled style="opacity:.45"'}>${CTX ? 'Save workout' : 'Let\'s get after it!'}</button></div></div>`;
}
function lastSummary(rows) {   // just the headline number from the previous session
  const w = Math.max(0, ...rows.map(r => +r.weight || 0)); if (w > 0) return `${w} lb`;
  const t = Math.max(0, ...rows.map(r => r.seconds || 0)); if (t > 0) return fmtTime(t);
  return `${Math.max(0, ...rows.map(r => r.reps || 0))} reps`;
}
function liftTile(p, key) {
  const i = key.indexOf('|'), m = key.slice(0, i), n = key.slice(i + 1);
  const done = todaySets(p.id, n), lt = lastTime(p.id, n), seed = done[done.length - 1] || (lt && lt.rows[0]) || {}, open = !!(S.opn || {})[key], fin = (S.ldone || {})[key];
  // Defaults: today's last set once you have logged one, otherwise the top set from last time. Sets box = sets still to go.
  const top = lt ? lt.rows.slice().sort((a, b) => (+b.weight || 0) - (+a.weight || 0) || a.set_no - b.set_no)[0] : null, src = done[done.length - 1] || top || {};
  const wv = src.weight != null && +src.weight > 0 ? +src.weight : '', rv = src.reps ?? '', tsec = src.seconds || 0;
  const sv = 1, mv = tsec ? Math.floor(tsec / 60) : '', tv = tsec ? tsec % 60 : '';
  const sum = fin ? 'Done' : done.length ? `${done.length} set${done.length === 1 ? '' : 's'}` : 'No sets yet';
  const fld = (cls, label, ph, val, extra = '') => `<label class="fld"><span>${label}</span><input type="number" class="ctl ${cls}" inputmode="${cls === 'lw' ? 'decimal' : 'numeric'}" min="0" ${extra} placeholder="${ph}" value="${val}"></label>`;
  const rows = done.map(r => `<div class="row" style="border-top:1px solid var(--line);padding:8px 0"><span class="badge">Set ${r.set_no}</span><span style="flex:1;font-size:15px">${fmtSet(r)}</span></div>`).join('');
  return `<div class="card dtile lift" data-lb="${esc(key)}" style="padding-bottom:${open ? 14 : 18}px">${GRIP}
    <button class="ctl" data-ltoggle="${esc(key)}" style="display:block;width:100%;background:none;border:0;color:var(--text);font:inherit;padding:0 44px 0 0;text-align:left"><div class="lbl" style="color:var(--acc)">${MNAME[m]}</div>
      <div class="row" style="margin-top:6px;gap:10px"><b style="flex:1;font-size:17px">${esc(n)}</b><span class="badge ${fin ? 'good' : ''}">${fin ? tick + ' ' : ''}${sum}</span><svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${open ? 180 : 0}deg);opacity:.5;flex:none"><path d="M2 5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div></button>
    ${!done.length && !fin && canEdit(p.id) ? `<div class="row" style="margin-top:10px"><button class="btn sm red ctl" data-lremove="${esc(key)}">Remove</button></div>` : ''}
    ${open ? `${lt ? `<p class="note" style="margin:8px 0 0">Last time (${pretty(lt.day)}): ${lastSummary(lt.rows)}</p>` : ''}<div style="margin-top:8px">${rows}</div>
      <div class="lgrid">${fld('lw', 'Weight (lb)', 'lb', wv, 'step="0.5"')}${fld('lr', 'Reps', 'reps', rv)}${fld('ls', 'Sets', '1', sv, 'max="20"')}</div>
      <div class="lgrid two">${fld('lm', 'Time min', 'min', mv)}${fld('lt', 'Time sec', 'sec', tv, 'max="59"')}</div>
      <div class="lbtns"><button class="btn sm ctl" data-logset="1">Log set</button><button class="btn sm amber ctl" data-lundo="1">Undo</button><button class="btn sm blue ctl" data-lcomp="1">Complete</button><button class="btn sm violet ctl" data-lhist="1">Historical lifts</button></div>` : ''}</div>`;
}
function liftSession(p) {
  return `<div id="lifts" data-dragbox="lifts">${lKeys().map(k => liftTile(p, k)).join('')}</div>
    <div class="row" style="margin:2px 0 14px"><button class="btn ghost sm" data-lplan="1">&lsaquo; Modify/Add Workouts</button></div>`;
}
// ---- history page ----
const e1rm = (w, r) => w * (1 + r / 30);
function histDays(u, name) {
  const by = {}; (D.sets[u] || []).filter(r => r.exercise.toLowerCase() === name.toLowerCase()).forEach(r => (by[r.day] ||= []).push(r));
  return Object.keys(by).sort().map(day => ({ day, rows: by[day].sort((a, b) => a.set_no - b.set_no) }));
}
function histMetrics(days) {
  const all = days.flatMap(d => d.rows), M = [];
  if (all.some(r => +r.weight > 0 && r.reps)) {
    M.push({ k: 'e1rm', label: 'Est. 1-rep max', unit: 'lb', f: d => Math.max(0, ...d.rows.filter(r => +r.weight > 0 && r.reps).map(r => e1rm(+r.weight, r.reps))) });
    M.push({ k: 'top', label: 'Top weight', unit: 'lb', f: d => Math.max(0, ...d.rows.map(r => +r.weight || 0)) });
    M.push({ k: 'vol', label: 'Total volume', unit: 'lb', f: d => d.rows.reduce((n, r) => n + (+r.weight || 0) * (r.reps || 0), 0) });
  }
  if (all.some(r => r.reps && !(+r.weight > 0))) M.push({ k: 'reps', label: 'Total reps', unit: 'reps', f: d => d.rows.reduce((n, r) => n + (r.reps || 0), 0) });
  if (all.some(r => r.seconds)) M.push({ k: 'time', label: 'Longest hold', unit: 's', f: d => Math.max(0, ...d.rows.map(r => r.seconds || 0)), fmt: v => fmtTime(Math.round(v)) });
  return M;
}
function histChart(pts, unit, fmt) {
  const W = 340, H = 190, L = 40, R = 14, T = 14, B = 28, ys = pts.map(p => p.v), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * .2 || Math.max(hi * .1, 1);
  const y0 = Math.max(0, lo - pad), y1 = hi + pad, sx = i => pts.length === 1 ? (L + (W - L - R) / 2) : L + i * (W - L - R) / (pts.length - 1), sy = v => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  const f = fmt || (v => String(Math.round(v * 10) / 10)), best = Math.max(...ys);
  const grid = [0, 1, 2].map(i => { const v = y0 + (y1 - y0) * i / 2, y = sy(v); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.08)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" fill="#8da39a" font-size="10">${f(v)}</text>`; }).join('');
  const line = pts.length > 1 ? `<polyline fill="none" stroke="#2fd98f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p, i) => sx(i) + ',' + sy(p.v)).join(' ')}"/>` : '';
  const dots = pts.map((p, i) => `<circle cx="${sx(i)}" cy="${sy(p.v)}" r="5" fill="${p.v === best ? '#e8cf8a' : '#2fd98f'}" stroke="#060c09" stroke-width="2"/><circle class="hpt" data-hi="${i}" cx="${sx(i)}" cy="${sy(p.v)}" r="16" fill="transparent"/>`).join('');
  const xl = pts.length > 1 ? `<text x="${L}" y="${H - 8}" fill="#8da39a" font-size="10">${pretty(pts[0].day)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" fill="#8da39a" font-size="10">${pretty(pts[pts.length - 1].day)}</text>` : `<text x="${sx(0)}" y="${H - 8}" text-anchor="middle" fill="#8da39a" font-size="10">${pretty(pts[0].day)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Progress chart">${grid}${line}${dots}${xl}</svg>`;
}
function liftHistory(p) {
  const { name } = S.hist, days = histDays(p.id, name), M = histMetrics(days);
  const head = `<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" data-lhback="1">&lsaquo; Back to workout</button></div>`;
  if (!days.length) return head + `<div class="card"><div class="lbl">${esc(name)}</div><p class="note" style="margin:8px 0 0">Nothing logged for this lift yet. Log a set and it will show up here.</p></div>`;
  const met = M.find(x => x.k === S.hmetric) || M[0], fmt = met.fmt, f = fmt || (v => String(Math.round(v * 10) / 10));
  const pts = days.map(d => ({ day: d.day, v: met.f(d), d }));
  S._hp = pts.map(x => `${pretty(x.day)}: ${f(x.v)} ${met.unit} (${x.d.rows.map(fmtSet).join(', ').replace(/&middot;/g, '-')})`);
  const first = pts[0].v, last = pts[pts.length - 1].v, best = Math.max(...pts.map(x => x.v)), delta = last - first;
  const trend = pts.length < 2 ? 'Log this lift on another day to see a trend.' : delta > 0 ? `Up ${f(delta)} ${met.unit} since ${pretty(pts[0].day)}.` : delta < 0 ? `Down ${f(-delta)} ${met.unit} since ${pretty(pts[0].day)}.` : `Level with ${pretty(pts[0].day)}.`;
  const chips = M.map(x => `<button data-hmetric="${x.k}" class="${x.k === met.k ? 'on' : ''}">${x.label}</button>`).join('');
  const rows = days.slice().reverse().map(d => `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row sp"><b style="font-size:14px">${pretty(d.day)}</b><span class="note" style="margin:0">${f(met.f(d))} ${met.unit}</span></div><div class="note" style="margin:3px 0 0">${d.rows.map(fmtSet).join(' &middot; ')}</div></div>`).join('');
  return head + `<div class="card"><div class="lbl">${esc(name)}</div>
    <div class="statgrid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)"><div class="tile" style="padding:12px 10px"><span class="lbl" style="font-size:10px">Best</span><b style="font-size:22px">${f(best)}</b><span class="note" style="margin:0;font-size:11px">${met.unit}</span></div><div class="tile" style="padding:12px 10px"><span class="lbl" style="font-size:10px">Latest</span><b style="font-size:22px">${f(last)}</b><span class="note" style="margin:0;font-size:11px">${met.unit}</span></div><div class="tile" style="padding:12px 10px"><span class="lbl" style="font-size:10px">Sessions</span><b style="font-size:22px">${pts.length}</b><span class="note" style="margin:0;font-size:11px">${'logged'}</span></div></div></div>
    <div class="card"><div class="chips" style="margin-top:0">${chips}</div><div class="note" id="hnote" style="margin:0 0 6px">${trend} The gold dot is your best.</div>${histChart(pts, met.unit, fmt)}</div>
    <div class="card"><div class="lbl" style="margin-bottom:4px">Every session</div>${rows}</div>`;
}
// 5 ... 0 countdown. The indoor timer starts the moment it hits 0.
function startCountdown() {
  if ($('cd')) return;
  const el = document.createElement('div'); el.id = 'cd';
  el.style.cssText = 'position:fixed;inset:0;z-index:98;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.86)';
  document.body.appendChild(el);
  let n = 5; const show = () => { el.innerHTML = `<div class="lbl" style="letter-spacing:.35em;font-size:13px;margin-bottom:6px">${n === 0 ? 'GO' : 'GET READY'}</div><div class="cdnum">${n}</div>`; };
  show();
  const iv = setInterval(() => {
    n--; show();
    if (n === 0) { clearInterval(iv); { const u0 = actor().id; S.lstamp = u0 + '|' + sj(lState()); S.llast = Date.now(); saveWorkout({ user_id: u0, day: TD, kind: 'indoor', type: S.wtype.indoor || 'Lift', started_at: new Date().toISOString(), done_at: null, override: false, session: lState() }); } setTimeout(() => el.remove(), 900); }
  }, 1000);
}
function vWorkoutPage(k, p) {
  return header(k === 'indoor' ? '<em>Indoor</em>' : '<em>Outdoor</em>') + testBar(p) +
    (S.hist && k === 'indoor' ? '' : `<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" data-back="1">&lsaquo; Back to workouts</button></div>`) + (k === 'indoor' ? (canEdit(p.id) && lstep() === 'go' ? (S.hist ? liftHistory(p) : wCard(k, p) + liftSession(p)) : wCard(k, p) + liftPick(p)) : wCard(k, p));
}

// ---------- meals: photo, AI estimate, saved favorites ----------
const MSLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const defSlot = () => { const h = new Date().getHours(); return h < 10 ? 'Breakfast' : h < 14 ? 'Lunch' : h < 17 ? 'Snack' : 'Dinner'; };
const mTot = rows => rows.reduce((a, r) => ({ c: a.c + r.calories, p: a.p + r.protein, cb: a.cb + r.carbs, f: a.f + r.fat }), { c: 0, p: 0, cb: 0, f: 0 });
const mLine = r => `${r.calories} cal &middot; ${r.protein}P &middot; ${r.carbs}C &middot; ${r.fat}F`;
const blobB64 = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.readAsDataURL(b); });
const mThumb = r => { const u = S.urls[r.photo_path]; return `<div class="mth" ${u ? `data-pv="${esc(r.photo_path)}" data-cap="${esc(r.name)}" style="background-image:url('${u}')"` : ''}></div>`; };
const mDays = kind => { const n = kind === 'tomorrow' ? [1] : kind === 'week' ? Array.from({ length: (7 - parseYmd(TD).getDay()) % 7 + 1 }, (_, i) => i) : [0]; return n.map(k => addDays(TD, k)); };
const mUses = (uid, name) => (D.mlog || []).filter(r => r.user_id === uid && r.name.toLowerCase() === name.toLowerCase()).length;
function vMeals() {
  const p = viewed(), ed = editable() && canEdit(p.id), mine = r => r.user_id === p.id;
  const today = (D.mlog || []).filter(r => mine(r) && r.day === TD), soon = (D.mlog || []).filter(r => mine(r) && r.day > TD).sort((a, b) => a.day < b.day ? -1 : 1);
  const saved = (D.saved || []).filter(mine).map(r => ({ r, n: mUses(p.id, r.name) })).sort((a, b) => b.n - a.n).map(x => x.r), t = mTot(today);
  const tile = (v, l) => `<div class="mt"><b>${v}</b><span>${l}</span></div>`;
  const row = r => `<div class="mrow">${mThumb(r)}<div class="mi"><b>${esc(r.name)}</b> <span class="badge">${esc(r.slot)}</span><div class="note" style="margin:3px 0 0">${mLine(r)}</div>${ed ? `<button class="link" data-mxedit="meal_log:${r.id}" style="margin-top:4px">Edit</button>` : ''}</div>${ed ? `<button class="xbtn" data-mxdel="${r.id}" aria-label="Remove meal">&times;</button>` : ''}</div>`;
  const add = ed ? `<button class="btn ctl" data-mxadd="1" style="width:100%;margin-top:14px">Add a meal photo</button><div style="text-align:center;margin-top:8px"><button class="link" data-mxtype="1">or type it in</button></div>` : '';
  const favs = saved.length ? saved.map(r => `<div class="mrow" style="align-items:center">${mThumb(r)}<div class="mi"><b>${esc(r.name)}</b><div class="note" style="margin:3px 0 0">${mLine(r)}</div>${S.mopen === r.id && ed ? `<div class="row" style="gap:8px;margin-top:8px"><select id="mre-${r.id}" style="flex:1"><option value="tomorrow">Tomorrow</option><option value="week">Rest of the week</option></select><button class="btn ghost sm ctl" data-mxre="${r.id}">Add</button></div><div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost sm ctl" data-mxedit="saved_meals:${r.id}">Edit</button><button class="btn ghost sm ctl" data-mxsdel="${r.id}">Delete</button></div>` : ''}</div>${ed ? `<button class="btn sm ctl" data-mxq="${r.id}" aria-label="Add ${esc(r.name)} to today">+ Add</button><button class="xbtn" data-mxmore="${r.id}" aria-label="More options">&#8943;</button>` : ''}</div>`).join('') : '<p class="note" style="margin:8px 0 0">Every meal you log is remembered here. Your most common ones rise to the top.</p>';
  const rowsT = DAYN.map((d, i) => `<tr><td>${d}</td>${SLOTS.map(s => `<td contenteditable="true" class="ctl" data-meal="${i}|${s}">${esc(D.meals[i + '|' + s] || '')}</td>`).join('')}</tr>`).join('');
  return header('<em>Meals</em>') + `<div style="height:14px"></div>
   <div class="card"><div class="lbl" style="margin-bottom:10px">${p.id === S.me.id ? 'Today' : esc(p.name) + ' today'}</div>
    <div class="mtot">${tile(t.c, 'cal')}${tile(t.p + 'g', 'protein')}${tile(t.cb + 'g', 'carbs')}${tile(t.f + 'g', 'fat')}</div>
    <div style="margin-top:6px">${today.length ? today.map(row).join('') : '<p class="note" style="margin:12px 0 0">No meals logged yet today.</p>'}</div>${add}</div>
   <div class="card"><div class="lbl">Your meals, one tap</div>${favs}</div>
   ${soon.length ? `<div class="card"><div class="lbl">Coming up</div>${soon.map(r => `<div class="row" style="border-top:1px solid var(--line);padding:8px 0;gap:10px"><span class="badge">${pretty(r.day)}</span><span style="flex:1;font-size:14px"><b>${esc(r.name)}</b> <span class="note">${esc(r.slot)}</span></span>${ed ? `<button class="xbtn" data-mxdel="${r.id}" aria-label="Remove">&times;</button>` : ''}</div>`).join('')}</div>` : ''}
   <div class="card"><div class="lbl" style="margin-bottom:8px">Weekly plan (shared, tap to edit)</div><div><table class="table"><tr><th></th><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>Snack</th></tr>${rowsT}</table></div></div>
   <div class="card"><div class="lbl" style="margin-bottom:6px">Grocery list (shared)</div>
   ${D.groceries.map(g => `<div class="row" style="border-top:1px solid var(--line)"><button class="groc ${g.done ? 'done' : ''}" style="border:0;flex:1" data-g="${g.id}"><span class="box ${g.done ? 'on' : ''}">${g.done ? tick : ''}</span><span>${esc(g.item)}</span></button><button class="xbtn" data-gdel="${g.id}" aria-label="Remove">&times;</button></div>`).join('')}
   <div class="row" style="margin-top:14px"><input type="text" id="gnew" placeholder="Add an item" maxlength="200"><button class="btn sm" id="gadd">Add</button></div></div>`;
}
// The confirm sheet: "I'm seeing these. Add or remove anything, then confirm."
function drawMx() {
  let el = $('mx'); const m = S.mx;
  if (!m) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'mx'; document.body.appendChild(el); }
  const keep = el.scrollTop, num = (k, l) => `<label class="fld"><span>${l}</span><input type="number" inputmode="numeric" min="0" data-mxf="${k}" value="${m[k]}"></label>`;
  const busy = m.step === 'analyzing' || m.step === 'saving';
  el.innerHTML = `<div class="in">${m.url ? `<img src="${m.url}" alt="Your meal" style="width:100%;max-height:220px;object-fit:cover;border-radius:18px">` : ''}
   ${busy ? `<div style="text-align:center;padding:26px 0"><div class="lbl">${m.step === 'saving' ? 'Saving' : m.b64 && !m.items.length ? 'Looking at your meal' : 'Working out the macros'}</div><p class="note">One second.</p></div>` : `
   ${m.err ? `<p class="note" style="color:var(--acc2);margin:12px 0 0">${esc(m.err)}</p>` : ''}
   <input type="text" data-mxf="name" value="${esc(m.name)}" maxlength="80" placeholder="Name this meal" style="margin-top:14px;font-size:20px;font-weight:700">
   <div class="lbl" style="margin-top:16px">${m.edit ? 'Ingredients' : m.items.length ? "I'm seeing" : m.b64 ? "Add what's on the plate" : 'What is in it'}</div>
   ${m.items.map((i, k) => `<div class="row" style="padding:9px 0;border-top:1px solid var(--line);gap:10px"><span style="flex:1;font-size:16px">${esc((i.qty ? i.qty + ' ' : '') + i.name)}</span><button class="xbtn" data-mx="deli" data-i="${k}" aria-label="Take out">&times;</button></div>`).join('')}
   <div class="row" style="gap:8px;margin-top:10px"><input type="text" id="mxnew" placeholder="Add something (e.g. 2 eggs)" maxlength="80"><button class="btn ghost sm" data-mx="addi">Add</button></div>
   ${m.note ? `<p class="note" style="margin:10px 0 0">${esc(m.note)}</p>` : ''}
   <div class="lbl" style="margin-top:18px">Macros</div>
   <div class="lgrid" style="grid-template-columns:1fr 1fr">${num('cal', 'Calories')}${num('pro', 'Protein (g)')}</div><div class="lgrid" style="grid-template-columns:1fr 1fr">${num('carb', 'Carbs (g)')}${num('fat', 'Fat (g)')}</div>
   <p class="note" id="mxst" style="margin:6px 0 0">${m.dirty || m.calcing ? 'Updating macros...' : esc(m.calcErr || 'Edit any number if it looks off.')}</p>
   <div class="row" style="gap:10px;margin-top:16px"><button class="btn" data-mx="log" style="flex:1">${m.edit ? 'Save changes' : 'Confirm and log'}</button><button class="btn ghost" data-mx="cancel">Cancel</button></div>
   ${m.edit && m.edit.table === 'saved_meals' ? '' : `<div style="text-align:center;margin-top:12px"><select data-mxf="slot" style="width:auto;display:inline-block">${MSLOTS.map(x => `<option ${x === m.slot ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`}`}
  </div>`;
  el.scrollTop = keep;
}
async function mxAI(mode) {
  const m = S.mx; if (!m) return; m.step = 'analyzing'; m.err = ''; drawMx();
  try {
    const body = mode === 'recalc' ? { mode, name: m.name, items: m.items.filter(i => i.name.trim()) } : { mode, image: m.b64 };
    const { data, error } = await sb.functions.invoke('analyze-meal', { body });
    if (S.mx !== m) return;
    const why = { no_key: "AI isn't connected yet, so type the macros in below.", bad_key: "The AI key was rejected. Check the numbers below.", rate_limited: "The free AI is busy right now. Wait a minute and try again, or type the macros in below.", daily_limit: "That is the daily AI limit. Type the macros in below, and it resets tomorrow." };
    if (error || !data || data.error) m.err = (data && why[data.error]) || "Couldn't work that out. Check the numbers below.";
    else {
      if (mode === 'identify' || !m.name.trim()) m.name = data.name;
      if (mode === 'identify') m.items = data.items;
      m.cal = data.calories; m.pro = data.protein; m.carb = data.carbs; m.fat = data.fat; m.note = data.note || ''; m.dirty = false;
    }
  } catch (e) { if (S.mx !== m) return; m.err = "Couldn't reach the analyzer. Check the numbers below."; }
  m.step = 'review'; drawMx();
}
// Re-work the macros from the current ingredient list, quietly, a moment after the last change.
function mxSoon() { const m = S.mx; if (!m) return; m.dirty = true; clearTimeout(mxSoon.t); mxStatus(); mxSoon.t = setTimeout(mxCalc, 900); }
function mxStatus() { const el = $('mxst'), m = S.mx; if (el && m) el.textContent = m.calcing ? 'Updating macros...' : m.dirty ? 'Updating macros...' : (m.calcErr || 'Edit any number if it looks off.'); }
async function mxCalc() {
  const m = S.mx; if (!m) return;
  const list = m.items.filter(i => i.name.trim()); if (!list.length) { m.dirty = false; mxStatus(); return; }
  const sig = sj(list) + '|' + m.name; m.calcing = sig; m.calcErr = ''; mxStatus();
  try {
    const { data, error } = await sb.functions.invoke('analyze-meal', { body: { mode: 'recalc', name: m.name, items: list } });
    if (S.mx !== m || m.calcing !== sig) return;   // the list changed again, a newer calculation is on its way
    if (error || !data || data.error) m.calcErr = data && data.error === 'daily_limit' ? 'Daily AI limit reached. Edit the numbers by hand.' : "Couldn't update the macros. Edit the numbers by hand.";
    else { m.cal = data.calories; m.pro = data.protein; m.carb = data.carbs; m.fat = data.fat; m.note = data.note || ''; m.dirty = false; for (const [k, v] of [['cal', m.cal], ['pro', m.pro], ['carb', m.carb], ['fat', m.fat]]) { const i = document.querySelector(`#mx [data-mxf=${k}]`); if (i) i.value = v; } }
  } catch (e) { if (S.mx === m && m.calcing === sig) m.calcErr = "Couldn't update the macros. Edit the numbers by hand."; }
  if (S.mx === m && m.calcing === sig) m.calcing = false;
  mxStatus();
}
function mxOpen(extra) { return S.mx = { step: 'review', slot: defSlot(), name: '', items: [], cal: 0, pro: 0, carb: 0, fat: 0, note: '', err: '', dirty: false, ...extra }; }
async function mxStart(file) {
  const m = mxOpen({ step: 'analyzing' }); drawMx();
  try { const blob = await compress(file, 1024); m.blob = blob; m.url = URL.createObjectURL(blob); m.b64 = await blobB64(blob); drawMx(); await mxAI('identify'); }
  catch (e) { if (S.mx !== m) return; m.err = "Couldn't read that photo."; m.step = 'review'; drawMx(); }
}
function mxEdit(table, id) {
  const r = (table === 'meal_log' ? D.mlog : D.saved || []).find(x => x.id === id); if (!r) return;
  mxOpen({ edit: { table, id }, name: r.name, items: (r.items || []).map(i => ({ name: i.name, qty: i.qty || '' })), cal: r.calories, pro: r.protein, carb: r.carbs, fat: r.fat, slot: r.slot || defSlot(), url: r.photo_path ? S.urls[r.photo_path] || null : null });
  drawMx();
}
async function mxSaveEdit() {
  const m = S.mx; if (!m || !m.edit) return;
  const addEl = $('mxnew'); if (addEl && addEl.value.trim()) { m.items.push({ name: addEl.value.trim(), qty: '' }); m.dirty = true; }
  clearTimeout(mxSoon.t);
  if (m.dirty && m.items.some(i => i.name.trim())) { m.step = 'saving'; drawMx(); await mxCalc(); if (S.mx !== m) return; }
  const name = m.name.trim() || (m.items[0] && m.items[0].name); if (!name) { m.step = 'review'; drawMx(); toast('Name the meal first.'); return; }
  m.step = 'saving'; drawMx();
  const patch = { name, items: m.items.filter(i => i.name.trim()), calories: m.cal, protein: m.pro, carbs: m.carb, fat: m.fat };
  if (m.edit.table === 'meal_log') patch.slot = m.slot;
  try { await must(sb.from(m.edit.table).update(patch).eq('id', m.edit.id)); S.mx = null; drawMx(); await loadAll(); render(); toast('Saved.'); }
  catch (e) { if (S.mx === m) { m.step = 'review'; drawMx(); } }
}
async function mxLog() {
  const m = S.mx; if (!m) return;
  if (m.edit) return mxSaveEdit();
  const addEl = $('mxnew'); if (addEl && addEl.value.trim()) { m.items.push({ name: addEl.value.trim(), qty: '' }); m.dirty = true; }
  if (!m.name.trim() && !m.items.length) { toast('Name the meal first.'); return; }
  clearTimeout(mxSoon.t);
  if (m.dirty && m.items.some(i => i.name.trim())) { m.step = 'saving'; drawMx(); await mxCalc(); if (S.mx !== m) return; }
  const name = m.name.trim() || m.items[0].name; const u = actor().id; m.step = 'saving'; drawMx();
  try {
    let path = null;
    if (m.blob) { path = `${u}/meals/${crypto.randomUUID()}.jpg`; const up = await sb.storage.from('progress-photos').upload(path, m.blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error; S.urls[path] = m.url; }
    const row = { user_id: u, name, photo_path: path, items: m.items.filter(i => i.name.trim()), calories: m.cal, protein: m.pro, carbs: m.carb, fat: m.fat };
    await must(sb.from('meal_log').insert({ ...row, day: TD, slot: m.slot }));
    const old = (D.saved || []).find(x => x.user_id === u && x.name.toLowerCase() === name.toLowerCase());
    if (old) await must(sb.from('saved_meals').update({ items: row.items, calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, photo_path: old.photo_path || path }).eq('id', old.id));
    else await must(sb.from('saved_meals').insert(row));
    S.mx = null; drawMx(); await loadAll(); render(); toast(`${name} logged.`);
  } catch (e) { if (S.mx === m) { m.step = 'review'; drawMx(); } toast('Could not save: ' + (e.message || e)); }
}
function dropPhoto(path) {   // delete the file only when nothing else points at it
  if (!path) return; const used = [...(D.mlog || []), ...(D.saved || [])].some(r => r.photo_path === path);
  if (!used) sb.storage.from('progress-photos').remove([path]);
}
async function mxAddDays(r, days, slot) {
  const u = actor().id;
  await must(sb.from('meal_log').insert(days.map(day => ({ user_id: u, day, slot, name: r.name, photo_path: r.photo_path, items: r.items, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }))));
  await loadAll(); render();
}
async function mxAction(d, t) {
  const m = S.mx;
  if (d.mxadd) { $('mph').click(); return; }
  if (d.mxedit) { const [tb, id] = d.mxedit.split(':'); if (editable()) mxEdit(tb, id); return; }
  if (d.mxtype) { mxOpen(); drawMx(); return; }
  if (d.mxmore) { S.mopen = S.mopen === d.mxmore ? null : d.mxmore; render(); return; }
  if (d.mxq) { const r = (D.saved || []).find(x => x.id === d.mxq); if (!r || !editable()) return; await mxAddDays(r, [TD], defSlot()); toast(`${r.name} added.`); return; }
  if (d.mxre) {
    const r = (D.saved || []).find(x => x.id === d.mxre); if (!r || !editable()) return;
    const days = mDays($('mre-' + r.id).value); S.mopen = null; await mxAddDays(r, days, defSlot()); toast(days.length === 1 ? 'Added.' : `Added to ${days.length} days.`); return;
  }
  if (d.mxdel) { const r = (D.mlog || []).find(x => x.id === d.mxdel); D.mlog = (D.mlog || []).filter(x => x.id !== d.mxdel); render(); const { error } = await sb.from('meal_log').delete().eq('id', d.mxdel); if (error) { toast(error.message); await loadAll(); render(); } else if (r) dropPhoto(r.photo_path); return; }
  if (d.mxsdel) { if (!confirm('Delete this saved meal? Your past logs stay.')) return; const r = (D.saved || []).find(x => x.id === d.mxsdel); D.saved = (D.saved || []).filter(x => x.id !== d.mxsdel); S.mopen = null; render(); const { error } = await sb.from('saved_meals').delete().eq('id', d.mxsdel); if (error) { toast(error.message); await loadAll(); render(); } else if (r) dropPhoto(r.photo_path); return; }
  if (!m) return;
  if (d.mx === 'cancel') { S.mx = null; drawMx(); return; }
  if (d.mx === 'addi') { const el = $('mxnew'), v = el ? el.value.trim() : ''; if (!v) return; m.items.push({ name: v, qty: '' }); drawMx(); mxSoon(); const n = $('mxnew'); if (n) n.focus(); return; }
  if (d.mx === 'deli') { m.items.splice(+d.i, 1); drawMx(); mxSoon(); return; }
  if (d.mx === 'log') return mxLog();
}
document.addEventListener('input', e => {
  const t = e.target, m = S.mx; if (!m) return;
  if (t.dataset.mxf) { const k = t.dataset.mxf; if (k === 'name' || k === 'slot') m[k] = t.value; else m[k] = Math.max(0, Math.round(+t.value || 0)); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'mxnew') { e.preventDefault(); mxAction({ mx: 'addi' }, e.target); } });
function jugsFor(p) { return p.water_style === 'teacup' ? [40, 40, 40] : [40, 40, 40, 8]; }
// Same wording the server sends. Keep in sync with MESSAGES in supabase/functions/water-reminders/index.ts.
const REMINDER_MSG = { taylor: "Go fill er' up! You're at {oz} of 128oz.", daddy: "Drink up pussy! You're only at {oz} of 128oz.", tyler: "Drink up pussy! You're only at {oz} of 128oz." };
function reminderText(p, oz) { return (REMINDER_MSG[String(p.name).trim().toLowerCase()] || "Time to drink up! You're at {oz} of 128oz.").replace('{oz}', oz); }
function ntText() { const v = viewed(); return esc(reminderText(v, dailyRow(v.id, TD).water_oz)); }
const NICON = '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#2fd98f" stroke-width="2.4"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="#c9e25f" stroke-width="2.4"/></svg>';
function showBanner() {
  const b = $('banner');
  b.innerHTML = `<div class="ic">${NICON}</div><div style="flex:1"><div class="t">Water Reminder<span>now</span></div><div class="m">${ntText()}</div></div>`;
  b.classList.add('show'); clearTimeout(showBanner.t); showBanner.t = setTimeout(() => b.classList.remove('show'), 4500);
}
// ---------- celebration ----------
function celebrate(big, sub) {
  if ($('party')) return;
  const el = document.createElement('div'); el.id = 'party';
  el.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);animation:pfade .3s';
  el.innerHTML = `<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas><div style="position:relative;text-align:center;padding:0 24px;animation:ppop .5s cubic-bezier(.2,1.6,.4,1)"><div style="font-size:84px;line-height:1">&#127881;</div><div class="num" style="font-size:44px;font-weight:800;margin-top:10px;color:#fff">${big}</div><div style="font-size:17px;margin-top:8px;color:#cfe;">${sub}</div><div style="font-size:12px;margin-top:20px;opacity:.6">Tap anywhere to close</div></div>`;
  if (!$('partyCss')) { const st = document.createElement('style'); st.id = 'partyCss'; st.textContent = '@keyframes pfade{from{opacity:0}to{opacity:1}}@keyframes ppop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}'; document.head.appendChild(st); }
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), dpr = window.devicePixelRatio || 1, W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr, cx = cv.getContext('2d');
  const cols = [...Object.values(COLORS), '#ffffff'];
  const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: -Math.random() * H * .6, w: (5 + Math.random() * 7) * dpr, h: (8 + Math.random() * 10) * dpr, vy: (2 + Math.random() * 4) * dpr, vx: (Math.random() - .5) * 3 * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  let raf; const t0 = Date.now();
  const step = () => { cx.clearRect(0, 0, W, H); for (const b of bits) { b.x += b.vx; b.y += b.vy; b.r += b.vr; cx.save(); cx.translate(b.x, b.y); cx.rotate(b.r); cx.fillStyle = b.c; cx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); cx.restore(); } if (Date.now() - t0 < 5000) raf = requestAnimationFrame(step); };
  step();
  const close = () => { cancelAnimationFrame(raf); el.remove(); };
  el.addEventListener('click', close); setTimeout(close, 6500);
}
const water128 = () => { const n = S.me && S.me.name; celebrate('128 oz. Done!', /^taylor$/i.test(n) ? 'The whole gallon, tea included. Go you!' : 'Full gallon. Crushed it!'); };

// ---------- push reminders ----------
const PUSH = { st: 'checking' };
const b64uToU8 = b => { const p = '='.repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function pushCheck() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) PUSH.st = 'unsupported';
  else if (Notification.permission === 'denied') PUSH.st = 'denied';
  else { try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); PUSH.st = sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch (_) { PUSH.st = 'off'; } }
  render();
}
async function pushEnable() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { PUSH.st = perm === 'denied' ? 'denied' : 'off'; render(); return; }
    const key = (await (await fetch(SB_URL + '/functions/v1/water-reminders')).json()).publicKey;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(key) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint', ignoreDuplicates: true });
    if (error) throw error;
    PUSH.st = 'on'; toast('Reminders are on for this phone.');
  } catch (e) { toast('Could not turn on reminders: ' + (e.message || e)); PUSH.st = 'off'; }
  render();
}
async function pushDisable() {
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); } } catch (_) { }
  PUSH.st = 'off'; toast('Reminders are off for this phone.'); render();
}
function pushCard() {
  const mine = viewed().id === S.me.id, st = PUSH.st;
  const badge = st === 'on' ? '<span class="badge good">On</span>' : '<span class="badge">Off</span>';
  let msg = '', btn = '';
  if (!mine) msg = 'Reminders are set up on each person\'s own phone.';
  else if (st === 'unsupported') msg = 'Open the app from your Home Screen icon to turn reminders on. They do not work from a Safari tab.';
  else if (st === 'denied') msg = 'Notifications are blocked. Go to Settings > Notifications > 75 Hard and allow them, then come back.';
  else if (st === 'on') { msg = 'You will get a nudge at these times (Eastern) until you hit 128 oz for the day.'; btn = '<button class="btn ghost sm" id="pushOff">Turn off</button><button class="btn ghost sm" id="pushTest" style="margin-left:8px">Send a test</button>'; }
  else btn = '<button class="btn sm" id="pushOn">Turn on reminders</button>';
  return `<div class="card"><div class="row sp"><div><div class="lbl">Reminders</div><div style="margin-top:6px;font-size:14px">10 am &middot; 12 pm &middot; 2 pm &middot; 4 pm &middot; 6 pm</div></div>${mine ? badge : ''}</div>${msg ? `<p class="note" style="margin-top:10px">${msg}</p>` : ''}${btn && mine ? `<div class="row" style="margin-top:12px">${btn}</div>` : ''}</div>`;
}
const isDaddy = p => ['daddy', 'tyler'].includes(String(p.name).trim().toLowerCase());
function aminoCard(p, dr) {
  if (!isDaddy(p)) return '';
  const on = !!dr.amino, ed = editable() && canEdit(p.id);
  const r = ring(130, 12, on ? 1 : 0, WATERBLUE, `<span class="num" style="font-size:30px;font-weight:800">${on ? tick : '8 oz'}</span><span class="lbl">amino</span>`);
  return `<div class="card" style="text-align:center">${ed ? `<button class="ctl" data-amino="1" style="background:none;border:0;padding:0;color:inherit" aria-label="Amino drink">${r}</button>` : r}</div>`;
}
const isTaylor = p => /^taylor$/i.test(String(p && p.name).trim());
const exOz = r => (r.amino ? 8 : 0) + (r.coffee_n || 0) * 6 + (r.protein_n || 0) * 12;   // ounces from amino, coffee and protein water
function extrasCard(p, dr) {
  const ed = editable() && canEdit(p.id), row = (k, name, oz, n) => `<div class="xtra"><div class="xl"><b>${name}</b><span>${oz} oz each &middot; ${n * oz} oz so far</span></div>${ed ? `<button class="btn ghost sm ctl" data-xtra="${k}" data-dx="-1" aria-label="Remove one ${name}">-</button>` : ''}<span class="xn">${n}</span>${ed ? `<button class="btn sm ctl" data-xtra="${k}" data-dx="1" aria-label="Add one ${name}">+</button>` : ''}</div>`;
  return `<div class="card"><div class="lbl" style="margin-bottom:4px">Also counts toward your 128</div>${row('coffee_n', 'Coffee', 6, dr.coffee_n || 0)}${row('protein_n', 'Protein water', 12, dr.protein_n || 0)}</div>`;
}
function vWater() {
  if (S.view === 'split' && partner()) return splitWater();
  const p = viewed(), dr = dailyRow(p.id, TD), oz = dr.water_oz, am = dr.amino ? 8 : 0, ex = exOz(dr), WC = WATERBLUE, js = jugsFor(p), tea = p.water_style === 'teacup';
  let used = 0; const items = js.map((sz, i) => { used += sz; return { sz, i, filled: (isDaddy(p) && js.length === 4 && i === 3) ? !!am : oz - ex >= used }; });
  const jugSvg = (sz, filled, anim) => { const w = sz === 40 ? 56 : 44, h = sz === 40 ? 96 : 76;
    const body = anim ? 'transparent' : (filled ? WC : 'transparent');
    return `<svg width="${w}" height="${h}" viewBox="0 0 56 96"><rect x="20" y="2" width="16" height="8" rx="3" fill="none" stroke="${WC}" stroke-width="2"/>${anim ? `<rect class="liquid" x="6" y="12" width="44" height="82" rx="14" fill="${WC}" fill-opacity=".85"/>` : ''}<rect x="6" y="12" width="44" height="82" rx="14" fill="${body}" fill-opacity=".85" stroke="${WC}" stroke-width="2.5" style="filter:drop-shadow(0 0 ${filled ? 9 : 2}px ${WC})"/></svg>`; };
  const cup = f => `<svg width="56" height="64" viewBox="0 0 56 64"><path d="M8 18h34v20a14 14 0 01-14 14h-6A14 14 0 018 38z" fill="${f ? WC : 'transparent'}" fill-opacity=".85" stroke="${WC}" stroke-width="2.5" style="filter:drop-shadow(0 0 ${f ? 9 : 2}px ${WC})"/><path d="M42 24h4a6 6 0 010 14h-5" fill="none" stroke="${WC}" stroke-width="2.5"/><path d="M18 8c-2 3 2 4 0 7M28 8c-2 3 2 4 0 7" fill="none" stroke="${WC}" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>`;
  const aj = isDaddy(p) && js.length === 4;
  const jugBtns = items.map(x => { const am8 = aj && x.i === 3; return `<button class="jug ctl" ${am8 ? 'data-amino="1"' : `data-jug="${x.i}"`}>${jugSvg(x.sz, x.filled, am8 && S.anim === 'amino' && x.filled)}<span>${x.sz} OZ${am8 ? ' &middot; AMINO' : ''}</span></button>`; }).join('');
  const cupBtn = tea ? `<button class="jug ctl" data-cup="1">${cup(oz - ex >= 128)}<span>TEA &middot; 8 OZ</span></button>` : '';
  return header('<em>Water</em>') + testBar(p) + `<div class="card" style="text-align:center">${ring(176, 12, Math.min(oz / WATER, 1), WC, `<span class="num" style="font-size:40px;font-weight:800">${oz}</span><span class="lbl">of 128 oz</span>`)}
   <div class="jugs">${jugBtns}${cupBtn}</div><p class="note">Tap each jug when you finish it.${tea ? ' Your last 8 oz is the tea at night.' : ''}</p></div>
   ${aminoCard(p, dr)}
   ${isTaylor(p) ? extrasCard(p, dr) : ''}
   ${pushCard()}`;
}

function vReading() {
  if (S.view === 'split' && partner()) return splitReading();
  const p = viewed(), r = dailyRow(p.id, TD), bs = D.books[p.id] || [];
  return header('<em>Reading</em>') + testBar(p) + `<div class="card" style="text-align:center">${ring(156, 12, Math.min(r.pages / 10, 1), COLORS.reading, `<span class="num" style="font-size:38px;font-weight:800">${r.pages}</span><span class="lbl">of 10 pages</span>`)}
   <div class="row" style="justify-content:center;margin-top:16px"><button class="btn ghost sm ctl" data-pg="-1">-1</button><button class="btn sm ctl" data-pg="1">+1</button><button class="btn sm ctl" data-pg="5">+5</button><button class="btn sm ctl" data-pg="10">+10</button></div>
   <p class="note" style="margin-top:12px">10 pages minimum. Reading more is great and counts toward your book.<br>Reminder: non-fiction, physical book, no audiobooks.</p></div>
   <div class="card"><div class="lbl" style="margin-bottom:10px">Books</div>
   ${bs.length ? bs.map(x => `<div style="margin-bottom:14px"><div class="row sp"><b>${esc(x.title)}</b><span class="note">${x.read_pages}/${x.total_pages}</span></div><div class="bar"><i style="width:${Math.min(x.read_pages / x.total_pages * 100, 100)}%"></i></div></div>`).join('') : '<p class="note">No books yet. Add one once you\'ve picked it.</p>'}
   <div class="row ctl" style="margin-top:6px"><input type="text" id="bt" placeholder="Book title" maxlength="200"><input type="number" id="bn" placeholder="Pages" style="width:100px" min="1"></div>
   <div style="margin-top:12px"><button class="btn sm ctl" id="badd">Add book</button></div></div>`;
}

function nextCheck(p) { const ws = D.weigh[p.id] || []; if (!ws.length) return 1; const last = ws[ws.length - 1].day_num; return CHECKS.find(c => c > last) || null; }
function chart(p) {
  const ws = D.weigh[p.id] || []; if (ws.length < 2) return '<p class="note" style="margin:10px 0 0">Your weight line will appear here after your second weigh-in.</p>';
  const W = 340, H = 200, L = 44, R = 14, T = 22, B = 40, vals = ws.map(x => +x.weight);
  let mn = Math.floor(Math.min(...vals) - 2), mx = Math.ceil(Math.max(...vals) + 2); if (mx - mn < 6) { mn -= 3; mx += 3; }
  const X = d => L + (d - 1) / 74 * (W - L - R), Y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const pts = ws.map(x => [X(x.day_num), Y(+x.weight)]);
  const grid = [0, 1, 2, 3].map(i => { const v = mn + (mx - mn) * i / 3, y = Y(v); return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="rgba(255,255,255,.1)"/><text x="${L - 6}" y="${y + 3}" fill="#8da396" font-size="10" text-anchor="end">${Math.round(v * 10) / 10}</text>`; }).join('');
  const ticks = ws.map(x => `<line x1="${X(x.day_num)}" y1="${H - B}" x2="${X(x.day_num)}" y2="${H - B + 4}" stroke="#8da396"/><text x="${X(x.day_num)}" y="${H - B + 16}" fill="#eaf4ee" font-size="10" text-anchor="middle">${x.day_num}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="margin-top:12px" role="img" aria-label="Weight by weigh-in day">${grid}<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#8da396"/>${ticks}
   <text x="${L - 6}" y="12" fill="#8da396" font-size="10" text-anchor="end">lb</text><text x="${(L + W - R) / 2}" y="${H - 6}" fill="#8da396" font-size="10" text-anchor="middle">Weigh-in day</text>
   <polyline points="${pts.map(q => q.join(',')).join(' ')}" fill="none" stroke="#30d158" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
   ${pts.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="#30d158" stroke="#060c09" stroke-width="2"/><text x="${q[0]}" y="${q[1] - 9}" fill="#eaf4ee" font-size="10" text-anchor="middle">${+ws[i].weight}</text>`).join('')}</svg>`;
}
const PROG_IDS = ['numbers', 'days', 'fun'];
function funTile(view) {
  const list = D.fun || [], who = id => (D.profiles.find(p => p.id === id) || {}).name || '';
  const cells = list.map(f => { const u = S.urls[f.path]; return `<div class="fthumb" ${u ? `data-pv="${esc(f.path)}" data-fid="${f.id}" data-cap="${esc(who(f.user_id))} &middot; ${pretty(f.taken_on)}" style="background-image:url('${u}')"` : ''}></div>`; }).join('');
  return `<div class="card${view ? '' : ' dtile'}" data-tile="fun">${view ? '' : GRIP}<div class="lbl" style="padding-right:44px">Fun Photos</div><p class="note" style="margin:6px 0 12px">${list.length ? list.length + ' memor' + (list.length === 1 ? 'y' : 'ies') + ' from the journey.' : view ? 'No fun photos yet. Add some from your Progress page.' : 'Add photos of the good moments along the way.'}</p>${view ? '' : '<button class="btn sm ctl" data-funadd="1">Add photos</button>'}${list.length ? `<div class="fungrid">${cells}</div>` : ''}</div>`;
}
function progOrder() {
  try { let o = JSON.parse(localStorage.getItem('progOrder')); if (Array.isArray(o)) { o = o.filter(k => PROG_IDS.includes(k)); for (const k of PROG_IDS) if (!o.includes(k)) o.push(k); return o; } } catch (_) { }
  return PROG_IDS.slice();
}
function vProgress() {
  if (S.view === 'split' && partner()) return splitProgress();
  const p = viewed(), ws = D.weigh[p.id] || [], mine = canEdit(p.id) && editable();
  const w1 = ws.find(x => x.day_num === 1), last = ws.length ? ws[ws.length - 1] : null;
  const start = w1 ? +w1.weight : null, cur = last ? +last.weight : null;
  const diff = start !== null && cur !== null && last !== w1 ? Math.round((cur - start) * 10) / 10 : null;
  const ht = `${Math.floor(p.height_in / 12)}'${p.height_in % 12}"`;
  const n = dayNum(p);
  const photoOf = d => D.daily[dkey(p.id, d)]?.photo_path;
  const todayPh = photoOf(TD), done = !!todayPh;
  const cells = Array.from({ length: 75 }, (_, i) => { const dd = addDays(p.start_date, i), ph = photoOf(dd); const u = ph && S.urls[ph]; return `<div class="${ph ? 'has' : ''} thumb" ${u ? `data-pv="${esc(ph)}" data-cap="Day ${i + 1} &middot; ${pretty(dd)}" style="background-image:url('${u}')"` : ''}>${i + 1}</div>`; }).join('');
  const due = CHECKS.find(c => n >= c && !ws.some(x => x.day_num === c));
  const slots = CHECKS.map(c => {
    const rec = ws.find(x => x.day_num === c), open = n >= c;
    return `<div class="row" style="gap:8px;margin-top:8px"><div style="width:62px;font-size:14px;font-weight:700">Day ${c}</div>${open || rec ? `<input type="number" class="ctl" id="wt-${c}" placeholder="lb" step="0.1" min="50" max="600" value="${rec ? +rec.weight : ''}" ${mine ? '' : 'disabled'}>${mine ? `<button class="btn sm ctl" data-wslot="${c}" style="white-space:nowrap">${rec ? 'Update' : 'Log'}</button>` : ''}${due === c ? '<span class="badge">Due</span>' : ''}` : `<span class="note" style="margin:0">Unlocks on Day ${c}</span>`}</div>`;
  }).join('');
  const tiles = {
    numbers: `<div class="card dtile" data-tile="numbers">${GRIP}<div class="lbl" style="margin-bottom:12px;padding-right:44px">${esc(p.name)}'s numbers</div>
   <div class="statgrid">
    <div class="tile"><span class="lbl">Starting height</span><b>${ht}</b></div>
    <div class="tile"><span class="lbl">Starting weight</span><b>${start ?? '--'} <small>lb</small></b></div>
    <div class="tile"><span class="lbl">Current weight</span><b>${cur ?? '--'} <small>lb</small></b></div>
    <div class="tile hi"><span class="lbl">Change</span><b>${diff === null ? '--' : (diff > 0 ? '+' : '') + diff} <small>lb</small></b></div>
   </div>
   <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="lbl">Weigh-ins &middot; every 10 days</div>${due ? `<p style="margin:8px 0 0;font-size:15px"><b>Day ${due} weigh-in is due.</b> Step on the scale and log it below.</p>` : ''}${slots}</div>
   ${chart(p)}</div>`,
    days: `<div class="card dtile" data-tile="days"><div style="padding-right:44px" class="lbl">Progress Photos</div>${GRIP}<div class="grid75" style="margin-top:10px">${cells}</div></div>`,
    fun: funTile()
  };
  return header('<em>Progress</em>') + `<div id="ptiles" data-dragbox="progress">${progOrder().map(k => tiles[k]).join('')}</div>`;
}

function splitVal(p, n) {
  const r = dailyRow(p.id, TD);
  if (n === 'indoor' || n === 'outdoor') { const w = wInfo(wRow(p.id, TD, n)); return w.st === 'done' ? 'Done' : w.st === 'running' ? mmss(w.left) : w.st === 'paused' ? 'Paused' : 'Not yet'; }
  if (n === 'water') return r.water_oz + ' oz';
  if (n === 'reading') return r.pages + ' pages';
  return r.photo_path ? 'Done' : 'Not yet';
}
function splitCols(fn) {
  const pr = partner();
  return `<div class="split">${[S.me, pr].map(p => `<div class="p"><h3>${esc(p.name)}</h3>${fn(p)}</div>`).join('')}</div>
  <p class="note" style="margin-top:12px">Live view. Tap ${esc(S.me.name)} at the top to log your own, or ${esc(pr.name)} to look at theirs.</p>`;
}
const jugMini = (filled) => `<svg width="24" height="42" viewBox="0 0 56 96"><rect x="20" y="2" width="16" height="8" rx="3" fill="none" stroke="${WATERBLUE}" stroke-width="3"/><rect x="6" y="12" width="44" height="82" rx="14" fill="${filled ? WATERBLUE : 'transparent'}" fill-opacity=".85" stroke="${WATERBLUE}" stroke-width="4"/></svg>`;
function splitWater() {
  return header('<em>Water</em>') + splitCols(p => {
    const oz = dailyRow(p.id, TD).water_oz, js = jugsFor(p); let used = 0;
    const jugs = js.map(sz => { used += sz; return jugMini(oz >= used); }).join('') + (p.water_style === 'teacup' ? `<span style="font-size:20px;opacity:${oz >= 128 ? 1 : .35}">&#9749;</span>` : '');
    return `<div style="text-align:center">${ring(110, 10, Math.min(oz / WATER, 1), WATERBLUE, `<span class="num" style="font-size:26px;font-weight:800">${oz}</span><span class="lbl">of 128 oz</span>`)}</div><div class="row" style="justify-content:center;gap:6px;margin-top:10px;align-items:flex-end">${jugs}</div>`;
  });
}
function splitWorkouts() {
  return header('Work<em>outs</em>') + splitCols(p => ['indoor', 'outdoor'].map(k => {
    const row = wRow(p.id, TD, k), w = wInfo(row);
    const txt = w.st === 'done' ? `Done &middot; ${esc(row.type)}` : w.st === 'running' || w.st === 'paused' ? `${mmss(w.left)} ${w.st === 'paused' ? 'paused' : 'left'} &middot; ${esc(row.type)}` : 'Not started';
    return `<div style="margin:10px 0">${'<div class="lbl">' + (k === 'indoor' ? 'Indoor' : 'Outdoor') + '</div>'}<div class="row" style="margin-top:6px;gap:10px">${ring(34, 5, w.frac, COLORS[k])}<span style="font-size:13px">${txt}</span></div></div>`;
  }).join(''));
}
function splitReading() {
  return header('<em>Reading</em>') + splitCols(p => {
    const r = dailyRow(p.id, TD), b = (D.books[p.id] || []).find(x => x.read_pages < x.total_pages) || (D.books[p.id] || [])[0];
    return `<div style="text-align:center">${ring(110, 10, Math.min(r.pages / 10, 1), COLORS.reading, `<span class="num" style="font-size:26px;font-weight:800">${r.pages}</span><span class="lbl">of 10 pages</span>`)}</div>
    ${b ? `<div style="margin-top:12px;font-size:13px"><b>${esc(b.title)}</b><div class="bar"><i style="width:${Math.min(b.read_pages / b.total_pages * 100, 100)}%"></i></div><div class="note" style="margin-top:4px">${b.read_pages}/${b.total_pages} pages</div></div>` : '<p class="note" style="margin-top:12px">No book added yet.</p>'}`;
  });
}
function splitProgress() {
  return header('<em>Progress</em>') + splitCols(p => {
    const ws = D.weigh[p.id] || [], st = ws[0]?.weight, cu = ws[ws.length - 1]?.weight, diff = ws.length ? Math.round((cu - st) * 10) / 10 : null;
    const ph = dailyRow(p.id, TD).photo_path, url = ph && S.urls[ph];
    const tile = (l, v, hi) => `<div class="tile${hi ? ' hi' : ''}" style="padding:10px;margin-bottom:8px"><span class="lbl">${l}</span><b style="font-size:22px;margin-top:4px">${v}</b></div>`;
    return tile('Starting', `${st ?? '--'} <small>lb</small>`) + tile('Current', `${cu ?? '--'} <small>lb</small>`) + tile('Change', `${diff === null ? '--' : (diff > 0 ? '+' : '') + diff} <small>lb</small>`, true)
      + `<div class="lbl" style="margin:10px 0 6px">Today's photo</div>` + (url ? `<div class="thumb" style="height:120px;border-radius:14px;background-image:url('${url}')"></div>` : `<span class="badge">${ph ? 'Done' : 'Not yet'}</span>`);
  }) + funTile(true);
}

function vAuth() {
  const up = S.authMode === 'up';
  return `<div class="auth"><div class="hello">75 Hard</div><h1>${up ? 'Create your <em>account</em>' : 'Welcome <em>back</em>'}</h1>
  <form id="authForm" class="card" style="margin-top:20px" autocomplete="on">
   ${up ? `<label class="field"><span>Your name</span><input type="text" id="aname" maxlength="40" required autocomplete="given-name"></label>` : ''}
   <label class="field"><span>Email</span><input type="text" inputmode="email" id="aemail" required autocomplete="email"></label>
   <label class="field"><span>Password</span><input type="password" id="apass" minlength="8" required autocomplete="${up ? 'new-password' : 'current-password'}"></label>
   ${up ? `<label class="field"><span>Height</span><div class="row"><input type="number" id="aft" value="5" min="3" max="8" style="width:70px"> ft <input type="number" id="ain" value="11" min="0" max="11" style="width:70px"> in</div></label>
   <label class="field"><span>Your last 8 oz of water is</span><select id="asty"><option value="jugs">A 4th jug</option><option value="teacup">A cup of tea</option></select></label>` : ''}
   <div style="margin-top:20px"><button class="btn" style="width:100%" id="abtn">${up ? 'Create account' : 'Sign in'}</button></div>
  </form>
  <div style="text-align:center"><button class="link" id="atoggle">${up ? 'I already have an account' : 'New here? Create an account'}</button></div></div>`;
}

const VIEWS = { today: vToday, workouts: vWorkouts, meals: vMeals, water: vWater, reading: vReading, progress: vProgress };

// ---------- render ----------
function render() {
  CTX = false;
  if (S.dragging) return;
  const app = $('app'), nav = $('nav');
  if (!S.user) { nav.hidden = true; app.className = ''; app.innerHTML = vAuth(); return; }
  if (!S.me) { nav.hidden = true; app.innerHTML = '<p class="note" style="padding:40px 0;text-align:center">Loading your profile...</p>'; return; }
  if (S.view === 'partner' && !partner()) S.view = 'me';
  nav.hidden = false;
  document.body.dataset.tab = S.tab;
  app.innerHTML = VIEWS[S.tab]();
  app.className = (!editable() && S.view !== 'split') ? 'ro' : '';
  nav.innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><svg width="22" height="22" viewBox="0 0 24 24">${ICONS[k]}</svg>${l}</button>`).join('');
  if (checkSetup()) return;
  checkAllRings(); checkCelebrate(); checkRestart(); ensureUrls(); animateArcs();
}
function needSetup() { return S.me && dayNum(S.me) >= 1 && !S.me.setup_done; }
function checkSetup() {
  if (!needSetup()) return false;
  if ($('overlay').querySelector('#setupBox')) return true;
  const ft = Math.floor((S.me.height_in || 71) / 12), inch = (S.me.height_in || 71) % 12;
  $('overlay').innerHTML = `<div class="over" style="overflow-y:auto;align-items:flex-start"><div class="box2" id="setupBox" style="margin:auto;width:100%;text-align:left">
    <div class="e" style="text-align:center">Day 1 setup</div>
    <div class="m" style="font-size:24px;text-align:center;margin:12px 0 6px">Let's get your starting numbers</div>
    <p class="note" style="text-align:center;margin:0 0 18px">Takes a minute, then you're on to Day 1.</p>
    <div class="lbl" style="margin-bottom:6px">Height</div>
    <div class="row" style="gap:8px"><input type="number" id="sft" inputmode="numeric" placeholder="ft" min="3" max="8" value="${ft}"><input type="number" id="sin" inputmode="numeric" placeholder="in" min="0" max="11" value="${inch}"></div>
    <div class="lbl" style="margin:16px 0 6px">Starting weight (lb)</div>
    <input type="number" id="swt" inputmode="decimal" placeholder="lb" step="0.1" min="50" max="600">
    <div class="lbl" style="margin:16px 0 6px">Day 1 picture</div>
    <label class="btn ghost" for="sph" style="text-align:center;display:block"><span id="sphl">Take or choose a photo</span></label>
    <input type="file" id="sph" accept="image/*" hidden>
    <div class="row" style="margin-top:22px"><button class="btn" id="setupGo" style="width:100%">Start Day 1</button></div></div></div>`;
  return true;
}
function checkAllRings() {
  if (S.view !== 'me' || !editable() || !ringsDone(S.me.id, TD)) return;
  const key = `rings-${S.user.id}-${TD}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { return; }
  if (S.tab !== 'today' || S.sub) { S.tab = 'today'; S.sub = null; S.hist = null; $('app').scrollTo(0, 0); setTimeout(render, 0); }
}
function checkCelebrate() {
  const n = dayNum(S.me), key = `cel-${S.user.id}-${TD}`;
  if (S.view !== 'me' || !editable() || !complete(S.me.id, TD)) return;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { }
  const m = MILE[n] || MSGS[(Math.max(n, 1) + S.me.name.length) % MSGS.length];
  $('overlay').innerHTML = `<div class="over"><div class="box2"><div class="e">${n >= 1 ? 'Day ' + n + ' complete' : 'Practice day complete'}</div><div class="m">${m}</div><button class="btn" id="oc">Keep going</button></div></div>`;
}
function checkRestart() {
  if (S.restartSnooze || $('overlay').innerHTML) return;
  const d = firstMissedDay(S.me); if (!d) return;
  const miss = missing(S.me.id, d);
  $('overlay').innerHTML = `<div class="over"><div class="box2" style="text-align:left"><div class="e">${pretty(d)} wasn't fully closed</div>
   <div class="m" style="font-size:24px;text-align:center">Restart at Day 1?</div>
   <p class="note" style="margin:0 0 16px">Still open that day: ${miss.join(', ')}.<br>If you just forgot to log something, fix that day instead.</p>
   <div style="display:grid;gap:10px"><button class="btn" id="rsYes" style="background:rgba(255,255,255,.1);color:var(--text);box-shadow:none">Yes, restart at Day 1</button><button class="btn" id="rsFix" data-date="${d}">I forgot to log it. Fix that day</button><button class="link" id="rsLater">Not now</button></div></div></div>`;
}
function fixModal(date) {
  const r = dailyRow(S.me.id, date), a = wInfo(wRow(S.me.id, date, 'indoor')).st === 'done', b = wInfo(wRow(S.me.id, date, 'outdoor')).st === 'done';
  $('overlay').innerHTML = `<div class="over"><div class="box2" style="text-align:left;max-height:90vh;overflow:auto"><div class="e">Fix ${pretty(date)}</div>
   <div style="display:grid;gap:10px;margin:16px 0">
    <label class="check"><input type="checkbox" id="fxA" ${a ? 'checked' : ''}> Indoor workout done</label>
    <label class="check"><input type="checkbox" id="fxB" ${b ? 'checked' : ''}> Outdoor workout done</label>
    <label class="field" style="margin:0"><span>Water (oz)</span><input type="number" id="fxW" value="${r.water_oz}" min="0" max="400"></label>
    <label class="field" style="margin:0"><span>Pages read</span><input type="number" id="fxP" value="${r.pages}" min="0" max="2000"></label>
    <label class="btn ghost" style="text-align:center">${r.photo_path ? 'Replace that day\'s photo' : 'Add that day\'s photo'}<input type="file" id="fxPh" accept="image/*" hidden></label>
   </div><div style="display:grid;gap:10px"><button class="btn" id="fxSave" data-date="${date}">Save</button><button class="link" id="fxCancel">Cancel</button></div></div></div>`;
}

// ---------- auth ----------
async function afterLogin(session) {
  S.user = session.user;
  await loadAll();
  if (!S.me) {
    const m = session.user.user_metadata || {};
    const { error } = await sb.from('profiles').insert({ id: S.user.id, name: (m.name || 'Me').slice(0, 40), height_in: m.height_in || 71, water_style: m.water_style === 'teacup' ? 'teacup' : 'jugs' });
    if (error) toast(error.message);
    await loadAll();
  }
  await persistDone();
  render();
  if (!S.chan) S.chan = sb.channel('sync').on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload).subscribe();
}
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'SIGNED_OUT') { S.user = null; S.me = null; if (S.chan) { sb.removeChannel(S.chan); S.chan = null; } render(); }
});

// ---------- events ----------
document.addEventListener('submit', async e => {
  if (e.target.id !== 'authForm') return;
  e.preventDefault(); if (S.busy) return; S.busy = true;
  const email = $('aemail').value.trim(), password = $('apass').value;
  try {
    if (S.authMode === 'up') {
      const name = $('aname').value.trim(), height_in = (+$('aft').value || 5) * 12 + (+$('ain').value || 0), water_style = $('asty').value;
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name, height_in, water_style } } });
      if (error) throw error;
      if (!data.session) { toast('Check your email to confirm your account, then sign in.'); S.authMode = 'in'; render(); }
      else await afterLogin(data.session);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await afterLogin(data.session);
    }
  } catch (err) { toast(err.message || String(err)); }
  S.busy = false;
});
document.addEventListener('click', e => { const pt = e.target.closest && e.target.closest('.hpt'); if (pt && S._hp) { const n = $('hnote'); if (n) n.textContent = S._hp[+pt.dataset.hi]; } });
document.addEventListener('click', async e => {
  const t = e.target.closest('button,label,[data-open],[data-pv]'); if (!t) return; const d = t.dataset;
  CTX = !!(S.me && S.calSel && S.calSel !== TD && t.closest('[data-tile=cal]'));
  const u = S.me ? actor().id : S.user?.id, v = S.me && viewed();
  if (t.id === 'pushOn') return pushEnable();
  if (t.id === 'pushOff') return pushDisable();
  if (t.id === 'pushTest') { try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('Water Reminder', { body: reminderText(S.me, dailyRow(S.me.id, TD).water_oz), icon: 'icon-180.png' }); } catch (e) { toast('Could not show it: ' + e.message); } return; }
  if (t.id === 'atoggle') { S.authMode = S.authMode === 'up' ? 'in' : 'up'; render(); return; }
  if (!S.me) return;
  if (d.mx || d.mxadd || d.mxedit || d.mxtype || d.mxmore || d.mxq || d.mxre || d.mxdel || d.mxsdel) { await mxAction(d, t); return; }
  if (d.funadd) { $('fph').click(); return; }
  if (d.fundel) {
    if (!confirm('Delete this photo for good?')) return;
    $('overlay').innerHTML = '';
    D.fun = (D.fun || []).filter(f => f.id !== d.fundel); render();
    const r1 = await sb.from('fun_photos').delete().eq('id', d.fundel); await sb.storage.from('progress-photos').remove([d.fpath]);
    if (r1.error) { toast(r1.error.message); await loadAll(); render(); } return;
  }
  if (d.pv) {
    const url = S.urls[d.pv]; if (!url) { toast('Photo is still loading.'); return; }
    $('overlay').innerHTML = `<div class="over" id="imgv" style="flex-direction:column;gap:14px;padding:16px"><div style="color:var(--text);font-weight:700">${esc(d.cap || '')}</div><img src="${url}" alt="Progress photo" style="max-width:100%;max-height:78vh;border-radius:16px;object-fit:contain"><div class="row" style="gap:10px"><button class="btn" id="imgx">Close</button>${d.fid && canEdit((D.fun || []).find(f => f.id === d.fid)?.user_id) ? `<button class="btn red" data-fundel="${esc(d.fid)}" data-fpath="${esc(d.pv)}">Delete</button>` : ''}</div></div>`; return;
  }
  if (t.id === 'imgx' || t.id === 'imgv') { $('overlay').innerHTML = ''; return; }
  if (d.phundo) {
    const path = dailyRow(u, TD).photo_path; if (!path) return;
    S.urls[path] = null; await saveDaily(TD, { photo_path: null });
    sb.storage.from('progress-photos').remove([path]); toast('Photo removed.'); return;
  }
  if (d.phopen) { if (editable()) $('ph').click(); return; }
  if (d.tab) { S.tab = d.tab; S.sub = null; $('app').scrollTo(0, 0); render(); return; }
  if (d.calopen) { S.tab = 'workouts'; S.sub = 'indoor'; $('app').scrollTo(0, 0); render(); return; }
  if (d.calview) { S.calView = d.calview; if (d.calview === 'week') S.calWk = S.calSel; render(); return; }
  if (d.calweek) { S.calWk = addDays(S.calWk || S.calSel, 7 * +d.calweek); render(); return; }
  if (d.calday) { S.calSel = d.calday; render(); return; }
  if (d.calstep) { S.calSel = addDays(S.calSel, +d.calstep); S.calMonth = S.calSel.slice(0, 7); render(); return; }
  if (d.caltoday) { S.calSel = TD; S.calMonth = TD.slice(0, 7); render(); return; }
  if (d.calmonth) { const [y, m] = S.calMonth.split('-').map(Number), n = new Date(y, m - 1 + (+d.calmonth), 1); S.calMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; render(); return; }
  if (d.calpick || d.caladd || d.calsave || d.caledit || d.calcancel) {
    if (!editable()) return;
    const sel = S.calSel, cur = (S.calDraft || []).slice();
    if (d.caledit) { S.calEditing = sel; S.calDraft = planOf(u, sel).slice(); S.calDraftFor = sel; render(); return; }
    if (d.calcancel) { S.calEditing = null; S.calDraftFor = null; render(); return; }
    if (d.calsave) { S.calEditing = null; S.calDraftFor = null; saveDayPlan(u, sel, cur); toast(cur.length ? 'Plan saved.' : 'Plan cleared.'); return; }
    if (d.caladd) { const inp = $('calcustom'), name = inp ? inp.value.trim() : ''; if (!name) { toast('Type a workout first.'); return; } if (!cur.includes(name)) cur.push(name); S.calDraft = cur; render(); return; }
    const i = cur.indexOf(d.calpick); if (i >= 0) cur.splice(i, 1); else cur.push(d.calpick);
    S.calDraft = cur; render(); return;
  }
  if (d.msel) { const sel = lsel(), i = sel.indexOf(d.msel); if (i >= 0) sel.splice(i, 1); else sel.push(d.msel); lSave(); render(); return; }
  if (t.id === 'lsubmit') { if (!lsel().length) return; setLstep('plan'); render(); return; }
  if (t.id === 'csaveq' || t.id === 'psaveq') {
    if (!editable()) return;
    const cx = t.id === 'csaveq', c = cx ? S.cd : { type: S.wtype.indoor || 'Lift', sel: S.lsel, plan: S.plan }, day = cx ? S.calSel : TD;
    if (!c.sel.length) { toast('Pick a muscle group first.'); return; }
    const plan = {}; c.sel.forEach(m => { plan[m] = (c.plan[m] || []).slice(); });
    const labels = c.type === 'Lift' ? c.sel.map(m => MNAME[m]) : [c.type];
    S.cdEditing = null; CTX = false; saveDayPlan(u, day, labels, { type: c.type, sel: c.sel.slice(), plan }); toast('Plan saved for ' + pretty(day) + '.'); return;
  }
  if (t.id === 'csave') {
    if (!editable()) return;
    const c = S.cd, day = S.calSel, plan = {}; c.sel.forEach(m => { plan[m] = (c.plan[m] || []).slice(); });
    if (!c.sel.some(m => plan[m].length)) { toast('Pick at least one workout first.'); return; }
    const det = { type: c.type, sel: c.sel.slice(), plan }, labels = c.type === 'Lift' ? c.sel.map(m => MNAME[m]) : [c.type];
    S.cdEditing = null; CTX = false; saveDayPlan(u, day, labels, det); toast('Workout saved for ' + pretty(day) + '.'); return;
  }
  if (d.cedit) { const det = detailOf(u, S.calSel); if (!det) return; S.cd = { type: det.type, sel: det.sel.slice(), plan: JSON.parse(JSON.stringify(det.plan)), step: 'plan' }; S.cdEditing = S.calSel; S.cdDay = S.calSel; render(); return; }
  if (d.cdel) { if (!editable()) return; saveDayPlan(u, S.calSel, [], null); return; }
  if (d.cstart) {
    if (!editable()) return;
    const det = detailOf(u, TD); if (!det) return;
    if (wInfo(wRow(u, TD, 'outdoor')).st === 'running' || wInfo(wRow(u, TD, 'outdoor')).st === 'paused') { toast('Finish your outdoor workout first.'); return; }
    const idle = wInfo(wRow(u, TD, 'indoor')).st === 'idle';
    lInit(); S.wtype.indoor = det.type; S.lsel = det.sel.slice(); S.plan = JSON.parse(JSON.stringify(det.plan)); S.lorder = []; S.ldone = {}; S.opn = {}; S.hist = null; S.lstep = 'go'; lSave();
    S.tab = 'workouts'; S.sub = 'indoor'; $('app').scrollTo(0, 0); render();
    if (idle) startCountdown();
    return;
  }
  if (t.id === 'lgo') {
    if (!editable() || !lsel().length) return;
    const w = wInfo(wRow(u, TD, 'indoor')), o = wInfo(wRow(u, TD, 'outdoor'));
    if (o.st === 'running' || o.st === 'paused') { toast('Finish your outdoor workout first.'); return; }
    if (S.tab !== 'workouts') { S.tab = 'workouts'; S.sub = 'indoor'; }
    setLstep('go'); $('app').scrollTo(0, 0); render();
    if (w.st === 'idle') startCountdown();
    return;
  }
  if (d.lplan) { S.hist = null; setLstep('plan'); $('app').scrollTo(0, 0); render(); return; }
  if (d.ptog) { const i = d.ptog.indexOf('|'), m = d.ptog.slice(0, i), n = d.ptog.slice(i + 1), pl = lplan(); pl[m] = pl[m] || []; const k = pl[m].indexOf(n); if (k >= 0) pl[m].splice(k, 1); else pl[m].push(n); savePlan(); render(); return; }
  if (d.pother) { (S.pOther ||= {})[d.pother] = !S.pOther[d.pother]; render(); return; }
  if (d.paddc) { const m = d.paddc, inp = $('pcustom-' + m), n = inp ? inp.value.trim() : ''; if (!n) { toast('Type a lift name first.'); return; } const pl = lplan(); pl[m] = pl[m] || []; if (!pl[m].some(x => x.toLowerCase() === n.toLowerCase())) pl[m].push(n); S.pOther[m] = false; savePlan(); render(); return; }
  if (d.ltoggle) { (S.opn ||= {})[d.ltoggle] = !S.opn[d.ltoggle]; render(); return; }
  if (d.lremove) {
    if (!editable()) return;
    const key = d.lremove, i = key.indexOf('|'), m = key.slice(0, i), n = key.slice(i + 1), pl = lplan();
    if (todaySets(u, n).length) { toast('That lift has sets logged. Undo them first.'); return; }
    if (pl[m]) pl[m] = pl[m].filter(x => x !== n);
    if (S.ldone) delete S.ldone[key]; if (S.opn) delete S.opn[key]; S.lorder = (S.lorder || []).filter(k => k !== key);
    lSave(); render(); toast('Removed ' + n + ' from today.'); return;
  }
  if (d.lhist) { const key = t.closest('.lift').dataset.lb; S.hist = { key, name: key.slice(key.indexOf('|') + 1) }; S.hmetric = null; $('app').scrollTo(0, 0); render(); return; }
  if (d.lhback) { S.hist = null; render(); return; }
  if (d.hmetric) { S.hmetric = d.hmetric; render(); return; }
  if (d.open) {
    S.sub = d.open;
    if (d.open === 'indoor' && !lAct()) { S.linit = false; lsSet(lKey('lsess'), null); }   // fresh every time a new workout starts
    $('app').scrollTo(0, 0); render(); return;
  }
  if (d.back) { S.sub = null; $('app').scrollTo(0, 0); render(); return; }
  if (d.go) { S.tab = d.go; $('app').scrollTo(0, 0); render(); return; }
  if (d.view) { S.view = d.view; S.linit = false; render(); return; }
  if (t.id === 'signout') { await sb.auth.signOut(); return; }
  if (d.nt !== undefined) { S.nIdx = +d.nt; render(); return; }
  if (t.id === 'notifGo') { showBanner(); return; }
  if (t.id === 'setupGo') {
    S.view = 'me';
    const ft = parseInt($('sft').value, 10), inch = parseInt($('sin').value, 10) || 0, w = parseFloat($('swt').value), hi = ft * 12 + inch;
    if (!(ft >= 3 && ft <= 8) || !(inch >= 0 && inch <= 11) || !(hi >= 40 && hi <= 100)) { toast('Check your height.'); return; }
    if (!(w >= 50 && w <= 600)) { toast('Enter your weight in pounds.'); return; }
    if (!S.setupFile) { toast('Add your Day 1 picture.'); return; }
    t.disabled = true; t.textContent = 'Saving...';
    try {
      await must(sb.from('profiles').update({ height_in: hi, setup_done: true }).eq('id', S.user.id));
      await must(sb.from('weigh_ins').upsert({ user_id: S.user.id, day_num: 1, weight: w }, { onConflict: 'user_id,day_num' }));
      await uploadPhoto(S.setupFile, S.me.start_date);
      S.setupFile = null; await loadAll();
      $('overlay').innerHTML = ''; S.tab = 'today'; S.sub = null; S.view = 'me'; $('app').scrollTo(0, 0); render();
    } catch (e) { t.disabled = false; t.textContent = 'Start Day 1'; }
    return;
  }
  if (t.id === 'oc') { $('overlay').innerHTML = ''; return; }
  if (t.id === 'rsLater') { S.restartSnooze = true; $('overlay').innerHTML = ''; return; }
  if (t.id === 'rsFix') { fixModal(d.date); return; }
  if (t.id === 'fxCancel') { $('overlay').innerHTML = ''; return; }
  if (t.id === 'rsYes') {
    const prev = S.me.start_date;
    await must(sb.from('profiles').update({ start_date: TD }).eq('id', u));
    await must(sb.from('restarts').insert({ user_id: u, restarted_on: TD, previous_start: prev }));
    $('overlay').innerHTML = ''; await loadAll(); render(); toast('Back to Day 1. You\'ve got this.'); return;
  }
  if (t.id === 'fxSave') {
    const date = d.date, ok = id => $(id).checked, mk = (kind, on) => {
      if (!on) return null;
      const s = new Date(parseYmd(date).getTime() + 12 * 3600e3);
      return { user_id: u, day: date, kind, type: 'Logged later', started_at: s.toISOString(), done_at: new Date(+s + WLEN).toISOString(), override: false };
    };
    try {
      for (const [k, id] of [['indoor', 'fxA'], ['outdoor', 'fxB']]) { const row = mk(k, ok(id)); if (row) await must(sb.from('workouts').upsert(row, { onConflict: 'user_id,day,kind' })); }
      await must(sb.from('daily').upsert({ user_id: u, day: date, water_oz: Math.min(400, +$('fxW').value || 0), pages: Math.min(2000, +$('fxP').value || 0), updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
      $('overlay').innerHTML = ''; await loadAll(); render();
    } catch (_) { }
    return;
  }
  if (!editable()) return;
  if (d.lsdel) { D.sets[u] = (D.sets[u] || []).filter(x => x.id !== d.lsdel); render(); const { error } = await sb.from('lift_sets').delete().eq('id', d.lsdel); if (error) { toast(error.message); await loadAll(); render(); } return; }
  if (d.wreset) {
    const k = d.wreset;
    if (!confirm(`Reset your ${k} workout? The timer goes back to Not started${k === 'indoor' ? ' and your workout plan clears' : ''}.`)) return;
    const clear = k === 'indoor' && todaySetsAny(u) && confirm('Also delete the sets you logged today?\n\nOK = delete them\nCancel = keep them');
    delete D.workouts[u + '|' + TD + '|' + k];
    try { localStorage.removeItem(`n45-${u}-${TD}-${k}`); } catch (_) { }
    if (k === 'indoor') { S.linit = false; S.hist = null; lsSet(lKey('lsess'), null); S.wtype.indoor = 'Lift'; }
    if (clear) D.sets[u] = (D.sets[u] || []).filter(x => x.day !== TD);
    render();
    const r1 = await sb.from('workouts').delete().match({ user_id: u, day: TD, kind: k });
    const r2 = clear ? await sb.from('lift_sets').delete().match({ user_id: u, day: TD }) : {};
    if (r1.error || r2.error) { toast((r1.error || r2.error).message); await loadAll(); render(); } else toast('Reset.');
    return;
  }
  if (d.wundo) {
    const k = d.wundo, row = wRow(u, TD, k); if (!row || !row.done_at) return;
    const stopAt = +new Date(row.paused_at || row.done_at), el = stopAt - +new Date(row.started_at) - (row.paused_ms || 0);
    if (el >= WLEN - 1000) {
      if (!confirm('Undo this workout? It ran the full 45 minutes, so it goes back to Not started.')) return;
      delete D.workouts[u + '|' + TD + '|' + k]; if (k === 'indoor') { S.linit = false; lsSet(lKey('lsess'), null); } render();
      const { error } = await sb.from('workouts').delete().match({ user_id: u, day: TD, kind: k }); if (error) { toast(error.message); await loadAll(); render(); }
    } else {
      if (!confirm('Undo? Your workout reopens paused right where you left off.')) return;
      saveWorkout({ ...row, done_at: null, paused_at: row.paused_at || row.done_at });
    }
    return;
  }
  if (d.lundo) {
    const key = t.closest('.lift').dataset.lb, name = key.slice(key.indexOf('|') + 1), rows = todaySets(u, name), last = rows[rows.length - 1];
    if (!last) { toast('No sets logged yet to undo.'); return; }
    D.sets[u] = D.sets[u].filter(x => x.id !== last.id); render();
    const { error } = await sb.from('lift_sets').delete().eq('id', last.id);
    if (error) { toast(error.message); await loadAll(); render(); } else toast(`Removed set ${last.set_no}.`);
    return;
  }
  if (d.lcomp) {
    const key = t.closest('.lift').dataset.lb, keys = lKeys(), i = keys.indexOf(key);
    (S.ldone ||= {})[key] = true; (S.opn ||= {})[key] = false;
    const next = [...keys.slice(i + 1), ...keys.slice(0, i)].find(k => !S.ldone[k]);
    lSave(); render();
    if (next) toast('Done. Pick your next lift.'); else toast('Every lift is done. Nice work!');
    return;
  }
  if (d.logset) {
    const box = t.closest('.lift'), key = box.dataset.lb, i = key.indexOf('|'), m = key.slice(0, i), name = key.slice(i + 1), q = c => box.querySelector('.' + c).value;
    const weight = q('lw') === '' ? null : parseFloat(q('lw')), reps = q('lr') === '' ? null : parseInt(q('lr'), 10), sets = parseInt(q('ls'), 10) || 1, secs = (parseInt(q('lm'), 10) || 0) * 60 + (parseInt(q('lt'), 10) || 0);
    if (weight !== null && !(weight >= 0 && weight <= 2000)) { toast('Check the weight.'); return; }
    if (reps !== null && !(reps >= 1 && reps <= 1000)) { toast('Reps must be a whole number.'); return; }
    if (reps === null && !(secs > 0)) { toast('Enter reps or a time.'); return; }
    if (!(sets >= 1 && sets <= 20)) { toast('Sets must be 1 to 20.'); return; }
    const base = todaySets(u, name).length;
    const rows = Array.from({ length: sets }, (_, k) => ({ user_id: u, day: TD, muscle: m, exercise: name, set_no: base + k + 1, reps, weight, seconds: secs > 0 ? secs : null }));
    D.sets[u] = [...(D.sets[u] || []), ...rows.map((r, k) => ({ ...r, id: 'tmp' + Date.now() + k, user_id: u }))];
    if (S.ldone) { delete S.ldone[key]; lSave(); }
    (S.opn ||= {})[key] = true; render();
    toast(`Logged ${sets > 1 ? sets + ' sets' : 'set ' + (base + 1)}: ${fmtSet(rows[0]).replace(/&middot;/g, '-')}`);
    const { error } = await sb.from('lift_sets').insert(rows);
    if (error) { toast(error.message); }
    await loadAll(); render(); return;
  }
  const today = TD;
  if (d.start) {
    const k = d.start, other = wInfo(wRow(u, today, k === 'indoor' ? 'outdoor' : 'indoor'));
    const types = k === 'indoor' ? ['Lift'] : ['Walk'];
    return saveWorkout({ user_id: u, day: today, kind: k, type: S.wtype[k] || types[0], started_at: new Date().toISOString(), done_at: null, override: false });
  }
  if (d.pause) { const row = wRow(u, today, d.pause); return saveWorkout({ ...row, paused_at: new Date().toISOString() }); }
  if (d.resume) { const row = wRow(u, today, d.resume); return saveWorkout({ ...row, paused_ms: (row.paused_ms || 0) + (Date.now() - +new Date(row.paused_at)), paused_at: null }); }
  if (d.restart) { if (!confirm('Restart this workout from 45:00?')) return; const row = wRow(u, today, d.restart); return saveWorkout({ ...row, started_at: new Date().toISOString(), paused_ms: 0, paused_at: null }); }
  if (d.stop) { if (!confirm('Stop and discard this workout? You can start a new one after.')) return; const key = u + '|' + today + '|' + d.stop; delete D.workouts[key]; render(); const { error } = await sb.from('workouts').delete().match({ user_id: u, day: today, kind: d.stop }); if (error) { toast(error.message); await loadAll(); render(); } return; }
  if (d.late) {
    const v = ($('late-' + d.late) || {}).value || '', [hh, mm] = v.split(':').map(Number);
    let end = new Date(); if (!isNaN(hh)) end.setHours(hh, mm, 0, 0); if (end > new Date()) end = new Date();
    const types = d.late === 'indoor' ? ['Lift'] : ['Walk'];
    return saveWorkout({ user_id: u, day: today, kind: d.late, type: S.wtype[d.late] || types[0], started_at: new Date(+end - WLEN).toISOString(), done_at: end.toISOString(), override: false });
  }
  if (d.fin) { const row = wRow(u, today, d.fin); return saveWorkout({ ...row, done_at: new Date().toISOString() }); }
  if (d.amino) { const r = dailyRow(u, today), on = !!r.amino; if (!on) { S.anim = 'amino'; setTimeout(() => { S.anim = null; }, 1500); } return saveDaily(today, { amino: !on, water_oz: on ? Math.max(0, r.water_oz - 8) : r.water_oz + 8 }); }
  if (d.jug !== undefined) { const js = jugsFor(viewed()), am = exOz(dailyRow(u, today)), idx = +d.jug, oz = dailyRow(u, today).water_oz - am, upto = js.slice(0, idx + 1).reduce((a, b) => a + b, 0), below = js.slice(0, idx).reduce((a, b) => a + b, 0); return saveDaily(today, { water_oz: (oz >= upto ? below : upto) + am }); }
  if (d.cup) { const r = dailyRow(u, today), ex = exOz(r); return saveDaily(today, { water_oz: (r.water_oz - ex >= 128 ? 120 : 128) + ex }); }
  if (d.xtra) { const r = dailyRow(u, today), per = d.xtra === 'coffee_n' ? 6 : 12, cur = r[d.xtra] || 0, nx = Math.max(0, cur + +d.dx); if (nx === cur) return; return saveDaily(today, { [d.xtra]: nx, water_oz: Math.max(0, r.water_oz + (nx - cur) * per) }); }
  if (d.rclose) {
    const cur = dailyRow(u, today).pages, next = cur >= 10 ? 0 : 10, delta = next - cur;
    await saveDaily(today, { pages: next });
    const b = (D.books[u] || []).find(x => x.read_pages < x.total_pages) || (delta < 0 ? (D.books[u] || []).find(x => x.read_pages > 0) : null);
    if (b) { const rp = Math.max(0, Math.min(b.total_pages, b.read_pages + delta)); b.read_pages = rp; render(); sb.from('books').update({ read_pages: rp }).eq('id', b.id); }
    return;
  }
  if (d.pg) {
    const delta = +d.pg, cur = dailyRow(u, today).pages, next = Math.max(0, cur + delta);
    await saveDaily(today, { pages: next });
    const b = (D.books[u] || []).find(x => x.read_pages < x.total_pages);
    if (b && delta > 0) { const rp = Math.min(b.total_pages, b.read_pages + delta); b.read_pages = rp; render(); sb.from('books').update({ read_pages: rp }).eq('id', b.id); }
    return;
  }
  if (t.id === 'badd') {
    const title = $('bt').value.trim(), total = Math.floor(+$('bn').value);
    if (!title || !(total > 0)) { toast('Add a title and the number of pages.'); return; }
    await must(sb.from('books').insert({ user_id: u, title, total_pages: total })); await loadAll(); render(); return;
  }
  if (d.wslot) {
    const c = +d.wslot, inp = $('wt-' + c), w = parseFloat(inp && inp.value);
    if (!(w >= 50 && w <= 600)) { toast('Enter your weight in pounds.'); return; }
    await must(sb.from('weigh_ins').upsert({ user_id: u, day_num: c, weight: w }, { onConflict: 'user_id,day_num' })); await loadAll(); render(); toast(`Day ${c} weight saved.`); return;
  }
  if (d.g) { const g = D.groceries.find(x => x.id === d.g); g.done = !g.done; render(); sb.from('groceries').update({ done: g.done }).eq('id', g.id); return; }
  if (d.gdel) { D.groceries = D.groceries.filter(x => x.id !== d.gdel); render(); sb.from('groceries').delete().eq('id', d.gdel); return; }
  if (t.id === 'gadd') { const i = $('gnew'), item = i.value.trim(); if (!item) return; i.value = ''; await must(sb.from('groceries').insert({ item })); await loadAll(); render(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.wtype && S.me && S.calSel && S.calSel !== TD && t.closest('[data-tile=cal]')) { CTX = true; S.cd.type = t.value; syncType(t.value); render(); return; }
  if (t.dataset.wtype) { S.wtype[t.dataset.wtype] = t.value; if (t.dataset.wtype === 'indoor') {
    syncType(t.value); lSave();
    const row = S.me && wRow(actor().id, TD, 'indoor');
    if (row && !row.done_at && row.type !== t.value) { saveWorkout({ ...row, type: t.value }); return; }
    render();
  } return; }
  if (t.id === 'lpick') { const n = $('lname'); if (t.value === '__custom') { n.style.display = ''; n.value = ''; n.focus(); } else { n.style.display = 'none'; n.value = t.value; } return; }
  if (t.id === 'mph' && t.files[0]) { const f = t.files[0]; t.value = ''; mxStart(f); return; }
  if (t.id === 'fph' && t.files.length) {
    const files = [...t.files]; t.value = ''; const u = actor().id; let n = 0;
    toast('Saving ' + (files.length === 1 ? 'photo' : files.length + ' photos') + '...');
    for (const f of files) {
      try {
        const blob = await compress(f), path = `${u}/fun/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from('progress-photos').upload(path, blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
        S.urls[path] = URL.createObjectURL(blob);
        const ins = await sb.from('fun_photos').insert({ user_id: u, path }); if (ins.error) throw ins.error; n++;
      } catch (e) { toast('Photo failed: ' + (e.message || e)); }
    }
    await loadAll(); render(); if (n) toast(n === 1 ? 'Photo added.' : n + ' photos added.');
    return;
  }
  if (t.id === 'ph' && t.files[0]) { const f = t.files[0]; t.value = ''; uploadPhoto(f, TD); }
  if (t.id === 'sph' && t.files[0]) { S.setupFile = t.files[0]; const l = $('sphl'); if (l) l.textContent = 'Photo selected: ' + (t.files[0].name || 'ready') ; }
  if (t.id === 'phOld' && t.files[0]) {
    const date = prompt('What date was this photo taken? (YYYY-MM-DD)', addDays(TD, -1));
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= TD) uploadPhoto(t.files[0], date); else if (date) toast('Use the format YYYY-MM-DD, and not a future date.');
  }
  if (t.id === 'fxPh' && t.files[0]) { const date = $('fxSave').dataset.date; await uploadPhoto(t.files[0], date); toast('Photo added to that day.'); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'sl') { const v = e.target.value; $('bb').style.clipPath = `inset(0 0 0 ${v}%)`; $('bh').style.left = v + '%'; }
});
document.addEventListener('focusout', async e => {
  const el = e.target;
  if (el.dataset?.meal !== undefined && editable()) {
    const [day_idx, slot] = el.dataset.meal.split('|'), text = el.innerText.trim().slice(0, 300);
    if ((D.meals[day_idx + '|' + slot] || '') === text) return;
    D.meals[day_idx + '|' + slot] = text;
    const { error } = await sb.from('meal_plan').upsert({ day_idx: +day_idx, slot, text, updated_at: new Date().toISOString() }, { onConflict: 'day_idx,slot' });
    if (error) toast(error.message);
  }
});

// ---------- clock ----------
setInterval(() => {
  if (!S.me) return;
  const now = ymd(new Date());
  if (now !== TD) { TD = now; S.restartSnooze = false; render(); return; }
  persistDone();
  const a = document.activeElement; if (a && (a.matches('input,textarea,select') || a.isContentEditable)) return;
  if ((S.tab === 'today' || (S.tab === 'workouts' && (S.view === 'split' || !S.sub))) && !$('overlay').innerHTML) render();
  if (S.tab === 'workouts') {
    const p = viewed();
    for (const k of ['indoor', 'outdoor']) {
      const w = wInfo(wRow(p.id, TD, k)), o = wInfo(wRow(p.id, TD, k === 'indoor' ? 'outdoor' : 'indoor'));
      if (w.st === 'running') { const el = $('t-' + k); if (el) el.textContent = mmss(w.left); if (w.left <= 0) render(); }
    }
  }
}, 1000);

// ---------- start ----------
if (new URLSearchParams(location.search).get('celebrate')) { history.replaceState(null, '', location.pathname); setTimeout(water128, 1200); }
// Some iPhones draw the page under the status bar without reporting a safe-area inset. Add the missing space.
function fitTop() {
  const pr = document.createElement('div'); pr.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top)'; document.body.appendChild(pr);
  const env = pr.getBoundingClientRect().height; pr.remove();
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const full = innerHeight >= screen.height - 2;
  document.documentElement.style.setProperty('--top', (env > 0 ? env : (standalone && full ? 47 : 0)) + 'px');
}
$('app').addEventListener('scroll', () => { const a = $('app'); if (a.scrollLeft) a.scrollLeft = 0; });   // never let the page drift sideways
fitTop(); addEventListener('resize', fitTop); addEventListener('orientationchange', fitTop);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.celebrate) water128(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(pushCheck).catch(() => { PUSH.st = 'unsupported'; });
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) await afterLogin(data.session); else render();
})();

// If iOS ever zooms or pans the page (e.g. after focusing a field), snap it back.
if (window.visualViewport) {
  const snap = () => { const v = window.visualViewport; if (v.scale > 1.01 || Math.abs(v.offsetLeft) > 1) { scrollTo(0, 0); document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0; } };
  visualViewport.addEventListener('resize', snap); visualViewport.addEventListener('scroll', snap);
}
addEventListener('scroll', () => { if (scrollX) scrollTo(0, 0); });

// Self-update: if a newer version of the app was published, jump to it (GitHub Pages can serve old files for a few minutes).
(async () => {
  try {
    const mine = document.querySelector('meta[name=app-version]')?.content; if (!mine) return;
    const html = await (await fetch('./?nocache=' + Date.now(), { cache: 'no-store' })).text();
    const theirs = (html.match(/name="app-version" content="([^"]+)"/) || [])[1];
    if (theirs && theirs !== mine && sessionStorage.getItem('upd') !== theirs) { sessionStorage.setItem('upd', theirs); location.replace(location.pathname + '?v=' + encodeURIComponent(theirs)); }
  } catch (_) { }
})();

document.addEventListener('click', e => { if (e.target.closest('#imgv') && !e.target.closest('#imgv button')) $('overlay').innerHTML = ''; });

// Wall display: keep an iPad-sized screen awake while the app is open.
(function () {
  if (!('wakeLock' in navigator) || !matchMedia('(min-width:768px)').matches) return;
  let lock = null;
  const get = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch (_) { } };
  get(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') get(); });
})();
