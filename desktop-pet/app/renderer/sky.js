'use strict';
// 星空天氣框（祐 2026-11-19）：記事板的白羽毛筆從右上角飄進來，用亮金色的字把天氣寫在神廟上方的星空，
// 筆尖經過的地方灑金色光點；寫完字輕輕閃。點一下收起；30 分鐘沒人點就慢慢淡出。
// 字（地點、接下來幾小時、降雨、氣溫、該準備什麼）由主程序照介面語言準備好，這裡只負責演。
const host = window.skyHost;
const $ = (id) => document.getElementById(id);

// 筆尖在原圖（1024×1536）裡的位置（跟記事板同一組筆）
const PENS = { a: { src: '../assets/note/pen_a.webp', tx: 208 / 1024, ty: 1509 / 1536 }, b: { src: '../assets/note/pen_b.webp', tx: 122 / 1024, ty: 1467 / 1536 } };
const IDLE_MS = 30 * 60 * 1000;

let F = 380, FH = 253, PAD = 91;   // 框寬、框高、上方留白
let penW = 84, tip = { x: 0, y: 0 };
let park = { x: 0, y: 0 };
const penEl = $('pen');
let penPos = { x: 0, y: 0, r: 0 };

function layout() {
  F = window.innerWidth / 1.2;
  FH = F * 2 / 3;
  PAD = F * 0.24;
  Object.assign($('frame').style, { top: `${PAD}px`, width: `${F}px`, height: `${FH}px` });
  Object.assign($('hit').style, { top: `${PAD}px`, width: `${F}px`, height: `${FH}px` });
  // 字放在神廟上面的星空：框寬 12%～88%、框高 12%～64%
  Object.assign($('text').style, { left: `${F * 0.12}px`, top: `${PAD + FH * 0.12}px`, width: `${F * 0.76}px`, height: `${FH * 0.52}px` });
  penW = F * 0.22;
  penEl.style.width = `${penW}px`;
  park = { x: F * 0.985, y: PAD + FH * 0.36 };
  const fx = $('fx');
  const dpr = window.devicePixelRatio || 1;
  fx.width = Math.round(window.innerWidth * dpr);
  fx.height = Math.round(window.innerHeight * dpr);
  fx.style.width = `${window.innerWidth}px`;
  fx.style.height = `${window.innerHeight}px`;
  fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 字太多放不下：整體縮小（最小 0.6 倍）
function fit() {
  const t = $('text');
  let fs = F * 0.058;
  t.style.fontSize = `${fs}px`;
  const room = FH * 0.52;
  const over = () => t.scrollHeight > room + 1 || [...t.querySelectorAll('.ln')].some((el) => el.offsetWidth > t.clientWidth + 1);
  for (let i = 0; i < 12 && over() && fs > F * 0.035; i++) {
    fs *= 0.93;
    t.style.fontSize = `${fs}px`;
  }
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
async function penTo(x, y, sec = 0.45) {
  const a = { ...penPos };
  const dist = Math.hypot(x - a.x, y - a.y);
  await tween(sec, (u) => {
    const e = ease(u);
    placePen(a.x + (x - a.x) * e, a.y + (y - a.y) * e - Math.sin(e * Math.PI) * Math.min(F * 0.05, dist * 0.15), a.r * (1 - e));
  });
}
// 寫：從 x0 走到 x1，每個字輕輕上下、筆身微晃，筆尖灑金粉
async function penWrite(x0, x1, y, sec, onX) {
  let last = performance.now();
  await tween(sec, (u, t) => {
    const x = x0 + (x1 - x0) * u;
    const bob = -Math.abs(Math.sin(t * Math.PI * 7)) * F * 0.01 + Math.sin(t * 23) * F * 0.0025;
    placePen(x, y + bob, Math.sin(t * 9) * 3);
    onX(x);
    const now = performance.now();
    dust(x, y + bob, (now - last) / 1000);
    last = now;
  });
}
const writeSec = (chars) => Math.max(0.5, Math.min(2.6, chars * 0.11));

const box = (el) => el.getBoundingClientRect();
function reveal(el, x) {
  const b = box(el);
  el.style.clipPath = `inset(-60% ${Math.max(0, b.right - x)}px -60% -20px)`;
}
const hideInk = (el) => { el.style.clipPath = 'inset(-60% 100% -60% -20px)'; };
const showInk = (el) => { el.style.clipPath = ''; };

async function writeEl(el) {
  const b = box(el);
  if (!b.width) { showInk(el); return; }
  const y = b.top + b.height * 0.74;
  await penTo(b.left, y, 0.4);
  await penWrite(b.left, b.right, y, writeSec(el.textContent.length), (x) => reveal(el, x));
  showInk(el);
  el.classList.add('done');
}

// ---------- 金色光點 ----------
const fxc = $('fx').getContext('2d');
const motes = [];
let carry = 0;
function dust(x, y, dt) {
  carry += dt * 20;
  while (carry >= 1) {
    carry -= 1;
    motes.push({ x: x + (Math.random() - 0.5) * F * 0.012, y: y + (Math.random() - 0.5) * F * 0.01, vx: (Math.random() - 0.5) * F * 0.03, vy: -F * (0.01 + Math.random() * 0.035), life: 0, max: 0.6 + Math.random() * 0.8, r: F * (0.0018 + Math.random() * 0.003), star: Math.random() < 0.2 });
  }
}
function drawMote(m, a) {
  const g = fxc.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 3);
  g.addColorStop(0, `rgba(255,248,214,${a * 0.9})`);
  g.addColorStop(0.35, `rgba(255,214,120,${a * 0.5})`);
  g.addColorStop(1, 'rgba(255,190,80,0)');
  fxc.fillStyle = g;
  fxc.beginPath();
  fxc.arc(m.x, m.y, m.r * 3, 0, Math.PI * 2);
  fxc.fill();
  if (m.star) { // 少數幾顆是十字星芒
    fxc.strokeStyle = `rgba(255,240,190,${a * 0.8})`;
    fxc.lineWidth = Math.max(0.6, m.r * 0.35);
    const k = m.r * 4.5;
    fxc.beginPath();
    fxc.moveTo(m.x - k, m.y); fxc.lineTo(m.x + k, m.y);
    fxc.moveTo(m.x, m.y - k); fxc.lineTo(m.x, m.y + k);
    fxc.stroke();
  }
}
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  fxc.clearRect(0, 0, window.innerWidth, window.innerHeight);
  fxc.globalCompositeOperation = 'lighter';
  for (let i = motes.length - 1; i >= 0; i--) {
    const m = motes[i];
    m.life += dt;
    if (m.life >= m.max) { motes.splice(i, 1); continue; }
    m.x += m.vx * dt; m.y += m.vy * dt; m.vy += F * 0.02 * dt;
    const u = m.life / m.max;
    drawMote(m, Math.sin(Math.PI * Math.min(1, u * 1.4 + 0.1)) * (1 - u * 0.4));
  }
  fxc.globalCompositeOperation = 'source-over';
  requestAnimationFrame(loop);
}

