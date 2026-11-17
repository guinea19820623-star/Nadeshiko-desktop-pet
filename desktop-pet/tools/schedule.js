#!/usr/bin/env node
'use strict';
// 記事板代筆（祐 2026-11-17）：撫子（Claude）幫主人寫行程，桌寵到時間自己提醒（不花用量）。
//   node tools/schedule.js list                          # 全部行程（含編號）
//   node tools/schedule.js today                         # 今天的行程和狀態
//   node tools/schedule.js add 15:00 出門上班             # 每天
//   node tools/schedule.js add 15:00 出門上班 --days 1-5  # 每週一到五（0＝週日；也可以寫 平日、週末、1,3,5）
//   node tools/schedule.js add 10:30 看牙醫 --date 2026-11-20   # 只有那天
//   node tools/schedule.js add 21:00 繳電費 --today       # 只有今天
//   node tools/schedule.js remove <編號>
//   node tools/schedule.js show                          # 叫桌寵現在打開記事板
// 加了新的行程，桌寵開著的話會馬上打開信紙、拿羽毛筆寫上去。
const schedule = require('../app/lib/schedule');
const bridge = require('../app/lib/bridge');

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v != null && !v.startsWith('--') ? 2 : 1); return v != null && !v.startsWith('--') ? v : true; };
const when = (x) => (x.date ? x.date : x.days && x.days.length ? `每週${x.days.map((d) => WD[d]).join('、')}` : '每天');
const STATUS = { done: '完成', changed: '變更', pending: '待處理' };

try {
  const date = opt('--date');
  const days = opt('--days');
  const today = opt('--today');
  const [cmd, ...rest] = args;
  const data = schedule.load();
  if (cmd === 'list' || !cmd) {
    if (!data.items.length) console.log('（還沒有行程）');
    for (const x of [...data.items].sort((a, b) => a.time.localeCompare(b.time))) console.log(`${x.id}  ${x.time}  ${x.text}  〔${when(x)}〕`);
  } else if (cmd === 'today') {
    const list = schedule.itemsFor(data, new Date());
    if (!list.length) console.log('（今天沒有行程）');
    for (const x of list) console.log(`${x.id}  ${x.time}  ${x.text}${x.s ? `  → ${STATUS[x.s]}${x.reason ? `：${x.reason}` : ''}` : ''}`);
  } else if (cmd === 'add') {
    const [time, ...words] = rest;
    const o = { time, text: words.join(' ') };
    if (today) o.date = schedule.dayKey(new Date());
    else if (typeof date === 'string') o.date = date;
    if (typeof days === 'string') o.days = schedule.parseDays(days);
    const item = schedule.addItem(data, o);
    schedule.save(data);
    console.log(`已寫上：${item.id}  ${item.time}  ${item.text}  〔${when(item)}〕`);
  } else if (cmd === 'remove' || cmd === 'rm') {
    if (!schedule.removeItem(data, rest[0])) throw new Error(`找不到編號 ${rest[0]}（用 list 看編號）`);
    schedule.save(data);
    console.log(`已劃掉：${rest[0]}`);
  } else if (cmd === 'show') {
    bridge.requestAction('note');
    console.log('已請桌寵打開記事板');
  } else {
    throw new Error(`不認識的指令：${cmd}（list、today、add、remove、show）`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
