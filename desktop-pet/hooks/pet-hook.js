#!/usr/bin/env node
'use strict';
// Claude Code hook：把事件寫成撫子看得懂的狀態檔。
// 設定在 ~/.claude/settings.json（用 tools/install-claude.js 自動加）。
// 一律 exit 0，所以絕不會擋到 Claude。
// 只有 UserPromptSubmit 時會輸出：桌寵記到使用者半夜還在碰她（深夜勸睡，祐 2026-11-16），
// 或記事板的行程有了結果（完成、變更、待處理，祐 2026-11-17），用 additionalContext 帶進對話，讓 Claude 知道。
// 桌寵自己在背景請 Claude 說一句話時（深夜勸睡的即時回應），那次呼叫不算「Claude 在工作」：
// 桌寵會帶 NADESHIKO_PET_SILENT=1，這裡直接離開，不寫狀態、也不輸出。
if (process.env.NADESHIKO_PET_SILENT) process.exit(0);
const path = require('path');
const bridge = require('../app/lib/bridge');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const m = bridge.applyHookEvent(input);
    if (input.hook_event_name === 'Notification') bridge.noteNotification(input); // 記下見過哪些通知（找用量警告用）
    if (input.hook_event_name === 'UserPromptSubmit') {
      // 深夜小報告＋記事板的結果（完成、變更、待處理，祐 2026-11-17），有就一起帶進對話
      let sched = null;
      try { sched = require('../app/lib/schedule').takeNote(); } catch (_) { /* 記事板壞掉也不影響其他 */ }
      const note = [bridge.takeNightNote(), sched].filter(Boolean).join('\n');
      // 用同步寫入：後面馬上 process.exit，非同步的 stdout 在管線上可能來不及送出
      if (note) require('fs').writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note } }));
    }
    // 撞到額度：對話紀錄那筆「額度用完」可能還沒寫完，晚 1.5 秒再讀一次，補上是哪個額度、幾點恢復
    if (m && m.limit) {
      const file = path.join(bridge.stateDir(), 'limit.json');
      const cur = bridge.readJSON(file);
      if (cur && !cur.kind) {
        setTimeout(() => {
          const q = bridge.readQuota(input.transcript_path);
          const now = bridge.readJSON(file);
          if (q && now && now.ts === cur.ts) bridge.writeJSON(file, Object.assign(now, q));
          process.exit(0);
        }, 1500);
        return;
      }
    }
  } catch (e) {
    if (process.env.NADESHIKO_PET_DEBUG) console.error('[nadeshiko-pet]', e);
  }
  process.exit(0);
});
// 保險：stdin 沒關也在 3 秒後離開
setTimeout(() => process.exit(0), 3000).unref();
