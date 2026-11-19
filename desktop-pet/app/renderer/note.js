'use strict';
// 記事板的信紙（祐 2026-11-17）：白羽毛筆從右上角飄過來，從左到右把事項寫上去（筆尖走到哪，字出現到哪）。
// 點事項：完成＝筆滑過去畫橫線、行尾寫「完成 時間」；變更＝也畫橫線，寫下原因；復原＝擦掉。
// 全部在這個視窗裡演，不花 Claude 的用量。結果交給主程序存進 schedule.json。
const host = window.noteHost;
let lang = 'zh-TW';
const T = (s, ...a) => PetI18n.t(lang, s, ...a);
const $ = (id) => document.getElementById(id);

// 筆尖在原圖（1024×1536）裡的位置
const PENS = { a: { src: '../assets/note/pen_a.webp', tx: 208 / 1024, ty: 1509 / 1536 }, b: { src: '../assets/note/pen_b.webp', tx: 122 / 1024, ty: 1467 / 1536 } };

let W = 320, PAD = 70, PH = 480;  // 信紙寬、上方留白、信紙高
let penW = 110, tip = { x: 0, y: 0 };
let park = { x: 0, y: 0 };
const penEl = $('pen');
let penPos = { x: 0, y: 0, r: 0 };
let data = null;
const rows = new Map();     // id → { el, item }
const penned = new Set();   // 這次打開已經寫過的

function layout() {
  W = window.innerWidth / 1.24;
  PH = W * 1.5;
  PAD = W * 0.22;
  const paper = $('paper');
  Object.assign(paper.style, { top: `${PAD}px`, width: `${W}px`, height: `${PH}px` });
  Object.assign($('drag').style, { width: `${W * 1.24}px`, height: `${PAD + PH * 0.12}px` });
  Object.assign($('page').style, { left: `${W * 0.13}px`, top: `${PAD + PH * 0.135}px`, width: `${W * 0.74}px`, height: `${PH * 0.73}px`, fontSize: `${W * 0.058}px` });
  const close = $('close');
  close.style.fontSize = `${W * 0.04}px`;
  close.style.left = `${W * 0.5 - close.offsetWidth / 2}px`;
  close.style.top = `${PAD + PH * 0.895}px`;
  penW = W * 0.34;
  penEl.style.width = `${penW}px`;
  park = { x: W * 0.93, y: PAD + PH * 0.3 };
}

// ---------- 羽毛筆 ----------
function setPen(kind) {
  const p = PENS[kind] || PENS.a;
  penEl.src = p.src;
  tip = { x: penW * p.tx, y: penW * 1.5 * p.ty };
  penEl.style.transformOrigin = `${tip.x}px ${tip.y}px`;
}
function placePen(x, y, r = 0) {
  penPos = { x, y, r };
  penEl.style.left = `${x - tip.x}px`;
  penEl.style.top = `${y - tip.y}px`;
  penEl.style.transform = `rotate(${r}deg)`;
}
const frame = () => new Promise((r) => requestAnimationFrame(r));
async function tween(sec, fn) {
  const t0 = performance.now();
  for (;;) {
    const t = (performance.now() - t0) / 1000;
    const u = Math.min(1, t / sec);
    fn(u, t);
    if (u >= 1) return;
    await frame();
  }
}
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
// 飄過去：中間微微抬起，像手在空中移動
async function penTo(x, y, sec = 0.45) {
  const a = { ...penPos };
  const dist = Math.hypot(x - a.x, y - a.y);
  await tween(sec, (u) => {
    const e = ease(u);
    placePen(a.x + (x - a.x) * e, a.y + (y - a.y) * e - Math.sin(e * Math.PI) * Math.min(W * 0.05, dist * 0.15), a.r * (1 - e));
  });
}
// 寫：從 x0 走到 x1，每個字輕輕上下、筆身微晃；onX 收到筆尖目前的 x
async function penWrite(x0, x1, y, sec, onX) {
  await tween(sec, (u, t) => {
    const x = x0 + (x1 - x0) * u;
    const bob = -Math.abs(Math.sin(t * Math.PI * 7)) * W * 0.012 + Math.sin(t * 23) * W * 0.003;
    placePen(x, y + bob, Math.sin(t * 9) * 3);
    onX(x);
  });
}
const writeSec = (chars) => Math.max(0.5, Math.min(2.5, chars * 0.12));

// 一次只演一段（寫字、畫線排隊）
let queue = Promise.resolve();
let busy = 0;
const enqueue = (job) => { busy++; queue = queue.then(job).catch((e) => console.error(e)).finally(() => { busy--; if (!busy) penTo(park.x, park.y, 0.6); }); return queue; };