// ---------- 內容 ----------
function line(cls, text) {
  const el = document.createElement('span');
  el.className = `ln gold ${cls}`;
  el.textContent = text;
  return el;
}

function build(d) {
  const t = $('text');
  t.className = d.lang === 'ja' ? 'ja' : d.lang === 'en' ? 'en' : 'zh';
  document.documentElement.lang = d.lang || 'zh-TW';
  t.innerHTML = '';
  const ink = [];
  const add = (el) => { t.appendChild(el); if (el.classList.contains('ln')) { hideInk(el); ink.push(el); } return el; };
  const cap = (s) => (d.lang === 'en' ? s.charAt(0).toUpperCase() + s.slice(1) : s); // 英文的摘要片段是小寫開頭，框裡一行一句要大寫
  const head = [d.place, d.sub].filter(Boolean).join(' · ');
  if (head) add(line('place', head));
  for (const s of d.lines || []) add(line('', cap(s)));
  let rule = null;
  if ((d.tips || []).length) {
    rule = document.createElement('div');
    rule.className = 'rule';
    t.appendChild(rule);
    for (const s of d.tips) add(line('tip', s));
  }
  fit();
  return { ink, rule };
}

// 滑鼠只在框上時才接住；其他透明的地方讓點擊穿過去（不擋到撫子和桌面）
let ignoring = true;
function hover(e) {
  const b = box($('hit'));
  const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  if (inside === !ignoring) return;
  ignoring = !inside;
  host.ignore(ignoring);
}
window.addEventListener('mousemove', hover);
window.addEventListener('mouseleave', () => { if (!ignoring) { ignoring = true; host.ignore(true); } });

// ---------- 打開、收起 ----------
let closing = false;
function closeSky(slow) {
  if (closing) return;
  closing = true;
  document.body.classList.add(slow ? 'fade' : 'bye');
  setTimeout(() => host.close(), slow ? 2600 : 480);
}
$('hit').addEventListener('click', () => closeSky(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSky(false); });
setTimeout(() => closeSky(true), IDLE_MS);
window.addEventListener('resize', () => { layout(); fit(); });

(async () => {
  const d = await host.init();
  if (!d) return;
  layout();
  setPen(d.pen);
  placePen(F * 1.45, PAD * 0.1, 12); // 筆從右上角外面飄進來
  await Promise.all([penEl, $('frame')].map((im) => (im.complete ? null : new Promise((r) => im.addEventListener('load', r, { once: true })))));
  const { ink, rule } = build(d);
  requestAnimationFrame(loop);
  document.body.classList.add('show');
  await penTo(park.x, park.y, 0.7);
  for (const el of ink) {
    if (closing) return;
    if (rule && el.classList.contains('tip') && !rule.classList.contains('on')) rule.classList.add('on');
    await writeEl(el);
  }
  penTo(park.x, park.y, 0.6);
})();
