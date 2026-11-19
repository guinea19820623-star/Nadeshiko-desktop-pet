'use strict';
const test = require('node:test');
const assert = require('node:assert');
const w = require('../app/lib/weather');

const fc = (rain, temp) => ({ hourly: { precipitation_probability: rain, temperature_2m: temp } });

test('decide：下雨和冷熱可以一起', () => {
  assert.strictEqual(w.decide(fc([10, 70, 20], [20, 22, 21])).kind, 'rainy');
  assert.strictEqual(w.decide(fc([10, 20], [14, 18])).kind, 'chilly');
  assert.strictEqual(w.decide(fc([10, 20], [28, 33])).kind, 'hot');
  assert.strictEqual(w.decide(fc([10, 20], [20, 26])).kind, null);
  // 又冷又下雨：撐傘再圍圍巾；又熱又下雨：撐傘再喝水
  assert.strictEqual(w.decide(fc([80], [10])).kind, 'rainy+chilly');
  assert.deepStrictEqual(w.decide(fc([80], [10])).kinds, ['rainy', 'chilly']);
  assert.strictEqual(w.decide(fc([80], [30, 34])).kind, 'rainy+hot');
  // 祐問的：低溫設 18 度，預報 16～19 度 → 最低 16 ≤ 18，會提醒保暖
  assert.strictEqual(w.decide(fc([0], [16, 19]), { coldAt: 18 }).kind, 'chilly');
  // 門檻可以調
  assert.strictEqual(w.decide(fc([50], [20]), { rainAt: 40 }).kind, 'rainy');
  assert.strictEqual(w.decide(fc([0], [20]), { coldAt: 20 }).kind, 'chilly');
  // 只看前 12 小時
  assert.strictEqual(w.decide(fc([...Array(12).fill(0), 100], Array(13).fill(20))).kind, null);
  // 沒資料
  assert.strictEqual(w.decide({}), null);
  assert.strictEqual(w.decide(fc([null, 30], [null, 20])).rain, 30);
});

test('details：星空框的幾行字', () => {
  const d = w.details(w.decide(fc([80], [10, 14])));
  assert.deepStrictEqual(d.lines, ['降雨機率最高 80%', '氣溫 10～14°C']);
  assert.deepStrictEqual(d.tips, ['記得帶傘', '天冷了，記得保暖']);
  assert.deepStrictEqual(w.details(w.decide(fc([0], [20, 25]))).tips, ['天氣不錯，不用特別準備']);
  assert.deepStrictEqual(w.details(null).lines, ['查不到天氣']);
});

test('parseTimes：容許全形冒號、空白，排序去重', () => {
  assert.deepStrictEqual(w.parseTimes('23:00, 7:00，15：00 7:00 25:00 abc'), ['07:00', '15:00', '23:00']);
  assert.deepStrictEqual(w.parseTimes(''), []);
});

test('dueSlot：到了 30 分鐘內、今天還沒提醒過才算', () => {
  const at = (h, m) => new Date(2026, 10, 15, h, m);
  const times = ['07:00', '15:00'];
  assert.strictEqual(w.dueSlot(times, at(6, 59)), null);
  assert.strictEqual(w.dueSlot(times, at(7, 0)), '07:00');
  assert.strictEqual(w.dueSlot(times, at(7, 30)), '07:00');
  assert.strictEqual(w.dueSlot(times, at(7, 31)), null);
  assert.strictEqual(w.dueSlot(times, at(7, 10), { '07:00': '2026-11-15' }), null);
  assert.strictEqual(w.dueSlot(times, at(7, 10), { '07:00': '2026-11-14' }), '07:00');
  assert.strictEqual(w.dueSlot(times, at(15, 5)), '15:00');
});
