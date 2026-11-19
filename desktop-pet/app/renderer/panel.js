'use strict';
/* global PetI18n */
const host = window.panelHost;
const $ = (id) => document.getElementById(id);

// 介面語言（祐 2026-11-16）：程式和 panel.html 照舊寫繁體中文，顯示前查字典（app/lib/i18n.js）。
// T()：程式裡組出來的字；translateDom()：把畫面上現成的字（HTML 裡寫的、清單按鈕）整批換掉。
// 字典裡沒有的就維持中文。換語言時整頁重新載入。
let settings = {};
const T = (str, ...args) => PetI18n.t(settings.lang, str, ...args);
function translateDom(root) {
  if (PetI18n.norm(settings.lang) === PetI18n.DEFAULT) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const raw = n.nodeValue;
    const k = raw.trim();
    if (!k || (n.parentNode && /^(SCRIPT|STYLE|PRE)$/.test(n.parentNode.nodeName))) continue;
    const tr = T(k);
    if (tr !== k) n.nodeValue = raw.replace(k, tr);
  }
  for (const el of root.querySelectorAll('[placeholder],[title]')) {
    for (const a of ['placeholder', 'title']) if (el.hasAttribute(a)) el.setAttribute(a, T(el.getAttribute(a)));
  }
}

const TOGGLES = [
  ['walk', '在螢幕下緣走動'], ['fly', '偶爾飛起來'],
  ['voice', '語音'], ['perch', '坐到視窗邊緣'], ['bubble', '頭上小字'], ['alwaysOnTop', '保持在最上層'],
];
const FORCE = [
  [null, '自動（跟 Claude 連動）'], ['free', '精神飽滿（隨機）'], ['thinking', '思考中'], ['working', '工作中'], ['compacting', '整理記憶'],
  ['waiting', '等你確認'], ['done', '完成'], ['hello', '打招呼'], ['error', '出錯'],
  ['tired', '疲憊'], ['exhausted', '5h 用完（睡覺）'], ['faint', '暈倒（週上限）'],
];
const SIM = [
  ['開新工作階段', { hook_event_name: 'SessionStart', source: 'startup' }],
  ['送出提示（思考）', { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }],
  ['呼叫工具 Bash（工作）', { hook_event_name: 'PreToolUse', tool_name: 'Bash' }],
  ['呼叫工具 Edit（工作）', { hook_event_name: 'PreToolUse', tool_name: 'Edit' }],
  ['要求權限（等你）', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' }],
  ['回答結束（完成）', { hook_event_name: 'Stop' }],
  ['撞到用量上限', { hook_event_name: 'StopFailure', error: 'rate_limit' }],
  ['額度恢復自動續跑', { hook_event_name: 'Notification', notification_type: 'quota_auto_resume_fired' }],
  ['其他 API 錯誤', { hook_event_name: 'StopFailure', error: 'server_error' }],
  ['結束工作階段', { hook_event_name: 'SessionEnd', reason: 'other' }],
];
const ACTIONS = [
  ['walk', '走一走'], ['fly', '飛一圈'], ['yawn', '打哈欠'], ['stretch', '伸懶腰'],
  ['wave', '揮手'], ['curious', '東張西望'], ['cheer', '歡呼'], ['nap', '側睡'], ['sit', '坐下休息'], ['perch', '坐到視窗邊緣'], ['shy', '害羞'], ['wake', '睡醒爬起來'], ['pray', '禱告'], ['doze', '坐著打盹'], ['curtsy', '提屈膝禮'], ['pirouette', '芭蕾：旋轉'], ['arabesque', '芭蕾：阿拉貝斯克'], ['land', '回到地面'],
];

const VLABEL = {
  yawn: '打哈欠', stretch: '伸懶腰', wave: '揮手', cheer: '歡呼', nap: '側睡', curious: '東張西望', pose: '擺姿勢', happy: '被點一下', pat: '摸頭',
  drag: '被拎起', dizzy: '摔暈', fly: '飛行', sit: '坐下休息', wake: '睡醒', hello: '打招呼', thinking: '思考中', working: '工作中',
  waiting: '等你確認', done: '完成', error: '出錯', tired: '疲憊', exhausted: '5h 用完（睡覺）', faint: '暈倒（週上限）', perch: '坐在視窗邊緣',
  shy: '害羞', greet_morning: '早安問候', greet_noon: '中午問候', greet_afternoon: '下午問候', greet_evening: '晚上問候', greet_night: '深夜問候',
  perch_lie: '趴在視窗上', drop: '飄落', mail: '收信', pray: '禱告', lantern: '放天燈', sparkler: '仙女棒', gift: '聖誕禮物', birthday: '生日快樂', newyear: '新年拜年', petbday: '撫子的生日', dragonboat: '端午香包', valentine: '情人節巧克力', midautumn: '中秋賞月', rainy: '下雨帶傘', chilly: '天冷保暖', hot: '天熱喝水', nod: '點頭贊同', shake: '搖頭困惑',
};
let voiceData = null;   // { lines, files, url, voice, max }
let studioAudio = null;

let forced = null;

function bindRange(id, key, fmt) {
  const el = $(id);
  const out = $(`${id}-out`);
  el.value = settings[key];
  out.textContent = fmt(settings[key]);
  el.oninput = () => { out.textContent = fmt(Number(el.value)); };
  el.onchange = () => host.set(key, Number(el.value));
}

// 曲子清單：唱歌在 app/music/、小提琴在 app/music/violin/、指揮在 app/music/conduct/，每首一顆按鈕
async function renderSongs(kind) {
  const songs = await host.musicList(kind);
  const box = $(`songs-${kind}`);
  box.textContent = '';
  if (!songs.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = T('還沒有曲子');
    box.appendChild(p);
  }
  for (const s of songs) {
    const b = document.createElement('button');
    b.textContent = `♪ ${s.title}`;
    b.onclick = () => host.action(`${kind}:${s.file}`);
    box.appendChild(b);
  }
}

function render() {
  $('size').value = settings.size;
  $('size-out').textContent = `${settings.size}px`;
  $('volume').value = settings.volume;
  $('volume-out').textContent = `${settings.volume}%`;
  $('bubbleScale').value = settings.bubbleScale;
  $('bubbleScale-out').textContent = `${settings.bubbleScale}%`;
  for (const k of ['tiredAt', 'faintAt', 'napAt']) {
    $(k).value = settings[k];
    $(`${k}-out`).textContent = `${settings[k]}%`;
  }
  $('actMode').value = settings.actMode || 'mixed';
  const [bm, bd] = /^\d{2}-\d{2}$/.test(settings.birthday || '') ? settings.birthday.split('-') : ['01', '01'];
  $('bmonth').value = bm;
  $('bday').value = bd;
  $('bon').checked = !!settings.birthdayOn;
  const [pm, pd] = /^\d{2}-\d{2}$/.test(settings.petBirthday || '') ? settings.petBirthday.split('-') : ['03', '30'];
  $('pmonth').value = pm;
  $('pday').value = pd;
  $('pon').checked = settings.petBirthdayOn !== false;
  for (const b of document.querySelectorAll('#toggles input')) b.checked = !!settings[b.dataset.key];
  // 天氣提醒（輸入框正在打字時不要蓋掉）
  $('wx-on').checked = !!settings.weatherOn;
  $('wx-place').textContent = settings.weatherPlace ? T('目前地點：{0}', settings.weatherPlace.label) : T('還沒設定城市（搜尋後選一個）');
  if (document.activeElement !== $('wx-times')) $('wx-times').value = settings.weatherTimes || '';
  for (const k of ['rainAt', 'coldAt', 'hotAt']) if (document.activeElement !== $(k)) $(k).value = settings[k];
  // 記事板
  $('nb-on').checked = settings.noteOn !== false;
  if (document.activeElement !== $('nb-pend')) $('nb-pend').value = settings.notePendingMin || 10;
  // 深夜勸睡
  $('nt-on').checked = settings.nightOn !== false;
  $('nt-tell').checked = settings.nightTell !== false;
  if (document.activeElement !== $('nt-from')) $('nt-from').value = settings.nightFrom || '01:00';
  if (document.activeElement !== $('nt-to')) $('nt-to').value = settings.nightTo || '05:00';
  const wl = settings.weatherLast;
  $('wx-last').textContent = wl ? `${new Date(wl.at).toLocaleString()}　${wl.text}${wl.kind ? `→ ${String(wl.kind).split('+').map((k) => T(WX_LABEL[k] || k)).join(' ＋ ')}` : T('→ 不用提醒')}` : '';
  for (const b of document.querySelectorAll('#force button')) b.classList.toggle('on', (b.dataset.key || null) === (forced || null));
}

const WX_LABEL = { rainy: '下雨帶傘', chilly: '天冷保暖', hot: '天熱喝水' };

// 記事板（祐 2026-11-17）：行程清單＋手動排定（月／日、時間、事項，跟生日同款的下拉選單）
// 那天那個時間已經排了東西，就把原本的事項帶出來改；點清單裡的行程也可以改。排定後桌寵會打開信紙，用羽毛筆寫上去。
const nb = { edit: null, items: [] };
const pad2 = (n) => String(n).padStart(2, '0');
// 選的月／日 → 日期（已經過了的日子當作明年）
function nbDate() {
  const now = new Date();
  const m = Number($('nb-month').value), d = Number($('nb-day').value);
  let y = now.getFullYear();
  const pick = new Date(y, m - 1, d);
  if (pick.getMonth() !== m - 1) return null; // 2/30 這種
  if (pick < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y += 1;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
const nbTime = () => { const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec($('nb-time').value); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad2(Number(m[1]))}:${m[2]}` : null; };
const DAYS_KEY = (it) => (it.date ? 'date' : !it.days || !it.days.length ? '' : it.days.join() === '1,2,3,4,5' ? '平日' : it.days.join() === '0,6' ? '週末' : '');

function nbSetEdit(it) {
  nb.edit = it ? it.id : null;
  $('nb-add').textContent = T(it ? '修改' : '排定');
  for (const r of document.querySelectorAll('.nb-item')) r.classList.toggle('editing', r.dataset.id === nb.edit);
}

// 把一筆行程帶進表單來改
function nbLoad(it) {
  if (it.date) { const [, m, d] = it.date.split('-'); $('nb-month').value = m; $('nb-day').value = d; }
  $('nb-time').value = it.time;
  $('nb-days').value = DAYS_KEY(it);
  $('nb-month').disabled = $('nb-day').disabled = $('nb-days').value !== 'date';
  $('nb-text').value = it.text;
  nbSetEdit(it);
  nbSame();
}

// 這天排了哪些：列在時間下面，點一下帶出來改；時間對上的那筆直接帶出原本的事項
async function nbSame() {
  const tok = (nb.tok = (nb.tok || 0) + 1); // 連續觸發（換月、換時間）時只畫最後一次，免得列兩遍
  const box = $('nb-same');
  box.innerHTML = '';
  const date = nbDate();
  if (!date || $('nb-days').value !== 'date') return;
  const list = await host.noteDay(date);
  if (tok !== nb.tok) return;
  box.innerHTML = '';
  if (!list.length) return;
  const lead = document.createElement('span');
  lead.textContent = T('這天排定的：');
  box.appendChild(lead);
  for (const it of list) {
    const b = document.createElement('button');
    b.textContent = `${it.time} ${it.text}`;
    b.onclick = () => nbLoad(it);
    box.appendChild(b);
  }
  const t = nbTime();
  const hit = t && list.find((x) => x.time === t);
  if (hit && nb.edit !== hit.id) { $('nb-text').value = hit.text; nbSetEdit(hit); }
  else if (!hit && nb.edit && list.some((x) => x.id === nb.edit) && t) nbSetEdit(null); // 換了時間：變成另一筆新的
}

async function refreshNotes() {
  const list = $('nb-list');
  nb.items = await host.noteList();
  list.innerHTML = '';
  if (!nb.items.length) { const p = document.createElement('div'); p.className = 'hint'; p.textContent = T('（還沒有行程）'); list.appendChild(p); return; }
  const loc = PetI18n.norm(settings.lang) === 'ja' ? 'ja-JP' : PetI18n.norm(settings.lang) === 'en' ? 'en-US' : 'zh-TW';
  const wd = (n) => new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(new Date(2026, 10, 15 + n)); // 2026-11-15 是週日
  for (const it of nb.items) {
    const row = document.createElement('div');
    row.className = 'nb-item';
    row.dataset.id = it.id;
    const when = it.date ? T('只有 {0}', it.date) : it.days && it.days.length ? (it.days.join() === '1,2,3,4,5' ? T('平日') : it.days.join() === '0,6' ? T('週末') : T('每週 {0}', it.days.map(wd).join('、'))) : T('每天');
    row.innerHTML = '<span class="t"></span><span class="x"></span><span class="d"></span><button></button>';
    row.querySelector('.t').textContent = it.time;
    row.querySelector('.x').textContent = it.text;
    row.querySelector('.x').title = T('點一下可以修改');
    row.querySelector('.x').onclick = () => nbLoad(it);
    row.querySelector('.d').textContent = when;
    const del = row.querySelector('button');
    del.textContent = T('刪除');
    del.onclick = async () => { await host.noteRemove(it.id); if (nb.edit === it.id) nbClear(); refreshNotes(); nbSame(); };
    list.appendChild(row);
  }
  nbSetEdit(nb.items.find((x) => x.id === nb.edit) || null);
}

function nbClear() {
  $('nb-text').value = '';
  $('nb-msg').textContent = '';
  nbSetEdit(null);
}

function bindNotes() {
  $('nb-on').onchange = (e) => host.set('noteOn', e.target.checked);
  $('nb-pend').onchange = (e) => host.set('notePendingMin', e.target.value);
  $('nb-open').onclick = () => host.noteOpen();
  const fillSel = (sel, n) => { sel.innerHTML = ''; for (let i = 1; i <= n; i++) { const o = document.createElement('option'); o.value = pad2(i); o.textContent = i; sel.appendChild(o); } };
  fillSel($('nb-month'), 12);
  fillSel($('nb-day'), 31);
  const now = new Date();
  $('nb-month').value = pad2(now.getMonth() + 1);
  $('nb-day').value = pad2(now.getDate());
  for (const id of ['nb-month', 'nb-day', 'nb-days']) $(id).onchange = () => { $('nb-month').disabled = $('nb-day').disabled = $('nb-days').value !== 'date'; nbSame(); };
  $('nb-time').onchange = nbSame;
  $('nb-new').onclick = nbClear;
  $('nb-add').onclick = async () => {
    const days = $('nb-days').value;
    const date = days === 'date' ? nbDate() : null;
    if ((days === 'date' && !date) || !nbTime() || !$('nb-text').value.trim()) { $('nb-msg').textContent = T('時間要像 15:00，事項不能是空的'); return; }
    const r = await host.noteAdd({ id: nb.edit, time: nbTime(), text: $('nb-text').value, date, days: days === 'date' ? '' : days });
    if (r && r.error) { $('nb-msg').textContent = T('時間要像 15:00，事項不能是空的'); return; }
    nbClear();
    $('nb-msg').textContent = T('排好了，她會寫在信紙上');
    await refreshNotes();
    nbSame();
  };
  refreshNotes().then(nbSame);
}

function bindNight() {
  $('nt-on').onchange = (e) => host.set('nightOn', e.target.checked);
  $('nt-tell').onchange = (e) => host.set('nightTell', e.target.checked);
  $('nt-from').onchange = (e) => host.set('nightFrom', e.target.value);
  $('nt-to').onchange = (e) => host.set('nightTo', e.target.value);
}

function bindWeather() {
  $('wx-on').onchange = (e) => host.set('weatherOn', e.target.checked);
  let found = [];
  const find = async () => {
    const q = $('wx-q').value.trim();
    if (!q) return;
    $('wx-place').textContent = T('搜尋中…');
    const r = await host.weatherSearch(q);
    found = r.list || [];
    if (r.error || !found.length) { $('wx-place').textContent = r.error ? T('搜尋失敗（{0}）', r.error) : T('找不到這個地方，換個寫法試試（中文、英文都可以）'); return; }
    const sel = $('wx-pick');
    sel.innerHTML = '';
    found.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.label; sel.appendChild(o); });
    $('wx-pick-row').hidden = found.length < 2;
    host.set('weatherPlace', { label: found[0].label, lat: found[0].lat, lon: found[0].lon });
  };
  $('wx-find').onclick = find;
  $('wx-q').onkeydown = (e) => { if (e.key === 'Enter') find(); };
  $('wx-pick').onchange = (e) => { const p = found[Number(e.target.value)]; if (p) host.set('weatherPlace', { label: p.label, lat: p.lat, lon: p.lon }); };
  $('wx-times').onchange = (e) => host.set('weatherTimes', e.target.value);
  for (const k of ['rainAt', 'coldAt', 'hotAt']) $(k).onchange = (e) => host.set(k, Number(e.target.value));
  $('wx-check').onclick = async () => {
    $('wx-last').textContent = T('查詢中…');
    const r = await host.weatherCheck();
    if (r.error) $('wx-last').textContent = r.error;
  };
}

async function main() {
  $('close').onclick = () => window.close();
  const init = await host.init();
  settings = init.settings;
  forced = init.forced;
  document.documentElement.lang = PetI18n.norm(settings.lang);
  document.title = T('撫子 控制面板');
  for (const [k, l] of PetI18n.LANGS) { const o = document.createElement('option'); o.value = k; o.textContent = l; $('lang').appendChild(o); }
  $('lang').value = PetI18n.norm(settings.lang);
  $('lang').onchange = (e) => host.set('lang', e.target.value);
  $('size').min = init.sizeMin;
  $('size').max = init.sizeMax;
  bindRange('size', 'size', (v) => `${v}px`);
  $('size').oninput = () => { $('size-out').textContent = `${$('size').value}px`; host.set('size', Number($('size').value)); };
  bindRange('volume', 'volume', (v) => `${v}%`);
  bindRange('bubbleScale', 'bubbleScale', (v) => `${v}%`);
  bindRange('tiredAt', 'tiredAt', (v) => `${v}%`);
  bindRange('faintAt', 'faintAt', (v) => `${v}%`);
  bindRange('napAt', 'napAt', (v) => `${v}%`);
  $('dir').textContent = T('狀態資料夾：{0}', init.stateDir);

  $('actMode').onchange = (e) => host.set('actMode', e.target.value);
  bindWeather();
  bindNight();
  bindNotes();
  bindRange('noteWidth', 'noteWidth', (v) => `${v}px`);
  bindRange('skyWidth', 'skyWidth', (v) => `${v}px`);
  // 主人的生日：月、日兩個下拉選單（預設 1 月 1 日，選了就存 MM-DD），「啟用」打勾才會在生日那天捧蛋糕
  const fill = (sel, n) => {
    sel.innerHTML = '';
    for (let i = 1; i <= n; i++) { const o = document.createElement('option'); o.value = String(i).padStart(2, '0'); o.textContent = i; sel.appendChild(o); }
  };
  fill($('bmonth'), 12);
  fill($('bday'), 31);
  const saveBirthday = () => host.set('birthday', `${$('bmonth').value}-${$('bday').value}`);
  $('bmonth').onchange = saveBirthday;
  $('bday').onchange = saveBirthday;
  $('bon').onchange = (e) => host.set('birthdayOn', e.target.checked);
  fill($('pmonth'), 12);
  fill($('pday'), 31);
  const savePetBirthday = () => host.set('petBirthday', `${$('pmonth').value}-${$('pday').value}`);
  $('pmonth').onchange = savePetBirthday;
  $('pday').onchange = savePetBirthday;
  $('pon').onchange = (e) => host.set('petBirthdayOn', e.target.checked);
  for (const [key, label] of TOGGLES) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" data-key="${key}"> ${label}`;
    l.querySelector('input').onchange = (e) => host.set(key, e.target.checked);
    $('toggles').appendChild(l);
  }
  for (const [key, label] of FORCE) {
    const b = document.createElement('button');
    b.textContent = label;
    if (key) b.dataset.key = key;
    b.onclick = () => host.force(key);
    $('force').appendChild(b);
  }
  for (const [label, input] of SIM) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { host.force(null); host.simHook(input); };
    $('sim').appendChild(b);
  }
  for (const [key, label] of ACTIONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => host.action(key);
    $('actions').appendChild(b);
  }
  for (const kind of ['sing', 'violin', 'conduct', 'harp', 'keys']) {
    $(`plain-${kind}`).onclick = () => host.action(kind);
    $(`refresh-${kind}`).onclick = () => renderSongs(kind);
    $(`open-${kind}`).onclick = () => host.musicOpen(kind);
    renderSongs(kind);
  }
  for (const id of ['u5', 'u7']) $(id).oninput = () => { $(`${id}-out`).textContent = `${$(id).value}%`; };
  $('send-usage').onclick = () => { host.force(null); host.simUsage(Number($('u5').value), Number($('u7').value)); };
  $('clear').onclick = () => host.simClear();

  host.onSettings((s) => {
    const langChanged = PetI18n.norm(s.lang) !== PetI18n.norm(settings.lang);
    settings = s;
    if (langChanged) { location.reload(); return; } // 換語言：整頁重新載入，所有字一次換掉
    render();
  });
  host.onForce((k) => { forced = k; render(); });
  host.onSnapshot(showSnap);
  showSnap(init.snapshot);
  render();
  translateDom(document.body);
  initVoice();
}

