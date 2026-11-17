'use strict';
// 記事板（祐 2026-11-17）：桌寵自己當鬧鐘（不靠 Claude，不花用量），撫子（Claude）用 tools/schedule.js 代筆寫行程。
// 純 Node，不依賴 Electron：主程序、hook、代筆工具、測試都用這一份。
//
// schedule.json（在狀態資料夾，預設 ~/.nadeshiko-pet）：
// {
//   items: [{ id, time: 'HH:MM', text, date?: 'YYYY-MM-DD'（只有那天）, days?: [0..6]（每週哪幾天，0＝週日；省略＝每天）, w?: 1（筆已經寫過） }],
//   log: { 'YYYY-MM-DD': { <id>: { f?: 1（那天已經提醒過）, s?: 'done'|'changed'|'pending', at?: 毫秒, reason? } } },
//   reported: 毫秒（告訴 Claude 到哪個時間點）
// }
const path = require('path');
const bridge = require('./bridge');

const GRACE_MIN = 30;   // 電腦在提醒時間睡著，醒來 30 分鐘內還會補提醒（跟天氣一樣）
const KEEP_DAYS = 14;   // 紀錄留兩週
const MAX_TEXT = 40;

const file = () => path.join(bridge.stateDir(), 'schedule.json');
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function normTime(s) {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(String(s || ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${pad2(Number(m[1]))}:${m[2]}`;
}
function normDate(s) {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? dayKey(d) : null;
}

function load() {
  const d = bridge.readJSON(file()) || {};
  return {
    items: Array.isArray(d.items) ? d.items.filter((x) => x && x.id && normTime(x.time) && x.text) : [],
    log: d.log && typeof d.log === 'object' ? d.log : {},
    reported: Number(d.reported) || 0,
  };
}

// 存之前把太舊的紀錄、已經過了的單日行程清掉
function save(data, now = new Date()) {
  const cut = new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DAYS);
  const log = {};
  for (const [k, v] of Object.entries(data.log || {})) if (k >= dayKey(cut)) log[k] = v;
  const items = (data.items || []).filter((x) => !x.date || x.date >= dayKey(cut));
  bridge.writeJSON(file(), { items, log, reported: data.reported || 0 });
}

const appliesOn = (item, date) => (item.date ? item.date === dayKey(date) : !Array.isArray(item.days) || !item.days.length || item.days.includes(date.getDay()));

// 某一天的行程（照時間排）＋那天的狀態
function itemsFor(data, date) {
  const log = data.log[dayKey(date)] || {};
  return data.items.filter((x) => appliesOn(x, date)).sort((a, b) => a.time.localeCompare(b.time))
    .map((x) => ({ ...x, ...(log[x.id] ? { s: log[x.id].s, at: log[x.id].at, reason: log[x.id].reason } : {}) }));
}

// 現在該提醒的行程：今天的、時間到了而且還在 30 分鐘內、今天還沒提醒過
function dueItems(data, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const log = data.log[dayKey(now)] || {};
  return itemsFor(data, now).filter((x) => {
    const [h, m] = x.time.split(':').map(Number);
    const d = mins - (h * 60 + m);
    return d >= 0 && d <= GRACE_MIN && !(log[x.id] && log[x.id].f);
  });
}

function entry(data, date, id) {
  const k = typeof date === 'string' ? date : dayKey(date);
  data.log[k] = data.log[k] || {};
  data.log[k][id] = data.log[k][id] || {};
  return data.log[k][id];
}

const markFired = (data, ids, now = new Date()) => { for (const id of ids) entry(data, now, id).f = 1; };

// 完成／變更／待處理／復原（status 給 null）
function setStatus(data, date, id, status, reason, now = Date.now()) {
  const e = entry(data, date, id);
  if (!status) { delete e.s; delete e.at; delete e.reason; return e; }
  e.s = status;
  e.at = now;
  if (status === 'changed') e.reason = String(reason || '').trim().slice(0, MAX_TEXT); else delete e.reason;
  return e;
}

// 筆還沒寫過的行程（撫子剛代筆加的）
const unwritten = (data) => data.items.filter((x) => !x.w);
const markWritten = (data, ids) => { for (const x of data.items) if (ids.includes(x.id)) x.w = 1; };

function newId(data) {
  let id;
  do id = Math.random().toString(36).slice(2, 6); while (data.items.some((x) => x.id === id));
  return id;
}

// 代筆：加一筆。o：{ time, text, date?, days? }
function addItem(data, o) {
  const time = normTime(o.time);
  if (!time) throw new Error(`時間格式要像 15:00：${o.time}`);
  const text = String(o.text || '').trim().slice(0, MAX_TEXT);
  if (!text) throw new Error('事項不能是空的');
  const item = { id: newId(data), time, text };
  if (o.date) { const d = normDate(o.date); if (!d) throw new Error(`日期格式要像 2026-11-18：${o.date}`); item.date = d; }
  if (o.days && o.days.length) item.days = [...new Set(o.days.map(Number))].filter((n) => n >= 0 && n <= 6).sort();
  data.items.push(item);
  return item;
}

// 修改一筆：照 addItem 的規則檢查；改完算「還沒寫過」，桌寵會打開信紙重寫那一行
function updateItem(data, id, o) {
  const i = data.items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`找不到編號 ${id}`);
  const item = addItem({ items: [], log: {} }, o);
  item.id = id;
  data.items[i] = item;
  return item;
}

function removeItem(data, id) {
  const n = data.items.length;
  data.items = data.items.filter((x) => x.id !== id);
  return data.items.length < n;
}

// "1-5"、"1,3,5"、"平日"、"週末"、"每天" → [0..6]
function parseDays(s) {
  const t = String(s || '').trim();
  if (!t || /^(每天|daily|all)$/i.test(t)) return [];
  if (/^(平日|weekdays?)$/i.test(t)) return [1, 2, 3, 4, 5];
  if (/^(週末|假日|weekends?)$/i.test(t)) return [0, 6];
  const out = [];
  for (const part of t.split(/[,，\s]+/)) {
    const r = /^(\d)-(\d)$/.exec(part);
    if (r) { for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(i % 7); } else if (/^\d$/.test(part)) out.push(Number(part) % 7);
    else throw new Error(`看不懂的星期：${part}（用 0–6，0＝週日，例如 1-5）`);
  }
  return [...new Set(out)].sort();
}

const STATUS = { done: '完成', changed: '變更', pending: '待處理（沒有回應）' };

// 還沒告訴過 Claude、24 小時內有結果的行程 → 一段給 Claude 看的說明（同時記成已告訴）；沒有就回傳 null
function takeNote(now = Date.now()) {
  const data = load();
  const lines = [];
  let latest = data.reported;
  for (const [day, ids] of Object.entries(data.log)) {
    for (const [id, e] of Object.entries(ids)) {
      if (!e.s || !(e.at > data.reported) || now - e.at > 24 * 3600 * 1000) continue;
      const item = data.items.find((x) => x.id === id);
      const [, m, d] = day.split('-').map(Number);
      lines.push({ at: e.at, text: `${m}/${d} ${item ? `${item.time} ${item.text}` : `（已刪除的行程 ${id}）`}：${STATUS[e.s] || e.s}${e.s === 'pending' ? '' : `（${hhmm(e.at)}）`}${e.reason ? `，原因：${e.reason}` : ''}` });
      latest = Math.max(latest, e.at);
    }
  }
  if (!lines.length) return null;
  data.reported = latest;
  save(data, new Date(now));
  return '【桌寵記事板】使用者處理了排定的行程：' + lines.sort((a, b) => a.at - b.at).map((x) => x.text).join('；') + '。'
    + '這是桌寵自動記下的。可以自然地接一句（例如完成了就輕輕說辛苦了，變更了就關心一下原因），不用每項都講，也不用說教。';
}

module.exports = {
  GRACE_MIN, file, dayKey, normTime, normDate, load, save, itemsFor, dueItems, markFired, setStatus,
  unwritten, markWritten, addItem, updateItem, removeItem, parseDays, takeNote,
};
