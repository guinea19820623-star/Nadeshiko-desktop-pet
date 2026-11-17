'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nadeshiko-sched-'));
process.env.NADESHIKO_PET_DIR = path.join(tmp, 'state');
const schedule = require('../app/lib/schedule');
const ROOT = path.resolve(__dirname, '..');
const env = { ...process.env, NADESHIKO_PET_DIR: process.env.NADESHIKO_PET_DIR };

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('時間、日期、星期的格式', () => {
  assert.strictEqual(schedule.normTime('9:05'), '09:05');
  assert.strictEqual(schedule.normTime('15：00'), '15:00');
  assert.strictEqual(schedule.normTime('24:00'), null);
  assert.strictEqual(schedule.normDate('2026-11-8'), '2026-11-08');
  assert.strictEqual(schedule.normDate('2026-02-30'), null);
  assert.deepStrictEqual(schedule.parseDays('1-5'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(schedule.parseDays('平日'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(schedule.parseDays('6,0'), [0, 6]);
  assert.deepStrictEqual(schedule.parseDays('每天'), []);
  assert.throws(() => schedule.parseDays('星期八'));
});

test('哪天有哪些行程、什麼時候該提醒', () => {
  const data = { items: [], log: {}, reported: 0 };
  const a = schedule.addItem(data, { time: '15:00', text: '出門上班', days: [1, 2, 3, 4, 5] });
  const b = schedule.addItem(data, { time: '09:00', text: '倒垃圾' });
  const c = schedule.addItem(data, { time: '20:00', text: '看牙醫', date: '2026-11-18' });
  const tue = new Date(2026, 10, 17, 15, 10); // 週二
  assert.deepStrictEqual(schedule.itemsFor(data, tue).map((x) => x.id), [b.id, a.id]);
  assert.deepStrictEqual(schedule.itemsFor(data, new Date(2026, 10, 18)).map((x) => x.id), [b.id, a.id, c.id]);
  assert.deepStrictEqual(schedule.itemsFor(data, new Date(2026, 10, 22)).map((x) => x.id), [b.id]); // 週日
  // 15:10 → 15:00 那筆該提醒（30 分鐘內），09:00 那筆太久了不補
  assert.deepStrictEqual(schedule.dueItems(data, tue).map((x) => x.id), [a.id]);
  assert.deepStrictEqual(schedule.dueItems(data, new Date(2026, 10, 17, 14, 59)), []);
  assert.deepStrictEqual(schedule.dueItems(data, new Date(2026, 10, 17, 15, 31)), []);
  schedule.markFired(data, [a.id], tue);
  assert.deepStrictEqual(schedule.dueItems(data, tue), []);           // 同一天只提醒一次
  assert.deepStrictEqual(schedule.dueItems(data, new Date(2026, 10, 18, 15, 0)).map((x) => x.id), [a.id]); // 隔天照常
  assert.throws(() => schedule.addItem(data, { time: '25:00', text: 'x' }));
  assert.throws(() => schedule.addItem(data, { time: '10:00', text: '  ' }));
});

test('完成、變更、復原，寫過的筆跡', () => {
  const data = { items: [], log: {}, reported: 0 };
  const a = schedule.addItem(data, { time: '15:00', text: '出門上班' });
  const day = new Date(2026, 10, 17);
  schedule.setStatus(data, day, a.id, 'changed', '身體不適請假', 1000);
  assert.deepStrictEqual(schedule.itemsFor(data, day)[0], { ...a, s: 'changed', at: 1000, reason: '身體不適請假' });
  schedule.setStatus(data, day, a.id, 'done', 'x', 2000);
  assert.strictEqual(schedule.itemsFor(data, day)[0].reason, undefined);
  schedule.setStatus(data, day, a.id, null);
  assert.strictEqual(schedule.itemsFor(data, day)[0].s, undefined);
  assert.deepStrictEqual(schedule.unwritten(data).map((x) => x.id), [a.id]);
  schedule.markWritten(data, [a.id]);
  assert.deepStrictEqual(schedule.unwritten(data), []);
  const u = schedule.updateItem(data, a.id, { time: '16:00', text: '出門上班（中班）', date: '2026-11-18' });
  assert.deepStrictEqual(u, { id: a.id, time: '16:00', text: '出門上班（中班）', date: '2026-11-18' });
  assert.deepStrictEqual(schedule.unwritten(data).map((x) => x.id), [a.id]); // 改過要重寫
  assert.throws(() => schedule.updateItem(data, 'nope', { time: '10:00', text: 'x' }));
  assert.throws(() => schedule.updateItem(data, a.id, { time: '99:00', text: 'x' }));
  assert.ok(schedule.removeItem(data, a.id));
  assert.ok(!schedule.removeItem(data, a.id));
});

test('代筆工具與給 Claude 的回報', () => {
  const run = (...a) => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'schedule.js'), ...a], { env, encoding: 'utf8' });
  const out = run('add', '15:00', '出門上班', '--days', '1-5');
  const id = /已寫上：(\w+)/.exec(out)[1];
  assert.match(run('list'), new RegExp(`${id}  15:00  出門上班  〔每週一、二、三、四、五〕`));
  assert.match(run('add', '21:00', '繳電費', '--today'), /已寫上/);
  assert.match(run('today'), /繳電費/);
  assert.strictEqual(schedule.takeNote(), null); // 還沒有結果
  const data = schedule.load();
  const now = Date.now();
  schedule.setStatus(data, new Date(now), id, 'changed', '身體不適', now);
  schedule.save(data);
  const note = schedule.takeNote(now + 1000);
  assert.match(note, /【桌寵記事板】.*15:00 出門上班：變更（\d\d:\d\d），原因：身體不適/);
  assert.strictEqual(schedule.takeNote(now + 2000), null); // 只說一次
  assert.match(run('remove', id), /已劃掉/);
  assert.throws(() => run('remove', 'zzzz'));
});