// 元素在視窗裡的位置
const box = (el) => el.getBoundingClientRect();
// 把 el 從左邊開始露出到 x 為止
function reveal(el, x) {
  const b = box(el);
  el.style.clipPath = `inset(-30% ${Math.max(0, b.right - x)}px -30% 0)`;
}
const hideInk = (el) => { el.style.clipPath = 'inset(-30% 100% -30% 0)'; };
const showInk = (el) => { el.style.clipPath = ''; };

async function writeEl(el, chars) {
  const b = box(el);
  if (!b.width) { showInk(el); return; }
  const y = b.top + b.height * 0.78;
  await penTo(b.left, y);
  await penWrite(b.left, b.right, y, writeSec(chars), (x) => reveal(el, x));
  showInk(el);
}

async function strikeRow(r) {
  const ink = r.el.querySelector('.ink');
  const st = r.el.querySelector('.strike');
  const line = box(r.el.querySelector('.line'));
  const b = box(ink);
  const y = b.top + b.height * 0.55;
  st.style.top = `${y - line.top + (line.top - box(r.el).top)}px`;
  await penTo(b.left, y, 0.4);
  await penWrite(b.left, b.right, y, 0.6, (x) => { st.style.width = `${Math.max(0, x - b.left)}px`; });
  st.style.width = `${b.width}px`;
  r.el.classList.add('struck');
}

// ---------- 畫面 ----------
const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const tagText = (it) => (it.s === 'done' ? T('完成 {0}', hm(it.at)) : it.s === 'changed' ? T('變更') : it.s === 'pending' ? T('待處理') : '');

function makeRow(it) {
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = '<div class="line"><span class="ink"><span class="time"></span><span class="text"></span></span><span class="tag"></span></div><div class="strike"></div><div class="reason"></div>';
  el.querySelector('.time').textContent = it.time;
  el.querySelector('.text').textContent = it.text;
  el.title = `${it.time} ${it.text}`;
  el.addEventListener('click', (e) => { e.stopPropagation(); openMenu(it.id); });
  return el;
}

// 照狀態直接畫好（不演）
function paintRow(r) {
  const it = r.item;
  const el = r.el;
  el.classList.toggle('due', !!(data.due || []).includes(it.id));
  el.querySelector('.text').textContent = it.text;
  const tag = el.querySelector('.tag');
  tag.textContent = tagText(it);
  tag.classList.toggle('pending', it.s === 'pending');
  el.querySelector('.reason').textContent = it.s === 'changed' && it.reason ? `→ ${it.reason}` : '';
  const struck = it.s === 'done' || it.s === 'changed';
  el.classList.toggle('struck', struck);
  const st = el.querySelector('.strike');
  if (struck) {
    const ink = box(el.querySelector('.ink'));
    st.style.top = `${ink.top - box(el).top + ink.height * 0.55}px`;
    st.style.width = `${ink.width}px`;
  } else st.style.width = '0';
}

function render(d) {
  data = d;
  lang = d.lang || lang;
  const page = $('page');
  page.className = lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang;
  const [y, m, dd] = d.date.split('-').map(Number);
  const loc = lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW';
  $('date').textContent = new Intl.DateTimeFormat(loc, { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(y, m - 1, dd));
  const icon = { rainy: '☂', chilly: '❄', hot: '☀' };
  const icons = d.weather && d.weather.kind ? String(d.weather.kind).split('+').map((k) => icon[k]).filter(Boolean).join('') : '';
  $('weather').textContent = d.weather && d.weather.text ? `${icons || '☁'} ${d.weather.text}` : '';
  $('close').textContent = T('收起');
  layout();

  const list = $('list');
  const ids = new Set(d.items.map((x) => x.id));
  for (const [id, r] of rows) if (!ids.has(id)) { r.el.remove(); rows.delete(id); }
  const toWrite = [];
  d.items.forEach((it, i) => {
    let r = rows.get(it.id);
    const fresh = !r;
    if (fresh) { r = { el: makeRow(it), item: it }; rows.set(it.id, r); }
    const before = list.children[i];
    if (before !== r.el) list.insertBefore(r.el, before || null);
    if (!r.anim) { r.item = it; paintRow(r); }
    const want = ((d.write || []).includes(it.id) || (d.due || []).includes(it.id)) && !penned.has(it.id);
    if (want) { penned.add(it.id); toWrite.push(r); hideInk(r.el.querySelector('.ink')); hideInk(r.el.querySelector('.tag')); }
  });
  let empty = $('empty');
  if (!d.items.length && !empty) { empty = document.createElement('div'); empty.id = 'empty'; list.appendChild(empty); }
  if (empty) { if (d.items.length) empty.remove(); else empty.textContent = T('今天沒有排定的事項'); }

  if (toWrite.length) {
    enqueue(async () => {
      for (const r of toWrite) {
        r.anim = true;
        await writeEl(r.el.querySelector('.ink'), (r.item.time + r.item.text).length);
        const tag = r.el.querySelector('.tag');
        if (tag.textContent) await writeEl(tag, tag.textContent.length); else showInk(tag);
        r.anim = false;
      }
      const ids2 = toWrite.map((r) => r.item.id).filter((id) => (d.write || []).includes(id));
      if (ids2.length) host.written(ids2);
    });
  }
}

// ---------- 點事項 ----------
const menu = $('menu');
function closeMenu() { menu.classList.remove('on'); menu.innerHTML = ''; }
function openMenu(id) {
  const r = rows.get(id);
  if (!r || r.anim) return;
  closeMenu();
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); fn(); }); menu.appendChild(b); };
  if (r.item.s !== 'done') add(T('完成'), () => doDone(r));
  if (r.item.s !== 'changed') add(T('變更'), () => doChange(r));
  if (r.item.s) add(T('復原'), () => doUndo(r));
  add(T('取消'), () => {});
  menu.classList.add('on');
  const b = box(r.el);
  const mw = menu.offsetWidth;
  menu.style.left = `${Math.max(4, Math.min(b.left + (b.width - mw) / 2, window.innerWidth - mw - 4))}px`;
  menu.style.top = `${b.bottom + 2}px`;
}
document.addEventListener('click', closeMenu);

