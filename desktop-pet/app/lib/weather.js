'use strict';
// 天氣提醒（祐 2026-11-15）：GitHub 上的使用者不一定住台灣，所以地點讓使用者自己設定城市，
// 用 Open-Meteo（全世界都查得到、不用金鑰，非商業免費，資料來源要註明 Open-Meteo.com）。
// 只送出經緯度；沒設定城市就不查。查不到（斷網、服務掛了）就安靜跳過。

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FC_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS = 12; // 看接下來 12 小時，剛好涵蓋一個班
const GRACE_MIN = 30; // 電腦在提醒時間睡著，醒來 30 分鐘內還會補提醒

async function getJSON(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// 城市名 → 候選地點（名稱、上層行政區、國家、經緯度）
// Open-Meteo 的地名搜尋對短的中日文名字不太靈（「桃園」「臺北市」找不到，「桃園區」「台北市」才找得到），
// 所以中日文名字會換幾種寫法一起查：「臺」「台」互換、後面加 區／市／縣／都
function variants(q) {
  const out = [q];
  if (/[぀-ヿ㐀-鿿]/.test(q)) {
    const base = [q, q.replace(/臺/g, '台'), q.replace(/台/g, '臺')].map((s) => s.replace(/[市區縣都]$/, ''));
    for (const b of base) for (const suf of ['', '區', '市', '縣', '都']) out.push(b + suf);
  }
  return [...new Set(out)];
}

const clean = (s) => (s ? String(s).split(' or ')[0].trim() : s);

async function geocode(name, lang = 'en') {
  const q = String(name || '').trim();
  if (!q) return [];
  // 中日文名字：幾種寫法一起查、合在一起（「台南」只會找到中國的村子，「臺南市」才是台灣的），讓使用者自己選
  const lists = await Promise.all(variants(q).map((v) =>
    getJSON(`${GEO_URL}?name=${encodeURIComponent(v)}&count=6&language=${encodeURIComponent(lang)}&format=json`)
      .then((j) => j.results || []).catch(() => [])));
  const seen = new Set();
  const results = lists.flat().filter((p) => { const k = p.id || `${p.latitude},${p.longitude}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => (y.population || 0) - (x.population || 0)).slice(0, 10);   // 人多的城市排前面
  return results.map((p) => ({
    name: p.name,
    label: [p.name, clean(p.admin1), p.country].filter((s, i, a) => s && a.indexOf(s) === i).join('，'),
    lat: Math.round(p.latitude * 100) / 100, // 只留兩位小數（約 1 公里），夠用也比較不精確地洩漏位置
    lon: Math.round(p.longitude * 100) / 100,
  }));
}

async function forecast(lat, lon) {
  const url = `${FC_URL}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability&forecast_hours=${HOURS}&timezone=auto`;
  return getJSON(url);
}

// 預報 → 要提醒哪一種。先看下雨，沒雨再看溫度（冷、熱）
function decide(fc, th = {}) {
  const h = (fc && fc.hourly) || {};
  const nums = (a) => (Array.isArray(a) ? a.slice(0, HOURS).filter((v) => typeof v === 'number') : []);
  const rain = nums(h.precipitation_probability);
  const temp = nums(h.temperature_2m);
  if (!temp.length && !rain.length) return null;
  const r = { rain: rain.length ? Math.max(...rain) : null, tmin: temp.length ? Math.min(...temp) : null, tmax: temp.length ? Math.max(...temp) : null, kind: null };
  const rainAt = th.rainAt ?? 60, coldAt = th.coldAt ?? 15, hotAt = th.hotAt ?? 32;
  if (r.rain != null && r.rain >= rainAt) r.kind = 'rainy';
  else if (r.tmin != null && r.tmin <= coldAt) r.kind = 'chilly';
  else if (r.tmax != null && r.tmax >= hotAt) r.kind = 'hot';
  return r;
}

function summary(r) {
  if (!r) return '查不到天氣';
  const parts = [];
  if (r.rain != null) parts.push(`降雨機率最高 ${r.rain}%`);
  if (r.tmin != null) parts.push(`氣溫 ${Math.round(r.tmin)}～${Math.round(r.tmax)}°C`);
  return `接下來 ${HOURS} 小時：${parts.join('，')}`;
}

// "07:00, 15:00,23:00" → ['07:00','15:00','23:00']（不合法的丟掉、排序、去重）
function parseTimes(s) {
  const out = [];
  for (const m of String(s || '').matchAll(/(\d{1,2})\s*[:：]\s*(\d{2})/g)) {
    const hh = Number(m[1]), mm = Number(m[2]);
    if (hh < 24 && mm < 60) out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 現在該提醒的時段（到了、還在 30 分鐘內、今天還沒提醒過），沒有就回傳 null
function dueSlot(times, now, fired = {}) {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const t of times) {
    const [hh, mm] = t.split(':').map(Number);
    const d = mins - (hh * 60 + mm);
    if (d >= 0 && d <= GRACE_MIN && fired[t] !== dayKey(now)) return t;
  }
  return null;
}

module.exports = { variants, geocode, forecast, decide, summary, parseTimes, dueSlot, dayKey, HOURS };
