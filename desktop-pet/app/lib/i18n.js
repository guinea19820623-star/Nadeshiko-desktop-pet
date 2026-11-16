// 介面語言（祐 2026-11-16）：GitHub 上的使用者來自世界各地，所以選單、控制面板、頭上小字可以切換
// 繁體中文（預設）／日本語／English。語音也照語言分資料夾（app/voice、app/voice/ja、app/voice/en）。
//
// 做法：程式裡照舊寫繁體中文，用 t(語言, '中文原文', 參數…) 查字典；字典裡沒有的就照原文顯示，
// 所以新加的功能忘了翻譯也不會壞，只是那一句還是中文。原文裡的 {0}、{1} 會換成參數。
// 字典在 i18n-ja.js、i18n-en.js（key 就是中文原文）。純函式，瀏覽器與 Node 都能用（測試在 test/i18n.test.js）。
(function (root) {
  'use strict';

  const LANGS = [['zh-TW', '繁體中文'], ['ja', '日本語'], ['en', 'English']];
  const DEFAULT = 'zh-TW';
  const DICT = (typeof module === 'object' && module.exports)
    ? { ja: require('./i18n-ja'), en: require('./i18n-en') }
    : (root.PetI18nDict || {});

  const norm = (lang) => (LANGS.some(([k]) => k === lang) ? lang : DEFAULT);

  function fill(s, args) {
    return String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? '' : String(args[i])));
  }

  function t(lang, s, ...args) {
    const d = DICT[norm(lang)];
    const out = d && Object.prototype.hasOwnProperty.call(d, s) ? d[s] : s;
    return args.length ? fill(out, args) : out;
  }

  // 語音資料夾的子路徑：繁體中文在 voice/ 本身，其他語言在 voice/<語言>/
  const voiceSub = (lang) => (norm(lang) === DEFAULT ? '' : norm(lang));

  const api = { LANGS, DEFAULT, DICT, norm, t, fill, voiceSub };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetI18n = api;
})(typeof self !== 'undefined' ? self : this);
