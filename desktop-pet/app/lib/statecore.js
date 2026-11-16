// 狀態機核心：把「Claude 工作階段 + 用量 + 上限」算成桌寵現在該是什麼樣子。
// 純函式，瀏覽器與 Node 都能用（測試在 test/statecore.test.js）。
(function (root) {
  'use strict';

  const DEFAULTS = {
    tiredAt: 85,        // 5 小時或 7 天任一用量 ≥ 這個值 → 疲憊
    faintAt: 100,       // 7 天用量 ≥ 這個值 → 暈倒
    napAt: 100,         // 5 小時用量 ≥ 這個值 → 睡覺（等 5 小時額度恢復）
    staleWorkMs: 10 * 60 * 1000,   // 思考/工作超過這麼久沒新事件，視為中斷
    doneShowMs: 6000,              // 「完成」顯示多久
    helloShowMs: 4000,
    errorShowMs: 5000,
    waitingMaxMs: 30 * 60 * 1000,
    limitFallbackMs: 60 * 60 * 1000, // 撞上限但不知道何時恢復時，先算一小時
  };

  // 活動優先序：越前面越重要（多個 Claude Code 視窗同時開時取最高）
  const ACTIVITY_ORDER = ['compacting', 'working', 'thinking', 'waiting', 'done', 'error', 'hello', 'idle'];

  function freshActivity(s, now, o) {
    const age = now - (s.ts || 0);
    switch (s.activity) {
      case 'compacting':
      case 'working':
      case 'thinking':
        return age < o.staleWorkMs ? s.activity : 'idle';
      case 'done':
        return age < o.doneShowMs ? 'done' : 'idle';
      case 'hello':
        return age < o.helloShowMs ? 'hello' : 'idle';
      case 'error':
        return age < o.errorShowMs ? 'error' : 'idle';
      case 'waiting':
        return age < o.waitingMaxMs ? 'waiting' : 'idle';
      default:
        return 'idle';
    }
  }

  function windowPct(w, nowSec) {
    if (!w || typeof w.used_percentage !== 'number') return null;
    // 過了重置時間，這個視窗的數字就作廢
    if (w.resets_at && w.resets_at <= nowSec) return null;
    return w.used_percentage;
  }

  function resolve(snapshot, now, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const nowSec = now / 1000;
    const snap = snapshot || {};

    // 1. 活動
    let activity = 'idle';
    let tool = null;
    for (const s of snap.sessions || []) {
      const a = freshActivity(s, now, o);
      if (ACTIVITY_ORDER.indexOf(a) < ACTIVITY_ORDER.indexOf(activity)) {
        activity = a;
        tool = s.tool || null;
      }
    }

    // 2. 用量
    const u = snap.usage || {};
    const five = windowPct(u.five_hour, nowSec);
    const week = windowPct(u.seven_day, nowSec);
    const usage = {
      five, week,
      fiveResets: five != null && u.five_hour ? u.five_hour.resets_at : null,
      weekResets: week != null && u.seven_day ? u.seven_day.resets_at : null,
    };

    // 3. 上限：StopFailure(rate_limit) 寫入的旗標，搭配用量判斷是哪一個視窗
    let limitKind = null; // 'week' | 'five'
    let limitUntil = null;
    const lim = snap.limit;
    if (lim && lim.hit && lim.kind) {
      // hook 從對話紀錄讀到的確切資訊（祐 2026-11-14）：撞到哪一個額度、幾點恢復
      limitKind = lim.kind; limitUntil = lim.resetsAt || null;
      const expire = limitUntil ? limitUntil * 1000 : (lim.ts || 0) + o.limitFallbackMs;
      if (now >= expire) limitKind = null;
    } else if (lim && lim.hit) {
      if (week != null && week >= o.faintAt - 5) {
        limitKind = 'week'; limitUntil = usage.weekResets;
      } else if (five != null && five >= o.napAt - 5) {
        limitKind = 'five'; limitUntil = usage.fiveResets;
      } else if (week != null && five != null && week > five) {
        limitKind = 'week'; limitUntil = usage.weekResets;
      } else {
        limitKind = 'five'; limitUntil = usage.fiveResets;
      }
      const expire = limitUntil ? limitUntil * 1000 : (lim.ts || 0) + o.limitFallbackMs;
      if (now >= expire) limitKind = null;
    }

    // 4. 身體狀態：暈倒 > 睡覺(5h 用完) > 疲憊 > 工作中 > 思考 > 其餘
    let body;
    if ((week != null && week >= o.faintAt) || limitKind === 'week') {
      body = 'faint';
    } else if ((five != null && five >= o.napAt) || limitKind === 'five') {
      body = 'exhausted';
    } else if ((five != null && five >= o.tiredAt) || (week != null && week >= o.tiredAt)) {
      body = 'tired';
    } else if (activity !== 'idle') {
      body = activity;
    } else {
      body = 'free'; // 交給隨機行為
    }

    return { body, activity, tool, usage, limitKind, limitUntil: limitKind ? limitUntil : null };
  }

  // T：翻譯函式（照介面語言查字典，見 i18n.js）；沒傳就是繁體中文原文
  const plain = (s, ...a) => String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] == null ? '' : String(a[i])));

  function fmtReset(sec, now, T = plain) {
    if (!sec) return '';
    const d = new Date(sec * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const sameDay = new Date(now).toDateString() === d.toDateString();
    if (sameDay) return `${hh}:${mm}`;
    const wd = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][d.getDay()];
    return `${T(wd)} ${hh}:${mm}`;
  }

  // 頭上小字
  function bubbleText(r, now, T = plain) {
    switch (r.body) {
      case 'faint':
        { const at = (r.limitKind === 'week' && r.limitUntil) || r.usage.weekResets; return at ? T('週額度見底…{0} 復活', fmtReset(at, now, T)) : T('週額度見底了…'); }
      case 'exhausted':
        { const at = (r.limitKind === 'five' && r.limitUntil) || r.usage.fiveResets; return at ? T('休息一下，{0} 再戰', fmtReset(at, now, T)) : T('額度用完，休息中…'); }
      case 'tired': {
        // 祐 2026-11-14：只說「有點累了…」，提醒注意用量就好（數字看 Claude 的用量圈圈）
        return T('有點累了…');
      }
      case 'working':
        return r.tool ? T('工作中 · {0}', r.tool) : T('工作中…');
      case 'thinking':
        return T('思考中…');
      case 'compacting':
        return T('整理記憶中…');
      case 'waiting':
        return T('需要你確認一下～');
      case 'done':
        return T('完成了！');
      case 'error':
        return T('咦？出錯了…');
      case 'hello':
        return T('嗨～我在這');
      default:
        return '';
    }
  }

  // 深夜勸睡（祐 2026-11-16）：現在是不是在「該睡了」的時段裡。from／to 是「HH:MM」，可以跨過午夜（例如 01:00～05:00、23:30～04:00）
  function inNight(date, from, to) {
    const m = (s) => { const r = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return r ? Number(r[1]) * 60 + Number(r[2]) : null; };
    const a = m(from), b = m(to);
    if (a == null || b == null || a === b) return false;
    const x = date.getHours() * 60 + date.getMinutes();
    return a < b ? x >= a && x < b : x >= a || x < b;
  }

  // 視窗版面：左右各留一段透明邊，讓頭上的泡泡有地方跟著頭移動、靠邊時往內閃
  // 視窗上方留給頭上小字的高度。2026-11-15 祐：視窗稍微加高——舉高的蕾絲傘這類動作會往上畫進這條空間（最多 100 單位，660 畫布），
  // 所以至少 60px，大尺寸時跟著放大（size×0.17 ≈ 112 單位）
  const BUBBLE_H = 60;
  function layout(size) {
    const padX = Math.max(40, Math.round(size * 0.25));
    const bubbleH = Math.max(BUBBLE_H, Math.round(size * 0.17));
    return { padX, bubbleH, width: size + padX * 2, height: size + bubbleH };
  }

  const api = { DEFAULTS, resolve, bubbleText, fmtReset, layout, inNight };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetCore = api;
})(typeof self !== 'undefined' ? self : this);