// ---------- 語音工作室 ----------
// lineVol：這句自己的音量（%），跟總音量相乘；超過 100% 用 Web Audio 增益放大
let studioCtx = null;
function playBytes(bytes, mime, lineVol = 100) {
  if (studioAudio) { studioAudio.pause(); URL.revokeObjectURL(studioAudio.src); }
  const a = new Audio(URL.createObjectURL(new Blob([bytes], { type: mime })));
  const v = ((settings.volume || 60) / 100) * (lineVol / 100);
  a.volume = Math.max(0, Math.min(1, v));
  if (v > 1) {
    try {
      studioCtx = studioCtx || new AudioContext();
      const g = studioCtx.createGain();
      studioCtx.createMediaElementSource(a).connect(g).connect(studioCtx.destination);
      a.volume = 1; g.gain.value = Math.min(2, v);
      studioCtx.resume().catch(() => {});
    } catch (_) { /* 放大失敗就用最大聲 */ }
  }
  studioAudio = a;
  a.play().catch(() => {});
}

function vmsg(box, text, err) { const m = box.querySelector('.vmsg'); m.textContent = text || ''; m.classList.toggle('err', !!err); }

function renderVoice() {
  const key = $('v-key').value;
  const arr = (voiceData.lines[key] || []).slice();
  const box = $('v-lines');
  box.textContent = '';
  const have = (i) => voiceData.files.some((f) => new RegExp(`^${key}_${i + 1}\\.(mp3|ogg|wav)$`).test(f));
  const slots = arr.map((l, i) => ({ l, i, isNew: false }));
  if (arr.length < voiceData.max) slots.push({ l: { text: '' }, i: arr.length, isNew: true });
  for (const { l, i, isNew } of slots) {
    const d = document.createElement('div');
    d.className = 'vline';
    d.innerHTML = `<h3>${isNew ? T('＋ 新增一句') : T('第 {0} 句', i + 1)}${!isNew && !have(i) ? T('（還沒有音檔）') : ''}</h3>
      <div class="f"><span>顯示</span><input type="text" class="t-text" placeholder="頭上顯示的字"></div>
      <div class="f"><span>唸</span><input type="text" class="t-say" placeholder="實際唸的字（空白＝跟顯示一樣）"></div>
      <div class="f"><span>句尾</span><span>補 <input type="number" class="t-pad" min="0" max="5" step="1"> 個「……」，再接 <input type="number" class="t-tail" min="0" max="1500" step="50"> 毫秒靜音</span></div>
      <div class="f"><span>音量</span><span><input type="range" class="t-vol" min="20" max="300" step="5"> <b class="t-volv"></b> <button class="b-gain">套用到音檔</button> <button class="b-restore">還原原始音量</button></span></div>
      <p class="hint" style="margin:2px 0 6px">調整到滿意的音量後，請按下「套用到音檔」。</p>
      <div class="f"><span>次數</span><span>連生 <input type="number" class="t-n" min="1" max="5" step="1" value="1"> 次，挑一個最好的</span></div>
      <div class="btns"><button class="b-play">▶ 試聽現有</button><button class="b-gen primary">生成</button></div>
      <div class="takes"></div><p class="vmsg"></p>`;
    translateDom(d);
    d.querySelector('.t-text').value = l.text || '';
    d.querySelector('.t-say').value = l.say || '';
    // 日文、英文預設不補「……」（補了 Breeze 會在句尾多念一段，祐 2026-11-16）
    d.querySelector('.t-pad').value = l.pad == null ? (PetI18n.norm(settings.lang) === PetI18n.DEFAULT ? 1 : 0) : l.pad;
    d.querySelector('.t-tail').value = l.tail || 0;
    const volIn = d.querySelector('.t-vol');
    const volOut = d.querySelector('.t-volv');
    // 滑桿＝相對原檔的音量：套用過就停在套用的值（gain），按「還原原始音量」才回 100%（祐 2026-11-14）
    const applied = Number(l.gain) > 0 ? Number(l.gain) : 100;
    volIn.value = Number(l.vol) > 0 ? Math.round(l.vol * applied / 100) : applied;
    volOut.textContent = `${volIn.value}%`;
    volIn.oninput = () => { volOut.textContent = `${volIn.value}%`; };
    // 直接改音檔音量（祐 2026-11-13）：一律從原檔重算，舊的 vol（播放時放大）一起算進去
    const gainBtn = d.querySelector('.b-gain');
    const restoreBtn = d.querySelector('.b-restore');
    const backedUp = (voiceData.backups || []).includes(`${key}_${i + 1}`);
    if (isNew || !have(i)) { gainBtn.disabled = true; restoreBtn.style.display = 'none'; }
    else if (!backedUp) restoreBtn.style.display = 'none';
    gainBtn.onclick = async () => {
      if (Number(volIn.value) === applied && !(Number(l.vol) > 0)) { vmsg(d, T('音檔已經是 {0}%，不用改', applied)); return; }
      gainBtn.disabled = true;
      vmsg(d, T('改音檔中…'));
      const r = await host.voiceGain({ key, i, percent: Number(volIn.value) });
      gainBtn.disabled = false;
      if (r.error) { vmsg(d, r.error, true); return; }
      voiceData = { ...voiceData, lines: r.lines, files: r.files, backups: r.backups };
      renderVoice();
      const nb = $('v-lines').querySelectorAll('.vline')[i];
      if (nb) vmsg(nb, T('已把音檔改成 {0}%（原檔有備份，可以還原），撫子下次開口就是新的音量', volIn.value));
    };
    restoreBtn.onclick = async () => {
      const r = await host.voiceGain({ key, i, restore: true });
      if (r.error) { vmsg(d, r.error, true); return; }
      voiceData = { ...voiceData, lines: r.lines, files: r.files, backups: r.backups };
      renderVoice();
      const nb = $('v-lines').querySelectorAll('.vline')[i];
      if (nb) vmsg(nb, T('已還原成原本的音檔'));
    };
    const play = d.querySelector('.b-play');
    if (isNew || !have(i)) play.disabled = true;
    play.onclick = async () => {
      const r = await host.voiceRead(key, i);
      // 現有音檔已經是 applied%，試聽時換算回「相對原檔」的滑桿值
      if (r) playBytes(r.bytes, r.mime, Number(volIn.value) * 100 / applied); else vmsg(d, T('這句還沒有音檔'), true);
    };
    const entry = () => ({
      text: d.querySelector('.t-text').value, say: d.querySelector('.t-say').value,
      pad: Number(d.querySelector('.t-pad').value), tail: Number(d.querySelector('.t-tail').value),
      vol: Number(volIn.value),
    });
    const adoptBtn = (label, takeId) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = async () => {
        // 只存文字：音量維持原樣（不碰 vol）；採用新音檔：滑桿不是 100% 就直接把音量做進新音檔
        const e = entry();
        const pct = Number(volIn.value);
        e.vol = takeId ? 100 : (Number(l.vol) > 0 ? l.vol : 100);
        if (!takeId) e.gain = l.gain;
        let r = await host.voiceAdopt({ key, i, entry: e, takeId });
        if (r.error) { vmsg(d, r.error, true); return; }
        if (takeId && pct !== 100) {
          const g = await host.voiceGain({ key, i, percent: pct });
          if (g.error) { vmsg(d, T('已採用，但改音量失敗：{0}', g.error), true); return; }
          r = g;
        }
        voiceData = { ...voiceData, lines: r.lines, files: r.files, backups: r.backups || voiceData.backups };
        renderVoice();
        const nb = $('v-lines').querySelectorAll('.vline')[i];
        if (nb) vmsg(nb, takeId ? T('已採用{0}，撫子下次開口就是新的聲音', pct !== 100 ? T('（音量 {0}%）', pct) : '') : T('已存台詞（音檔沒變）'));
      };
      return b;
    };
    if (!isNew) d.querySelector('.btns').appendChild(adoptBtn(T('只存文字（不換音檔）'), null));
    d.querySelector('.b-gen').onclick = async (ev) => {
      const e = entry();
      if (!e.text.trim() && !e.say.trim()) { vmsg(d, T('請先填要唸的字'), true); return; }
      const btn = ev.currentTarget;
      const n = Math.max(1, Math.min(5, Number(d.querySelector('.t-n').value) || 1));
      btn.disabled = true;
      vmsg(d, T('生成中…（{0} 次，一次只能做一個）', n));
      d.querySelector('.takes').textContent = '';
      const r = await host.voiceGen({ ...e, takes: n });
      btn.disabled = false;
      if (r.error) { vmsg(d, r.error, true); return; }
      vmsg(d, T('唸的是：{0}', r.text));
      r.takes.forEach((t, k) => {
        const row = document.createElement('div');
        row.className = 'take';
        const p = document.createElement('button');
        p.textContent = T('▶ 版本 {0}', k + 1);
        p.onclick = () => playBytes(t.bytes, 'audio/wav', Number(volIn.value));
        const ms = document.createElement('span');
        ms.className = 'ms';
        ms.textContent = t.ms == null ? '' : T('{0} 秒', (t.ms / 1000).toFixed(2));
        row.append(p, ms, adoptBtn(T('採用這個'), t.id));
        d.querySelector('.takes').appendChild(row);
      });
      if (r.takes[0]) playBytes(r.takes[0].bytes, 'audio/wav', Number(volIn.value));
    };
    box.appendChild(d);
  }
}

async function initVoice() {
  voiceData = await host.voiceList();
  const sel = $('v-key');
  for (const k of Object.keys(voiceData.lines)) {
    if (k.startsWith('_')) continue;
    const o = document.createElement('option');
    o.value = k;
    o.textContent = VLABEL[k] ? `${T(VLABEL[k])}（${k}）` : k;
    sel.appendChild(o);
  }
  sel.onchange = renderVoice;
  $('v-url').value = voiceData.url || '';
  $('v-name').value = voiceData.voice || '';
  $('v-url').onchange = () => host.set('voiceUrl', $('v-url').value.trim());
  $('v-name').onchange = () => host.set('voiceName', $('v-name').value.trim());
  renderVoice();
}

function showSnap(snap) {
  $('snap').textContent = JSON.stringify(snap, null, 1);
}

main();
