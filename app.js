// 75 Hard: shared tracker for two people, live-synced through Supabase.
const SB_URL = 'https://zwvgmrutbussrpbjfwmj.supabase.co';
// Public "anon" key: safe to ship in the page. Row Level Security in the database does the protecting.
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dmdtcnV0YnVzc3JwYmpmd21qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MDY3NjYsImV4cCI6MjEwODk4Mjc2Nn0.VdMrWr_2wtSZCa54abM5jnmEWIZ3NB3hPuMqIYN0Pxc';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const WLEN = 45 * 60e3, GAP = 3 * 3600e3, WATER = 128;
const COLORS = { indoor: '#2fd98f', outdoor: '#c9e25f', water: '#4fc8e6', reading: '#e8cf8a', photo: '#e9a36b' };
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
const D = { profiles: [], daily: {}, workouts: {}, books: {}, weigh: {}, groceries: [], meals: {}, sets: {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const dkey = (u, d) => u + '|' + d;
const me = () => S.me;
const partner = () => D.profiles.find(p => p.id !== S.me?.id) || null;
const viewed = () => (S.view === 'partner' && partner()) ? partner() : S.me;
const editable = () => viewed()?.id === S.me?.id;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500); }
async function must(p) { const r = await p; if (r.error) { toast(r.error.message); throw r.error; } return r.data; }

