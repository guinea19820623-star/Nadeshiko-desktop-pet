'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../app/lib/i18n');
const core = require('../app/lib/statecore');
const weather = require('../app/lib/weather');

const APP = path.join(__dirname, '..', 'app');

test('t：查得到就翻譯、查不到照原文、{0} 換成參數', () => {
  assert.strictEqual(i18n.t('en', '結束'), 'Quit');
  assert.strictEqual(i18n.t('ja', '結束'), '終了');
  assert.strictEqual(i18n.t('zh-TW', '結束'), '結束');
  assert.strictEqual(i18n.t('fr', '結束'), '結束');            // 不認識的語言當繁體中文
  assert.strictEqual(i18n.t('en', '還沒翻譯的新句子'), '還沒翻譯的新句子');
  assert.strictEqual(i18n.t('en', '喚醒（{0}）', 'Ctrl+Alt+N'), 'Summon (Ctrl+Alt+N)');
  assert.strictEqual(i18n.t('zh-TW', '喚醒（{0}）', 'Ctrl+Alt+N'), '喚醒（Ctrl+Alt+N）');
  assert.strictEqual(i18n.voiceSub('zh-TW'), '');
  assert.strictEqual(i18n.voiceSub('ja'), 'ja');
});

test('日文、英文字典的句子一樣多（少翻一邊會被抓到），參數也對得上', () => {
  const ja = Object.keys(i18n.DICT.ja).sort();
  const en = Object.keys(i18n.DICT.en).sort();
  assert.deepStrictEqual(ja, en);
  const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join();
  for (const lang of ['ja', 'en']) for (const [k, v] of Object.entries(i18n.DICT[lang])) assert.strictEqual(ph(v), ph(k), `${lang}: ${k}`);
});

test('程式裡 T(\'…\') 用到的句子，字典都有', () => {
  const miss = [];
  for (const rel of ['main.js', 'renderer/pet.js', 'renderer/panel.js', 'renderer/note.js', 'renderer/sky.js', 'lib/statecore.js', 'lib/weather.js']) {
    const src = fs.readFileSync(path.join(APP, rel), 'utf8');
    for (const m of src.matchAll(/\bT\('([^'\r\n]*)'/g)) {
      if (/[一-鿿]/.test(m[1]) && !(m[1] in i18n.DICT.en)) miss.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(miss, []);
});

test('頭上小字、天氣摘要照語言顯示', () => {
  const T = (s, ...a) => i18n.t('en', s, ...a);
  assert.strictEqual(core.bubbleText({ body: 'working', tool: 'Bash', usage: {} }, Date.now(), T), 'Working · Bash');
  assert.strictEqual(core.bubbleText({ body: 'thinking', usage: {} }, Date.now()), '思考中…');
  assert.ok(core.bubbleText({ body: 'thinking', usage: {} }, Date.now(), T).endsWith('…')); // 句尾的「…」要留著，桌寵會換成會動的點點
  assert.strictEqual(weather.summary({ rain: 70, tmin: 18.2, tmax: 25.6 }, T), 'Next 12 hours: rain chance up to 70%, 18–26°C');
  assert.strictEqual(weather.summary({ rain: 70, tmin: 18.2, tmax: 25.6 }), '接下來 12 小時：降雨機率最高 70%，氣溫 18～26°C');
});

test('三種語言的台詞表：狀態一樣、每個狀態句數一樣', () => {
  const load = (sub) => JSON.parse(fs.readFileSync(path.join(APP, 'voice', sub, 'lines.json'), 'utf8'));
  const shape = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.length]));
  const zh = shape(load(''));
  assert.deepStrictEqual(shape(load('ja')), zh);
  assert.deepStrictEqual(shape(load('en')), zh);
});