function doDone(r) {
  const at = Date.now();
  host.status(r.item.id, 'done');
  enqueue(async () => {
    r.anim = true;
    r.el.querySelector('.reason').textContent = '';
    if (!r.el.classList.contains('struck')) await strikeRow(r);
    r.item = { ...r.item, s: 'done', at, reason: undefined };
    const tag = r.el.querySelector('.tag');
    tag.classList.remove('pending');
    tag.textContent = tagText(r.item);
    hideInk(tag);
    await writeEl(tag, tag.textContent.length);
    r.anim = false;
  });
}

function doChange(r) {
  enqueue(async () => {
    r.anim = true;
    const was = r.el.classList.contains('struck');
    if (!was) await strikeRow(r);
    const reason = await askReason(r);
    if (reason == null) { // 取消：線擦掉，回到原本的樣子
      r.anim = false;
      paintRow(r);
      return;
    }
    const at = Date.now();
    host.status(r.item.id, 'changed', reason);
    r.item = { ...r.item, s: 'changed', at, reason };
    const tag = r.el.querySelector('.tag');
    tag.classList.remove('pending');
    tag.textContent = tagText(r.item);
    hideInk(tag);
    const rs = r.el.querySelector('.reason');
    rs.textContent = reason ? `→ ${reason}` : '';
    if (reason) { hideInk(rs); await writeEl(rs, reason.length + 1); }
    await writeEl(tag, tag.textContent.length);
    r.anim = false;
  });
}

// 在那一行下面打原因；按確定回傳文字，取消回傳 null
function askReason(r) {
  return new Promise((done) => {
    const ask = document.createElement('div');
    ask.className = 'ask';
    ask.innerHTML = '<input maxlength="40"><button class="ok"></button><button class="no"></button>';
    const input = ask.querySelector('input');
    input.placeholder = T('原因（例如身體不適請假）');
    ask.querySelector('.ok').textContent = T('確定');
    ask.querySelector('.no').textContent = T('取消');
    ask.addEventListener('click', (e) => e.stopPropagation());
    r.el.appendChild(ask);
    penTo(park.x, park.y, 0.5); // 筆先回去等
    setTimeout(() => input.focus(), 50);
    const end = (v) => { ask.remove(); done(v); };
    ask.querySelector('.ok').addEventListener('click', () => end(input.value.trim()));
    ask.querySelector('.no').addEventListener('click', () => end(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') end(input.value.trim()); if (e.key === 'Escape') { e.stopPropagation(); end(null); } });
  });
}

function doUndo(r) {
  host.status(r.item.id, null);
  r.item = { ...r.item, s: undefined, at: undefined, reason: undefined };
  paintRow(r);
}

// ---------- 打開、收起 ----------
let closing = false;
function closeNote() {
  if (closing) return;
  closing = true;
  document.body.classList.add('bye');
  setTimeout(() => host.close(), 320);
}
$('close').addEventListener('click', (e) => { e.stopPropagation(); closeNote(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.ask')) closeNote(); });

host.onData((d) => { if (d) render(d); });
window.addEventListener('resize', () => { layout(); for (const r of rows.values()) if (!r.anim) paintRow(r); });

(async () => {
  const d = await host.init();
  if (!d) return;
  lang = d.lang || lang;
  layout();
  setPen(d.pen);
  // 筆從右上角外面飄進來
  placePen(W * 1.4, PAD * 0.2, 12);
  await new Promise((r) => (penEl.complete ? r() : penEl.addEventListener('load', r, { once: true })));
  document.body.classList.add('show');
  await penTo(park.x, park.y, 0.7);
  render(d);
})();