// ---------- data ----------
async function loadAll() {
  const [p, d, w, b, wi, g, m, lf] = await Promise.all([
    sb.from('profiles').select('*'), sb.from('daily').select('*'), sb.from('workouts').select('*'),
    sb.from('books').select('*').order('created_at'), sb.from('weigh_ins').select('*').order('day_num'),
    sb.from('groceries').select('*').order('created_at'), sb.from('meal_plan').select('*'), sb.from('lift_sets').select('*').order('created_at')
  ]);
  for (const r of [p, d, w, b, wi, g, m, lf]) if (r.error) { toast(r.error.message); return; }
  D.profiles = p.data;
  D.daily = {}; d.data.forEach(r => D.daily[dkey(r.user_id, r.day)] = r);
  D.workouts = {}; w.data.forEach(r => D.workouts[r.user_id + '|' + r.day + '|' + r.kind] = r);
  D.books = {}; b.data.forEach(r => (D.books[r.user_id] ||= []).push(r));
  D.weigh = {}; wi.data.forEach(r => (D.weigh[r.user_id] ||= []).push(r));
  D.groceries = g.data;
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
const complete = (u, d) => Object.values(rings(u, d)).every(v => v >= 1) && dailyRow(u, d).diet;
const dayNum = (p, d = TD) => diffDays(d, p.start_date) + 1;
function missing(u, d) {
  const f = rings(u, d), r = dailyRow(u, d), out = [];
  if (f.indoor < 1) out.push('indoor workout'); if (f.outdoor < 1) out.push('outdoor workout');
  if (f.water < 1) out.push('water'); if (f.reading < 1) out.push('reading'); if (f.photo < 1) out.push('progress photo');
  if (!r.diet) out.push('no cheat meals / no alcohol check');
  return out;
}
function firstMissedDay(p) {
  const n = dayNum(p);
  for (let i = 0; i < Math.min(n - 1, 75); i++) { const d = addDays(p.start_date, i); if (!complete(p.id, d)) return d; }
  return null;
}
async function persistDone() {
  for (const row of Object.values(D.workouts)) {
    if (row.user_id !== S.user.id || row.done_at) continue;
    const i = wInfo(row);
    if (i.persist) { row.done_at = new Date(i.end).toISOString(); sb.from('workouts').update({ done_at: row.done_at }).match({ user_id: row.user_id, day: row.day, kind: row.kind }); }
  }
}

// ---------- writes (own rows only; the database enforces this too) ----------
async function saveDaily(date, patch) {
  const u = S.user.id, k = dkey(u, date);
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
    const blob = await compress(file), path = `${S.user.id}/${date}.jpg`;
    const { error } = await sb.storage.from('progress-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    S.urls[path] = URL.createObjectURL(blob);
    await saveDaily(date, { photo_path: path });
  } catch (e) { toast('Photo upload failed: ' + (e.message || e)); }
}
async function ensureUrls() {
  const need = new Set();
  [S.me, partner()].filter(Boolean).forEach(p => { for (let i = 0; i < 75; i++) { const r = D.daily[dkey(p.id, addDays(p.start_date, i))]; if (r?.photo_path && !S.urls[r.photo_path]) need.add(r.photo_path); } });
  if (!need.size) return;
  const { data } = await sb.storage.from('progress-photos').createSignedUrls([...need], 3600);
  (data || []).forEach(x => { if (x.signedUrl) S.urls[x.path] = x.signedUrl; });
  if (S.tab === 'progress') softRender();
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
function allRings(u) {
  const f = rings(u, TD), keys = Object.keys(NAMES), size = 240, stroke = 16, step = 19, c0 = size / 2;
  const closed = keys.filter(k => f[k] >= 1).length;
  const svg = keys.map((k, i) => {
    const r = (size - stroke) / 2 - i * step, c = 2 * Math.PI * r, last = ARC_LAST[u + k] || 0;
    return `<circle cx="${c0}" cy="${c0}" r="${r}" fill="none" stroke="${COLORS[k]}" stroke-opacity=".13" stroke-width="${stroke}"/>` +
      `<circle class="arc glow" data-arc="${u + k}" data-f="${Math.max(f[k], .001)}" data-c="${c}" style="color:${COLORS[k]};transition-delay:${i * 120}ms" cx="${c0}" cy="${c0}" r="${r}" fill="none" stroke="${COLORS[k]}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(last, .001))}"/>`;
  }).join('');
  const legend = keys.map(k => `<div class="lg"><i style="background:${COLORS[k]}"></i><span>${NAMES[k]}</span><b>${Math.round(f[k] * 100)}%</b></div>`).join('');
  return `<div class="big"><span class="ringwrap" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" style="transform:rotate(-90deg)">${svg}</svg><span class="mid"><span class="num" style="font-size:30px;font-weight:800">${closed}/5</span><span class="lbl" style="margin-top:2px">closed</span></span></span></div><div class="arclegend">${legend}</div>`;
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
const TABS = [['today', 'Today'], ['workouts', 'Workouts'], ['meals', 'Meals'], ['water', 'Water'], ['reading', 'Reading'], ['progress', 'Progress']];

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
function dietBtn(p) { const r = dailyRow(p.id, TD); return `<button class="check ctl" id="diet"><span class="box ${r.diet ? 'on' : ''}">${r.diet ? tick : ''}</span><span>No cheat meals. No alcohol.</span></button>`; }

const GRIP = '<button class="grip" aria-label="Drag to reorder"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg></button>';
const TILE_IDS = ['days', 'all', 'single'];
function tileOrder() {
  try {
    let o = JSON.parse(localStorage.getItem('tileOrder'));
    if (Array.isArray(o)) { o = o.filter(k => TILE_IDS.includes(k)); for (const k of TILE_IDS) if (!o.includes(k)) o.unshift(k); if (o.length === 3) return o; }
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
  const y0 = e.clientY, h = R[i].height, gap = R.length > 1 ? R[1].top - R[0].bottom : 0, span = h + gap;
  const minDy = R[0].top - R[i].top, maxDy = R[R.length - 1].bottom - R[i].bottom;
  tile.style.zIndex = 5; tile.style.transition = 'none'; tile.style.boxShadow = '0 14px 40px rgba(0,0,0,.6)';
  tiles.forEach((t, k) => { if (k !== i) t.style.transition = 'transform .22s ease'; });
  let j = i;
  const mv = ev => {
    const dy = Math.max(minDy, Math.min(maxDy, ev.clientY - y0)), top = R[i].top + dy, bot = top + h;
    tile.style.transform = `translateY(${dy}px)`;
    j = i; R.forEach((r, k) => { const mid = r.top + r.height / 2; if (k < i && top < mid) j = Math.min(j, k); if (k > i && bot > mid) j = Math.max(j, k); });
    tiles.forEach((t, k) => { if (k === i) return; t.style.transform = (i < j && k > i && k <= j) ? `translateY(${-span}px)` : (i > j && k < i && k >= j) ? `translateY(${span}px)` : ''; });
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (j !== i) {
      if (box.dataset.dragbox === 'lifts') { const o = lKeys(); const [m] = o.splice(i, 1); o.splice(j, 0, m); S.lorder = o; lSave(); }
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
    const col = p => { const f = rings(p.id, TD), r = dailyRow(p.id, TD), done = complete(p.id, TD);
      return `<div class="p"><h3>${esc(p.name)}</h3>${Object.keys(NAMES).map(n => `<div class="mini">${ring(26, 4, f[n], COLORS[n])}<span style="flex:1">${NAMES[n]}</span><b style="color:var(--text);font-size:11px">${splitVal(p, n)}</b></div>`).join('')}
      <div class="mini"><span class="box ${r.diet ? 'on' : ''}" style="width:22px;height:22px;border-radius:7px">${r.diet ? tick : ''}</span><span style="flex:1">Diet</span><b style="color:var(--text);font-size:11px">${r.diet ? 'Done' : 'Not yet'}</b></div>
      <div style="margin-top:10px"><span class="badge ${done ? 'good' : ''}">${done ? 'Day complete' : 'In progress'}</span></div></div>`; };
    return header('Today') + `<div class="card" style="text-align:center"><div class="days" style="font-size:70px">${c.left}</div><div class="dayslbl">${c.sub}</div></div><div class="split">${col(S.me)}${col(pr)}</div>
      <p class="note" style="margin-top:12px">Live view. When ${esc(pr.name)} checks something off, it shows up here.</p>`;
  }
  const f = rings(v.id, TD), c = dayCounter(v);
  const go = n => n === 'indoor' || n === 'outdoor' ? 'workouts' : n === 'water' ? 'water' : n === 'reading' ? 'reading' : 'progress';
  const small = Object.keys(NAMES).map(n => `<button data-go="${go(n)}">${ring(60, 7, f[n], COLORS[n], `<span class="num" style="font-size:12px">${Math.round(f[n] * 100)}%</span>`)}<span class="n">${NAMES[n]}</span></button>`).join('');
  let other = '';
  if (pr && editable()) { const n = Object.values(rings(pr.id, TD)).filter(x => x >= 1).length; other = `<div class="card"><div class="row sp"><div><div class="lbl">${esc(pr.name)} right now</div><div style="margin-top:6px;font-size:15px">${n} of 5 rings closed</div></div>${ring(46, 6, n / 5, '#2fd98f')}</div></div>`; }
  if (!pr) other = `<div class="card"><div class="lbl">Waiting for your partner</div><p class="note" style="margin:8px 0 0">Once they create their account, their rings show up here live.</p></div>`;
  return header('Good <em>' + greet() + '</em>') + testBar(v) +
    `<div id="tiles" data-dragbox="today">${tileOrder().map(k => k === 'days'
      ? `<div class="card dtile" data-tile="days">${GRIP}<div class="big">${ring(280, 13, c.frac, '#2fd98f', `<span class="days">${c.left}</span><span class="dayslbl">${c.sub}</span>`)}</div>${c.note ? `<p class="note" style="text-align:center;margin:0">${c.note}</p>` : ''}</div>`
      : k === 'all'
        ? `<div class="card dtile" data-tile="all">${GRIP}${allRings(v.id)}</div>`
        : `<div class="card dtile" data-tile="single">${GRIP}<div class="lbl" style="margin-bottom:14px">Today's rings</div><div class="rings">${small}</div></div>`).join('')}</div>
    ${dietBtn(v)}<div style="height:14px"></div>${other}
    <div style="text-align:center;margin-top:8px"><button class="link" id="signout">Sign out</button></div>`;
}
function greet() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }

function lateRow(k, p) {
  if (p.id !== S.me.id) return '';
  const n = new Date(), hhmm = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  return `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><div class="lbl" style="margin-bottom:8px">Forgot to start it?</div><div class="row" style="gap:8px"><input type="time" id="late-${k}" value="${hhmm}" style="flex:1"><button class="btn ghost sm" data-late="${k}">Mark complete</button></div><p class="note" style="margin-top:6px">Pick the time you finished. It counts as a full 45 minutes.</p></div>`;
}
function wCard(k, p) {
  const w = wInfo(wRow(p.id, TD, k)), other = wInfo(wRow(p.id, TD, k === 'indoor' ? 'outdoor' : 'indoor'));
  const label = k === 'indoor' ? 'Indoor workout' : 'Outdoor workout';
  const types = k === 'indoor' ? ['Lift', 'Yoga', 'Pilates', 'Treadmill', 'Cycling', 'HIIT'] : ['Walk', 'Run', 'Hike', 'Bike ride', 'Sports'];
  const row = wRow(p.id, TD, k);
  let body = '';
  if (w.st === 'done') body = `<div class="timer">Done</div><div class="note">${esc(row.type)} &middot; 45 min complete</div>${p.id === S.me.id ? `<div class="row" style="margin-top:12px"><button class="btn amber sm" data-wundo="${k}">Undo</button></div>` : ''}`;
  else if (w.st === 'running' || w.st === 'paused') {
    const ps = w.st === 'paused', mine = p.id === S.me.id;
    body = `<div class="timer" id="t-${k}">${mmss(w.left)}</div><div class="note">${esc(row.type)} ${ps ? 'is paused. The clock is stopped.' : 'in progress. It closes on its own at 45 minutes.'}</div>` +
      (mine ? `<div class="row" style="margin-top:12px;gap:8px"><button class="btn sm" data-${ps ? 'resume' : 'pause'}="${k}">${ps ? 'Resume' : 'Pause'}</button><button class="btn ghost sm" data-restart="${k}">Restart</button><button class="btn ghost sm" data-stop="${k}">Stop</button></div><div class="row" style="margin-top:10px"><button class="btn sm" data-fin="${k}">Complete workout</button></div>` : '');
  }
  else if (other.st === 'running' || other.st === 'paused') body = `<div class="note">Finish your other workout first.</div>`;
  else body = `<select data-wtype="${k}">${types.map(t => `<option ${t === (S.wtype[k] || types[0]) ? 'selected' : ''}>${t}</option>`).join('')}</select><div class="row" style="margin-top:14px"><button class="btn" data-start="${k}">Start 45 min</button></div>`;
  if (w.st === 'idle') body += lateRow(k, p);
  return `<div class="card"><div class="row sp" style="margin-bottom:12px"><div class="lbl">${label}</div>${ring(54, 7, w.frac, COLORS[k])}</div>${body}</div>`;
}
function wLabel(k) { return k === 'indoor' ? 'Indoor workout' : 'Outdoor workout'; }
function vWorkouts() {
  if (S.view === 'split' && partner()) return splitWorkouts();
  const p = viewed();
  if (S.sub === 'indoor' || S.sub === 'outdoor') return vWorkoutPage(S.sub, p);
  const tile = k => {
    const row = wRow(p.id, TD, k), w = wInfo(row);
    const st = w.st === 'done' ? `Done &middot; ${esc(row.type)}` : w.st === 'running' ? `${mmss(w.left)} left &middot; ${esc(row.type)}` : w.st === 'paused' ? `Paused &middot; ${mmss(w.left)} left` : 'Not started';
    return `<div class="card wtile" data-open="${k}" role="button" tabindex="0"><div class="row sp"><div><div class="lbl">${wLabel(k)}</div><div id="ws-${k}" style="margin-top:6px;font-size:15px">${st}</div>${w.st === 'done' && p.id === S.me.id ? `<div style="margin-top:10px"><button class="btn amber sm" data-wundo="${k}">Undo</button></div>` : ''}</div><div class="row" style="gap:12px">${ring(54, 7, w.frac, COLORS[k])}<svg width="10" height="16" viewBox="0 0 10 16"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/></svg></div></div></div>`;
  };
  return header('Work<em>outs</em>') + testBar(p) + `<p class="note" style="margin-top:-4px">Tap a workout to open it.</p>` + tile('indoor') + tile('outdoor');
}
const MUSCLES = [['chest', 'Chest'], ['triceps', 'Triceps'], ['biceps', 'Biceps'], ['legs', 'Legs'], ['back', 'Back'], ['shoulders', 'Shoulders']];
const MNAME = Object.fromEntries(MUSCLES);
const LIB = {
  chest: ['Flat barbell bench press', 'Incline barbell bench press', 'Decline barbell bench press', 'Flat dumbbell press', 'Incline dumbbell press', 'Decline dumbbell press', 'Dumbbell fly', 'Incline dumbbell fly', 'Cable crossover', 'Low-to-high cable fly', 'Machine chest press', 'Pec deck', 'Push-up', 'Chest dips', 'Landmine press', 'Svend press'],
  triceps: ['Triceps rope pushdown', 'Straight-bar pushdown', 'Overhead dumbbell extension', 'Overhead cable extension', 'Skull crusher', 'Close-grip bench press', 'Triceps dips', 'Bench dips', 'Diamond push-up', 'Dumbbell kickback', 'Single-arm cable pushdown', 'JM press'],
  biceps: ['Barbell curl', 'EZ-bar curl', 'Dumbbell curl', 'Hammer curl', 'Incline dumbbell curl', 'Preacher curl', 'Concentration curl', 'Cable curl', 'Spider curl', 'Reverse curl', 'Zottman curl', 'Chin-up'],
  legs: ['Back squat', 'Front squat', 'Goblet squat', 'Hack squat', 'Leg press', 'Romanian deadlift', 'Stiff-leg deadlift', 'Walking lunge', 'Reverse lunge', 'Bulgarian split squat', 'Step-up', 'Leg extension', 'Seated leg curl', 'Lying leg curl', 'Hip thrust', 'Glute bridge', 'Hip abduction machine', 'Standing calf raise', 'Seated calf raise', 'Wall sit'],
  back: ['Deadlift', 'Pull-up', 'Lat pulldown', 'Close-grip lat pulldown', 'Barbell row', 'Dumbbell row', 'Seated cable row', 'T-bar row', 'Chest-supported row', 'Straight-arm pulldown', 'Face pull', 'Back extension', 'Barbell shrug', 'Dumbbell shrug', 'Rack pull', 'Dead hang'],
  shoulders: ['Barbell overhead press', 'Dumbbell shoulder press', 'Arnold press', 'Machine shoulder press', 'Push press', 'Dumbbell lateral raise', 'Cable lateral raise', 'Front raise', 'Rear delt fly', 'Reverse pec deck', 'Upright row', 'Landmine press', 'Face pull', 'Barbell shrug']
};
const TIMED = new Set(['Wall sit', 'Dead hang']);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } };
const lKey = n => `${n}-${S.user?.id}-${TD}`;
// Lift planning is fresh every time. It is only restored while an indoor workout is actually running.
const lAct = () => { const w = wInfo(wRow(S.user.id, TD, 'indoor')); return w.st === 'running' || w.st === 'paused'; };
function lInit() {
  if (S.linit) return; S.linit = true;
  const sv = lAct() ? lsGet(lKey('lsess')) : null;
  S.lsel = (sv && sv.sel || []).filter(m => MNAME[m]); S.plan = (sv && sv.plan) || {}; S.lstep = (sv && sv.step) || 'pick'; S.lorder = (sv && sv.order) || []; S.ldone = (sv && sv.done) || {}; S.shut = {}; S.hist = null; S.pick = {}; S.custom = {}; S.pOther = {};
}
const lSave = () => lsSet(lKey('lsess'), { sel: S.lsel, plan: S.plan, step: S.lstep, order: S.lorder, done: S.ldone });
function lKeys() {   // every planned lift as 'muscle|name', in the user's own drag order
  const flat = []; for (const m of lsel()) for (const n of (lplan()[m] || [])) flat.push(m + '|' + n);
  const ord = S.lorder || []; return [...ord.filter(k => flat.includes(k)), ...flat.filter(k => !ord.includes(k))];
}
const lsel = () => { lInit(); return S.lsel; };
const lplan = () => { lInit(); return S.plan; };
function lstep() { lInit(); return (S.lstep === 'go' || S.lstep === 'plan') && S.lsel.length ? S.lstep : 'pick'; }
const savePlan = lSave;
function setLstep(v) { lInit(); S.lstep = v; lSave(); }
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
function liftPick(p) {
  const sel = lsel(), mine = p.id === S.me.id;
  if (!mine) {
    const rows = (D.sets[p.id] || []).filter(r => r.day === TD);
    const by = {}; rows.forEach(r => ((by[r.muscle] ||= {})[r.exercise] ||= []).push(r));
    const body = Object.keys(by).length ? Object.entries(by).map(([m, ex]) => `<div style="margin-top:12px"><div class="lbl">${MNAME[m]}</div>${Object.entries(ex).map(([n, rs]) => `<div style="margin-top:8px;font-size:14px"><b>${esc(n)}</b><div class="note" style="margin:2px 0 0">${rs.sort((a, b) => a.set_no - b.set_no).map(fmtSet).join(' &middot; ')}</div></div>`).join('')}</div>`).join('') : `<p class="note" style="margin:10px 0 0">No lifts logged today yet.</p>`;
    return `<div class="card"><div class="lbl">${esc(p.name)}'s lifts today</div>${body}</div>`;
  }
  const chips = MUSCLES.map(([k, n]) => `<button data-msel="${k}" class="ctl ${sel.includes(k) ? 'on' : ''}">${n}</button>`).join('');
  const logged = (D.sets[p.id] || []).filter(r => r.day === TD).length;
  return `<div class="card"><div class="lbl" style="margin-bottom:4px">What are we training?</div><p class="note" style="margin:0 0 4px">Pick one or more muscle groups.</p><div class="chips">${chips}</div>
    <div class="row" style="margin-top:6px"><button class="btn ctl" id="lsubmit" ${sel.length ? '' : 'disabled style="opacity:.45"'}>Next</button></div>
    ${lstep() === 'plan' ? planSection() : ''}
    ${logged ? `<p class="note" style="margin:10px 0 0">${logged} set${logged === 1 ? '' : 's'} logged today.</p>` : ''}</div>`;
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
  return `<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:16px"><div class="lbl">Pick your lifts</div><p class="note" style="margin:6px 0 0">Tap every lift you want to do for each muscle group.</p>
    ${sel.map(block).join('')}
    <div class="row" style="margin-top:18px"><button class="btn ctl" id="lgo" ${total ? '' : 'disabled style="opacity:.45"'}>Let's get after it!</button></div></div>`;
}
function lastSummary(rows) {   // just the headline number from the previous session
  const w = Math.max(0, ...rows.map(r => +r.weight || 0)); if (w > 0) return `${w} lb`;
  const t = Math.max(0, ...rows.map(r => r.seconds || 0)); if (t > 0) return fmtTime(t);
  return `${Math.max(0, ...rows.map(r => r.reps || 0))} reps`;
}
function liftTile(p, key) {
  const i = key.indexOf('|'), m = key.slice(0, i), n = key.slice(i + 1);
  const done = todaySets(p.id, n), lt = lastTime(p.id, n), seed = done[done.length - 1] || (lt && lt.rows[0]) || {}, open = !(S.shut || {})[key], fin = (S.ldone || {})[key];
  // Defaults: today's last set once you have logged one, otherwise the top set from last time. Sets box = sets still to go.
  const top = lt ? lt.rows.slice().sort((a, b) => (+b.weight || 0) - (+a.weight || 0) || a.set_no - b.set_no)[0] : null, src = done[done.length - 1] || top || {};
  const wv = src.weight != null && +src.weight > 0 ? +src.weight : '', rv = src.reps ?? '', tsec = src.seconds || 0;
  const sv = Math.max(1, (lt ? lt.rows.length : 1) - done.length), mv = tsec ? Math.floor(tsec / 60) : '', tv = tsec ? tsec % 60 : '';
  const sum = fin ? 'Done' : done.length ? `${done.length} set${done.length === 1 ? '' : 's'}` : 'No sets yet';
  const fld = (cls, label, ph, val, extra = '') => `<label class="fld"><span>${label}</span><input type="number" class="ctl ${cls}" inputmode="${cls === 'lw' ? 'decimal' : 'numeric'}" min="0" ${extra} placeholder="${ph}" value="${val}"></label>`;
  const rows = done.map(r => `<div class="row" style="border-top:1px solid var(--line);padding:8px 0"><span class="badge">Set ${r.set_no}</span><span style="flex:1;font-size:15px">${fmtSet(r)}</span></div>`).join('');
  return `<div class="card dtile lift" data-lb="${esc(key)}" style="padding-bottom:${open ? 14 : 18}px">${GRIP}
    <button class="ctl" data-ltoggle="${esc(key)}" style="display:block;width:100%;background:none;border:0;color:var(--text);font:inherit;padding:0 44px 0 0;text-align:left"><div class="lbl" style="color:var(--acc)">${MNAME[m]}</div>
      <div class="row" style="margin-top:6px;gap:10px"><b style="flex:1;font-size:17px">${esc(n)}</b><span class="badge ${fin ? 'good' : ''}">${fin ? tick + ' ' : ''}${sum}</span><svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${open ? 180 : 0}deg);opacity:.5;flex:none"><path d="M2 5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div></button>
    ${open ? `${lt ? `<p class="note" style="margin:8px 0 0">Last time (${pretty(lt.day)}): ${lastSummary(lt.rows)}</p>` : ''}<div style="margin-top:8px">${rows}</div>
      <div class="lgrid">${fld('lw', 'Weight (lb)', 'lb', wv, 'step="0.5"')}${fld('lr', 'Reps', 'reps', rv)}${fld('ls', 'Sets', '1', sv, 'max="20"')}</div>
      <div class="lgrid two">${fld('lm', 'Time min', 'min', mv)}${fld('lt', 'Time sec', 'sec', tv, 'max="59"')}</div>
      <div class="lbtns"><button class="btn sm ctl" data-logset="1">Log set</button><button class="btn sm amber ctl" data-lundo="1" ${done.length ? '' : 'disabled style="opacity:.4"'}>Undo</button><button class="btn sm blue ctl" data-lcomp="1">Complete</button><button class="btn sm violet ctl" data-lhist="1">Historical lifts</button></div>` : ''}</div>`;
}
function liftSession(p) {
  return `<div id="lifts" data-dragbox="lifts">${lKeys().map(k => liftTile(p, k)).join('')}</div>
    <div class="row" style="margin:2px 0 14px"><button class="btn ghost sm" data-lplan="1">&lsaquo; Edit plan</button></div>`;
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
    if (n === 0) { clearInterval(iv); saveWorkout({ user_id: S.user.id, day: TD, kind: 'indoor', type: S.wtype.indoor || 'Lift', started_at: new Date().toISOString(), done_at: null, override: false }); setTimeout(() => el.remove(), 900); }
  }, 1000);
}
function vWorkoutPage(k, p) {
  return header(k === 'indoor' ? '<em>Indoor</em>' : '<em>Outdoor</em>') + testBar(p) +
    (S.hist && k === 'indoor' ? '' : `<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" data-back="1">&lsaquo; Back to workouts</button></div>`) + (k === 'indoor' ? (p.id === S.me.id && lstep() === 'go' ? (S.hist ? liftHistory(p) : wCard(k, p) + liftSession(p)) : liftPick(p) + wCard(k, p)) : `<div class="card"><div class="lbl">${wLabel(k)} page</div><p style="margin:10px 0 0;font-size:15px">This is the ${k} workout page. Test text for now. More features are coming here.</p></div>` + wCard(k, p));
}

function vMeals() {
  const rows = DAYN.map((d, i) => `<tr><td>${d}</td>${SLOTS.map(s => `<td contenteditable="true" class="ctl" data-meal="${i}|${s}">${esc(D.meals[i + '|' + s] || '')}</td>`).join('')}</tr>`).join('');
  return header('<em>Meals</em>') + dietBtn(viewed()) + `<div style="height:14px"></div>
   <div class="card"><div class="lbl" style="margin-bottom:8px">Weekly plan (shared, tap to edit)</div><div><table class="table"><tr><th></th><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>Snack</th></tr>${rows}</table></div></div>
   <div class="card"><div class="lbl" style="margin-bottom:6px">Grocery list (shared)</div>
   ${D.groceries.map(g => `<div class="row" style="border-top:1px solid var(--line)"><button class="groc ${g.done ? 'done' : ''}" style="border:0;flex:1" data-g="${g.id}"><span class="box ${g.done ? 'on' : ''}">${g.done ? tick : ''}</span><span>${esc(g.item)}</span></button><button class="xbtn" data-gdel="${g.id}" aria-label="Remove">&times;</button></div>`).join('')}
   <div class="row" style="margin-top:14px"><input type="text" id="gnew" placeholder="Add an item" maxlength="200"><button class="btn sm" id="gadd">Add</button></div></div>`;
}

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
  const cols = ['#2fd98f', '#c9e25f', '#ffffff', '#3ecbff', '#ffd166'];
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
function vWater() {
  if (S.view === 'split' && partner()) return splitWater();
  const p = viewed(), oz = dailyRow(p.id, TD).water_oz, WC = COLORS.water, js = jugsFor(p), tea = p.water_style === 'teacup';
  let used = 0; const items = js.map((sz, i) => { used += sz; return { sz, i, filled: oz >= used }; });
  const jugSvg = (sz, filled) => { const w = sz === 40 ? 56 : 44, h = sz === 40 ? 96 : 76;
    return `<svg width="${w}" height="${h}" viewBox="0 0 56 96"><rect x="20" y="2" width="16" height="8" rx="3" fill="none" stroke="${WC}" stroke-width="2"/><rect x="6" y="12" width="44" height="82" rx="14" fill="${filled ? WC : 'transparent'}" fill-opacity=".85" stroke="${WC}" stroke-width="2.5" style="filter:drop-shadow(0 0 ${filled ? 9 : 2}px ${WC})"/></svg>`; };
  const cup = f => `<svg width="56" height="64" viewBox="0 0 56 64"><path d="M8 18h34v20a14 14 0 01-14 14h-6A14 14 0 018 38z" fill="${f ? WC : 'transparent'}" fill-opacity=".85" stroke="${WC}" stroke-width="2.5" style="filter:drop-shadow(0 0 ${f ? 9 : 2}px ${WC})"/><path d="M42 24h4a6 6 0 010 14h-5" fill="none" stroke="${WC}" stroke-width="2.5"/><path d="M18 8c-2 3 2 4 0 7M28 8c-2 3 2 4 0 7" fill="none" stroke="${WC}" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>`;
  const jugBtns = items.map(x => `<button class="jug ctl" data-jug="${x.i}">${jugSvg(x.sz, x.filled)}<span>${x.sz} OZ</span></button>`).join('');
  const cupBtn = tea ? `<button class="jug ctl" data-cup="1">${cup(oz >= 128)}<span>TEA &middot; 8 OZ</span></button>` : '';
  return header('<em>Water</em>') + testBar(p) + `<div class="card" style="text-align:center">${ring(176, 12, Math.min(oz / WATER, 1), WC, `<span class="num" style="font-size:40px;font-weight:800">${oz}</span><span class="lbl">of 128 oz</span>`)}
   <div class="jugs">${jugBtns}${cupBtn}</div><p class="note">Tap each jug when you finish it.${tea ? ' Your last 8 oz is the tea at night.' : ''}</p></div>
   ${pushCard()}
   <div class="card"><div class="lbl">What a reminder looks like</div>
   <div class="banner show" style="position:static;transform:none;transition:none;width:100%"><div class="ic">${NICON}</div><div style="flex:1"><div class="t">Water Reminder<span>10 am, 12, 2, 4, 6</span></div><div class="m">${ntText()}</div></div></div>
   <div class="row" style="margin-top:14px"><button class="btn sm" id="notifGo">Show it as a pop-up</button></div></div>`;
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
  const W = 300, H = 110, pd = 14, vals = ws.map(x => +x.weight), mn = Math.min(...vals) - 3, mx = Math.max(...vals) + 3;
  const pts = ws.map(x => [pd + (x.day_num - 1) / 74 * (W - 2 * pd), H - pd - ((+x.weight - mn) / (mx - mn)) * (H - 2 * pd)]);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="margin-top:10px"><polyline points="${pts.map(q => q.join(',')).join(' ')}" fill="none" stroke="#2fd98f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${pts.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="#2fd98f"/><text x="${q[0]}" y="${q[1] - 9}" fill="#eaf4ee" font-size="10" text-anchor="middle">${ws[i].weight}</text>`).join('')}</svg>`;
}
function vProgress() {
  if (S.view === 'split' && partner()) return splitProgress();
  const p = viewed(), ws = D.weigh[p.id] || [], start = ws[0]?.weight, last = ws[ws.length - 1]?.weight;
  const diff = ws.length ? Math.round((last - start) * 10) / 10 : null;
  const ht = `${Math.floor(p.height_in / 12)}'${p.height_in % 12}"`;
  const n = dayNum(p), nc = nextCheck(p);
  const unlocked = nc === 1 || (nc && n >= nc);
  const photoOf = d => D.daily[dkey(p.id, d)]?.photo_path;
  const photos = []; for (let i = 0; i < 75; i++) { const d = addDays(p.start_date, i); const ph = photoOf(d); if (ph) photos.push({ i: i + 1, url: S.urls[ph] }); }
  const first = photos[0], latest = photos[photos.length - 1];
  const todayPh = photoOf(TD), done = !!todayPh;
  const cells = Array.from({ length: 75 }, (_, i) => { const ph = photoOf(addDays(p.start_date, i)); const u = ph && S.urls[ph]; return `<div class="${ph ? 'has' : ''} thumb" ${u ? `style="background-image:url('${u}')"` : ''}>${i + 1}</div>`; }).join('');
  const baStyle = u => u ? `background:url('${u}') center/cover` : '';
  return header('<em>Progress</em>') + `
  <div class="card"><div class="lbl" style="margin-bottom:12px">${esc(p.name)}'s numbers</div>
   <div class="statgrid">
    <div class="tile"><span class="lbl">Height</span><b>${ht}</b></div>
    <div class="tile"><span class="lbl">Starting</span><b>${start ?? '--'} <small>lb</small></b></div>
    <div class="tile"><span class="lbl">Current</span><b>${last ?? '--'} <small>lb</small></b></div>
    <div class="tile hi"><span class="lbl">Change</span><b>${diff === null ? '--' : (diff > 0 ? '+' : '') + diff} <small>lb</small></b></div>
   </div></div>
  <div class="card"><div class="lbl">Weigh-in &middot; every 10 days</div>
   <p style="margin:8px 0 12px;font-size:15px">${nc === null ? 'All weigh-ins done.' : nc === 1 ? 'Log your <b>starting weight</b>.' : `Next: <b>Day ${nc}</b>${unlocked ? ' (today)' : ` (unlocks on Day ${nc})`}`}</p>
   ${nc ? `<div class="row ctl"><input type="number" id="wt" placeholder="Weight in lb" step="0.1" min="50" max="600"><button class="btn sm" id="wlog" style="white-space:nowrap" ${unlocked ? '' : 'disabled'}>Log ${nc === 1 ? 'start' : 'Day ' + nc}</button></div>` : ''}
   ${chart(p)}</div>
  <div class="card" style="text-align:center">${ring(110, 10, done ? 1 : 0, COLORS.photo, `<span class="lbl" style="color:var(--text)">${done ? 'Done' : 'Today'}</span>`)}
   <div class="row ctl" style="justify-content:center;margin-top:16px;flex-wrap:wrap"><label class="btn">${done ? 'Replace today\'s photo' : 'Add today\'s photo'}<input id="ph" type="file" accept="image/*" hidden></label><label class="btn ghost">Add an older photo<input id="phOld" type="file" accept="image/*" hidden></label></div>
   <p class="note" style="margin-top:12px">Take it with your camera or pick one from your camera roll. You can both see each other's photos.</p></div>
  <div class="card"><div class="lbl" style="margin-bottom:10px">Before and after</div>
   ${first && latest && first !== latest ? `<div class="ba"><div class="a" style="${baStyle(first.url)}">Day ${first.i}</div><div class="b" id="bb" style="${baStyle(latest.url)}">Day ${latest.i}</div><div class="bar-h" id="bh"></div></div><input type="range" id="sl" min="0" max="100" value="50">`
     : '<p class="note">Add photos on two different days and your before and after slider shows up here.</p>'}</div>
  <div class="card"><div class="lbl" style="margin-bottom:10px">All 75 days</div><div class="grid75">${cells}</div></div>`;
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
const jugMini = (filled) => `<svg width="24" height="42" viewBox="0 0 56 96"><rect x="20" y="2" width="16" height="8" rx="3" fill="none" stroke="${COLORS.water}" stroke-width="3"/><rect x="6" y="12" width="44" height="82" rx="14" fill="${filled ? COLORS.water : 'transparent'}" fill-opacity=".85" stroke="${COLORS.water}" stroke-width="4"/></svg>`;
function splitWater() {
  return header('<em>Water</em>') + splitCols(p => {
    const oz = dailyRow(p.id, TD).water_oz, js = jugsFor(p); let used = 0;
    const jugs = js.map(sz => { used += sz; return jugMini(oz >= used); }).join('') + (p.water_style === 'teacup' ? `<span style="font-size:20px;opacity:${oz >= 128 ? 1 : .35}">&#9749;</span>` : '');
    return `<div style="text-align:center">${ring(110, 10, Math.min(oz / WATER, 1), COLORS.water, `<span class="num" style="font-size:26px;font-weight:800">${oz}</span><span class="lbl">of 128 oz</span>`)}</div><div class="row" style="justify-content:center;gap:6px;margin-top:10px;align-items:flex-end">${jugs}</div>`;
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
  });
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
  if (S.dragging) return;
  const app = $('app'), nav = $('nav');
  if (!S.user) { nav.hidden = true; app.className = ''; app.innerHTML = vAuth(); return; }
  if (!S.me) { nav.hidden = true; app.innerHTML = '<p class="note" style="padding:40px 0;text-align:center">Loading your profile...</p>'; return; }
  if (S.view === 'partner' && !partner()) S.view = 'me';
  nav.hidden = false;
  app.innerHTML = VIEWS[S.tab]();
  app.className = (!editable() && S.view !== 'split') ? 'ro' : '';
  nav.innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><svg width="22" height="22" viewBox="0 0 24 24">${ICONS[k]}</svg>${l}</button>`).join('');
  checkCelebrate(); checkRestart(); ensureUrls(); animateArcs();
}
function checkCelebrate() {
  const n = dayNum(S.me), key = `cel-${S.user.id}-${TD}`;
  if (S.view === 'split' || !editable() || !complete(S.me.id, TD)) return;
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
    <label class="check"><input type="checkbox" id="fxD" ${r.diet ? 'checked' : ''}> No cheat meals, no alcohol</label>
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
  const t = e.target.closest('button,label,[data-open]'); if (!t) return; const d = t.dataset;
  const u = S.user?.id, v = S.me && viewed();
  if (t.id === 'pushOn') return pushEnable();
  if (t.id === 'pushOff') return pushDisable();
  if (t.id === 'pushTest') { try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('Water Reminder', { body: reminderText(S.me, dailyRow(S.me.id, TD).water_oz), icon: 'icon-180.png' }); } catch (e) { toast('Could not show it: ' + e.message); } return; }
  if (t.id === 'atoggle') { S.authMode = S.authMode === 'up' ? 'in' : 'up'; render(); return; }
  if (!S.me) return;
  if (d.tab) { S.tab = d.tab; S.sub = null; $('app').scrollTo(0, 0); render(); return; }
  if (d.msel) { const sel = lsel(), i = sel.indexOf(d.msel); if (i >= 0) sel.splice(i, 1); else sel.push(d.msel); lSave(); render(); return; }
  if (t.id === 'lsubmit') { if (!lsel().length) return; setLstep('plan'); render(); return; }
  if (t.id === 'lgo') {
    if (!editable() || !lsel().length) return;
    const w = wInfo(wRow(u, TD, 'indoor')), o = wInfo(wRow(u, TD, 'outdoor'));
    if (o.st === 'running' || o.st === 'paused') { toast('Finish your outdoor workout first.'); return; }
    setLstep('go'); $('app').scrollTo(0, 0); render();
    if (w.st === 'idle') startCountdown();
    return;
  }
  if (d.lplan) { S.hist = null; setLstep('plan'); $('app').scrollTo(0, 0); render(); return; }
  if (d.ptog) { const i = d.ptog.indexOf('|'), m = d.ptog.slice(0, i), n = d.ptog.slice(i + 1), pl = lplan(); pl[m] = pl[m] || []; const k = pl[m].indexOf(n); if (k >= 0) pl[m].splice(k, 1); else pl[m].push(n); savePlan(); render(); return; }
  if (d.pother) { (S.pOther ||= {})[d.pother] = !S.pOther[d.pother]; render(); return; }
  if (d.paddc) { const m = d.paddc, inp = $('pcustom-' + m), n = inp ? inp.value.trim() : ''; if (!n) { toast('Type a lift name first.'); return; } const pl = lplan(); pl[m] = pl[m] || []; if (!pl[m].some(x => x.toLowerCase() === n.toLowerCase())) pl[m].push(n); S.pOther[m] = false; savePlan(); render(); return; }
  if (d.ltoggle) { (S.shut ||= {})[d.ltoggle] = !S.shut[d.ltoggle]; render(); return; }
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
  if (d.view) { S.view = d.view; render(); return; }
  if (t.id === 'signout') { await sb.auth.signOut(); return; }
  if (d.nt !== undefined) { S.nIdx = +d.nt; render(); return; }
  if (t.id === 'notifGo') { showBanner(); return; }
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
      await must(sb.from('daily').upsert({ user_id: u, day: date, water_oz: Math.min(400, +$('fxW').value || 0), pages: Math.min(2000, +$('fxP').value || 0), diet: ok('fxD'), updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
      $('overlay').innerHTML = ''; await loadAll(); render();
    } catch (_) { }
    return;
  }
  if (!editable()) return;
  if (d.lsdel) { D.sets[u] = (D.sets[u] || []).filter(x => x.id !== d.lsdel); render(); const { error } = await sb.from('lift_sets').delete().eq('id', d.lsdel); if (error) { toast(error.message); await loadAll(); render(); } return; }
  if (d.wundo) {
    const k = d.wundo, row = wRow(u, TD, k); if (!row || !row.done_at) return;
    const stopAt = +new Date(row.paused_at || row.done_at), el = stopAt - +new Date(row.started_at) - (row.paused_ms || 0);
    if (el >= WLEN - 1000) {
      if (!confirm('Undo this workout? It ran the full 45 minutes, so it goes back to Not started.')) return;
      delete D.workouts[u + '|' + TD + '|' + k]; render();
      const { error } = await sb.from('workouts').delete().match({ user_id: u, day: TD, kind: k }); if (error) { toast(error.message); await loadAll(); render(); }
    } else {
      if (!confirm('Undo? Your workout reopens paused right where you left off.')) return;
      saveWorkout({ ...row, done_at: null, paused_at: row.paused_at || row.done_at });
    }
    return;
  }
  if (d.lundo) {
    const key = t.closest('.lift').dataset.lb, name = key.slice(key.indexOf('|') + 1), rows = todaySets(u, name), last = rows[rows.length - 1];
    if (!last) return;
    D.sets[u] = D.sets[u].filter(x => x.id !== last.id); render();
    const { error } = await sb.from('lift_sets').delete().eq('id', last.id);
    if (error) { toast(error.message); await loadAll(); render(); } else toast(`Removed set ${last.set_no}.`);
    return;
  }
  if (d.lcomp) {
    const key = t.closest('.lift').dataset.lb, keys = lKeys(), i = keys.indexOf(key);
    (S.ldone ||= {})[key] = true; (S.shut ||= {})[key] = true;
    const next = [...keys.slice(i + 1), ...keys.slice(0, i)].find(k => !S.ldone[k]);
    if (next) S.shut[next] = false; lSave(); render();
    if (next) { const el = [...document.querySelectorAll('.lift')].find(x => x.dataset.lb === next); if (el) setTimeout(() => { const a = $('app'); a.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - a.getBoundingClientRect().top + a.scrollTop - 14), left: 0, behavior: 'smooth' }); }, 60); }
    else toast('Every lift is done. Nice work!');
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
    const rows = Array.from({ length: sets }, (_, k) => ({ day: TD, muscle: m, exercise: name, set_no: base + k + 1, reps, weight, seconds: secs > 0 ? secs : null }));
    const { error } = await sb.from('lift_sets').insert(rows);
    if (error) { toast(error.message); return; }
    if (S.ldone) { delete S.ldone[key]; lSave(); }
    await loadAll(); render(); return;
  }
  const today = TD;
  if (t.id === 'diet') return saveDaily(today, { diet: !dailyRow(u, today).diet });
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
  if (d.jug !== undefined) { const js = jugsFor(S.me), idx = +d.jug, oz = dailyRow(u, today).water_oz, upto = js.slice(0, idx + 1).reduce((a, b) => a + b, 0), below = js.slice(0, idx).reduce((a, b) => a + b, 0); return saveDaily(today, { water_oz: oz >= upto ? below : upto }); }
  if (d.cup) return saveDaily(today, { water_oz: dailyRow(u, today).water_oz >= 128 ? 120 : 128 });
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
  if (t.id === 'wlog') {
    const w = parseFloat($('wt').value), nc = nextCheck(S.me);
    if (!(w >= 50 && w <= 600)) { toast('Enter your weight in pounds.'); return; }
    await must(sb.from('weigh_ins').upsert({ user_id: u, day_num: nc, weight: w }, { onConflict: 'user_id,day_num' })); await loadAll(); render(); return;
  }
  if (d.g) { const g = D.groceries.find(x => x.id === d.g); g.done = !g.done; render(); sb.from('groceries').update({ done: g.done }).eq('id', g.id); return; }
  if (d.gdel) { D.groceries = D.groceries.filter(x => x.id !== d.gdel); render(); sb.from('groceries').delete().eq('id', d.gdel); return; }
  if (t.id === 'gadd') { const i = $('gnew'), item = i.value.trim(); if (!item) return; i.value = ''; await must(sb.from('groceries').insert({ item })); await loadAll(); render(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.wtype) { S.wtype[t.dataset.wtype] = t.value; return; }
  if (t.id === 'lpick') { const n = $('lname'); if (t.value === '__custom') { n.style.display = ''; n.value = ''; n.focus(); } else { n.style.display = 'none'; n.value = t.value; } return; }
  if (t.id === 'ph' && t.files[0]) uploadPhoto(t.files[0], TD);
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
