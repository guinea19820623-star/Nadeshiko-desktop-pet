'use strict';
// 撫子桌寵：Electron 主程序
// 負責：透明視窗、點擊穿透切換、拖曳、右鍵選單、設定保存、輪詢 Claude 狀態檔。
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, Menu, Tray, screen, shell, nativeImage, powerMonitor, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const bridge = require('./lib/bridge');
const { layout } = require('./lib/statecore');
const weather = require('./lib/weather');
const i18n = require('./lib/i18n');
const schedule = require('./lib/schedule');

const BUBBLE_H = layout(250).bubbleH; // 視窗上方留給頭上小字的高度
const SIZE_MIN = 100;
const SIZE_MAX = 640;

const DEFAULT_SETTINGS = {
  size: 250,
  x: null,
  y: null,
  walk: true,
  fly: true,
  random: true,      // 由 actMode 決定（不是「撫子控制」就隨機），畫面端看這個
  actMode: 'mixed',  // 動作控制方式（祐 2026-11-08）：random 隨機／claude 撫子控制／mixed 混合
  bubble: true,
  voice: true,
  perch: true,
  volume: 60,
  bubbleScale: 100,
  alwaysOnTop: true,
  hotkey: 'CommandOrControl+Alt+N',
  tiredAt: 85,
  faintAt: 100,
  napAt: 100,
  voiceUrl: 'http://127.0.0.1:8080', // 語音工作室用的 Breeze-TTS 位置與聲音
  voiceName: 'agent_girl',
  birthday: '01-01', // 主人的生日「MM-DD」（控制面板選，預設 1 月 1 日）
  petBirthday: '03-30', // 撫子的生日「MM-DD」（祐 2026-11-14：她 3/30 醒來；其他人可以改成與桌寵見面的日子）
  petBirthdayOn: true,
  birthdayOn: false, // 打勾才啟用：生日那天開機、喚醒時撫子捧生日蛋糕出來（預設不開，免得每個人 1 月 1 日都收到蛋糕）
  // 天氣提醒（2026-11-15）：設定城市後，在提醒時間查接下來 12 小時，下雨帶傘、天冷保暖／天熱喝水（下雨和冷熱可以一起，2026-11-19）
  // 結果寫在星空天氣框裡（2026-11-19）；右鍵選單「天氣提醒」隨時查一次
  weatherOn: false,
  weatherPlace: null,      // { label, lat, lon }：控制面板搜尋城市後選的
  weatherTimes: '07:30',   // 可以填好幾個，例如「07:00, 15:00, 23:00」（出門前一小時）
  rainAt: 60,              // 降雨機率 ≥ 這個 % 就提醒帶傘
  coldAt: 15,              // 最低溫 ≤ 這個 °C 提醒保暖
  hotAt: 32,               // 最高溫 ≥ 這個 °C 提醒喝水
  weatherFired: {},        // 每個時段今天提醒過了沒（重開不會再提醒一次）
  weatherLast: null,       // 最近一次查詢的結果，控制面板顯示
  skyWidth: 380,           // 星空天氣框的寬度（px）
  // 深夜勸睡（祐 2026-11-16）：這個時段裡碰到她（滑鼠滑過、點、摸頭、拎起來），她會打哈欠勸你去睡；
  // nightTell 打勾的話，也記下來，下次跟 Claude 說話時帶進對話
  nightOn: true,
  nightFrom: '01:00',
  nightTo: '05:00',
  nightTell: true,
  lang: 'zh-TW',           // 介面與語音的語言：zh-TW／ja／en（祐 2026-11-16）
  // 記事板（祐 2026-11-17）：行程到時間打開信紙；放著幾分鐘沒處理標「待處理」；信紙寬度（px）
  noteOn: true,
  notePendingMin: 10,
  noteWidth: 320,
};

let settings = { ...DEFAULT_SETTINGS };
// 介面文字：程式裡寫繁體中文，照設定的語言查字典（app/lib/i18n.js）
const T = (str, ...args) => i18n.t(settings.lang, str, ...args);
let pet = null;
let panel = null;
let tray = null;
let forced = null;      // 測試用：強制顯示的狀態
let dragTimer = null;
let lastSnapshotJSON = '';
let saveTimer = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const ACT_MODES = [['random', '隨機'], ['claude', '撫子控制'], ['mixed', '混合（隨機＋撫子控制）']];

function loadSettings() {
  const s = bridge.readJSON(settingsFile());
  if (s) settings = { ...DEFAULT_SETTINGS, ...s };
  // 舊設定只有「隨機動作」勾選框：關掉的當作撫子控制，開著的當作混合
  if (!s || !ACT_MODES.some(([k]) => k === s.actMode)) settings.actMode = s && s.random === false ? 'claude' : 'mixed';
  settings.random = settings.actMode !== 'claude';
  settings.size = clampSize(settings.size);
  if (!/^\d{2}-\d{2}$/.test(settings.birthday || '')) { settings.birthday = '01-01'; settings.birthdayOn = false; } // 舊版存的空白＝沒設定
  settings.bubbleScale = Math.max(70, Math.min(220, Math.round(Number(settings.bubbleScale) || 100)));
}

function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { bridge.writeJSON(settingsFile(), settings); } catch (e) { console.error(e); }
  }, 400);
}

function clampSize(v) {
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(v) || DEFAULT_SETTINGS.size)));
}

function winSize(size = settings.size) {
  const l = layout(size);
  return { width: l.width, height: l.height };
}

// 一律帶著固定寬高設定位置：Windows 在 125%/150% 縮放下，
// 對不可縮放的透明視窗反覆 setPosition 會讓視窗尺寸漂移，泡泡就跟角色對不上
function placePet(x, y) {
  if (!pet) return;
  const { width, height } = winSize();
  pet.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function displayFor(bounds) {
  return screen.getDisplayMatching(bounds);
}

function createPet() {
  const { width, height } = winSize();
  const primary = screen.getPrimaryDisplay().workArea;
  let x = settings.x;
  let y = settings.y;
  // 記住的是視窗左上角；視窗高度變了（2026-11-15 頭上空間 52 → 至少 60）就照舊高度換算，腳底才會在同一個地方
  const savedH = settings.winH || settings.size + 52;
  if (y != null && savedH !== height) y += savedH - height;
  // 記住的位置不在任何螢幕內（例如拔掉外接螢幕）就回到主螢幕右下
  const visible = x != null && screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return x + width / 2 >= w.x && x + width / 2 <= w.x + w.width && y + height / 2 >= w.y && y <= w.y + w.height;
  });
  if (!visible) {
    x = primary.x + primary.width - width - 40;
    y = primary.y + primary.height - height;
  }

  pet = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  applyOnTop();
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  pet.on('closed', () => { pet = null; app.quit(); });
  pet.on('move', followSky); // 星空天氣框跟著她
}

// 放天燈（祐 2026-11-12）：從撫子手上飄走的天燈是獨立的透明小視窗，滑鼠穿透。
// 火焰會動（lantern.html 播 13 格火光），往上飄（越飄越快一點、左右輕晃），天燈頂端飄到螢幕上方 18% 時化成金色光點消散。
// 兩段式：動作一開始先把視窗開好藏著（go:false），影片第 26 格才顯示、開始飄（go:true），跟影片裡的天燈重疊接上，不會慢半拍。
// 視窗是天燈的 2.2 倍寬、2 倍高（左右各留 0.6、上方 0.7、下方 0.3），給光暈和往上飄的光點空間。
let lanternPending = null;
function lanternWindow(o) {
  const W = Math.max(16, Math.round(o.w * 2.2)), H = Math.max(16, Math.round(o.h * 2.0));
  const win = new BrowserWindow({
    x: Math.round(o.x - o.w * 0.6), y: Math.round(o.y - o.h * 0.7), width: W, height: H,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'renderer', 'lantern.html'));
  return { win, W, H };
}

function flyLantern({ win, W, H }, o) {
  const ox = o.x - o.w * 0.6;
  let y = o.y - o.h * 0.7;
  win.setBounds({ x: Math.round(ox), y: Math.round(y), width: W, height: H });
  win.showInactive();
  const disp = screen.getDisplayNearestPoint({ x: Math.round(o.x + o.w / 2), y: Math.round(o.y + o.h / 2) }).bounds;
  const fadeLine = disp.y + disp.height * 0.18;
  const v0 = Math.max(30, Number(o.speed) || 80);
  let t = 0, fadeT = -1;
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    t += 1 / 60;
    const slow = fadeT < 0 ? 1 : Math.max(0.3, 1 - (t - fadeT) * 0.5); // 開始消散後慢下來
    y -= v0 * (1 + Math.min(t, 6) * 0.08) * slow / 60;
    const x = ox + Math.sin(t * 1.4) * o.w * 0.08 * Math.min(1, t / 0.6); // 剛離手時不晃，慢慢晃起來
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
    if (fadeT < 0 && (y + o.h * 0.7 < fadeLine || t > 30)) {
      fadeT = t;
      win.webContents.executeJavaScript('window.dissolve && window.dissolve()').catch(() => {});
    }
    if ((fadeT >= 0 && t - fadeT > 2.6) || t > 45) { clearInterval(timer); win.destroy(); }
  }, 1000 / 60);
}

function launchLantern(o) {
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !(o.w > 0) || !(o.h > 0)) return;
  if (!o.go) {
    if (lanternPending && !lanternPending.win.isDestroyed()) lanternPending.win.destroy();
    const lw = lanternWindow(o);
    lanternPending = lw;
    setTimeout(() => { // 沒等到第 26 格（動作被打斷）就收掉
      if (lanternPending === lw) { lanternPending = null; if (!lw.win.isDestroyed()) lw.win.destroy(); }
    }, 15000);
    return;
  }
  if (lanternPending && !lanternPending.win.isDestroyed()) {
    const lw = lanternPending; lanternPending = null;
    flyLantern(lw, o);
    return;
  }
  const lw = lanternWindow(o); // 沒有先開好（例如 act.js 直接叫到一半）：現開，載好就飛
  lw.win.once('ready-to-show', () => { if (!lw.win.isDestroyed()) flyLantern(lw, o); });
}

function send(channel, payload) {
  if (pet && !pet.isDestroyed()) pet.webContents.send(channel, payload);
}

function broadcastSettings() {
  send('pet:settings', settings);
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:settings', settings);
  rebuildTray();
}

function setSize(size) {
  size = clampSize(size);
  if (!pet) return;
  const b = pet.getBounds();
  const { width, height } = winSize(size);
  // 以腳底中心為基準縮放，人不會跳走
  const cx = b.x + b.width / 2;
  const bottom = b.y + b.height;
  pet.setBounds({ x: Math.round(cx - width / 2), y: Math.round(bottom - height), width, height });
  settings.size = size;
  saveSettingsSoon();
  broadcastSettings();
}

// ---------- 列出其他視窗的位置（坐在視窗邊緣用） ----------
// 只在 Windows：用 PowerShell 呼叫 user32 EnumWindows，取得可見、沒最小化的一般視窗的邊框（由上而下＝由前而後）。
// 其他系統回傳空陣列，她就不會去坐視窗。座標換算成 Electron 用的 DIP，結果快取 2 秒。
const LIST_WINDOWS_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class NW {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  struct RECT { public int L, T, R, B; }
  public static string List(uint skip) {
    SetProcessDPIAware();
    var sb = new StringBuilder("["); bool first = true;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); if (pid == skip) return true;
      var cn = new StringBuilder(64); GetClassName(h, cn, 64); string c = cn.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true;
      int w = r.R - r.L, hh = r.B - r.T; if (w < 240 || hh < 120) return true;
      if (!first) sb.Append(","); first = false;
      sb.Append("{\\"id\\":" + h.ToInt64() + ",\\"x\\":" + r.L + ",\\"y\\":" + r.T + ",\\"w\\":" + w + ",\\"h\\":" + hh + "}");
      return true;
    }, IntPtr.Zero);
    return sb.Append("]").ToString();
  }
}
"@
if ($args.Count -gt 0 -and $args[0] -eq 'serve') {
  # 常駐模式：只編譯一次，之後每收到一行就回一份清單（幾毫秒），坐在視窗上才能即時發現視窗被移動
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    [Console]::Out.WriteLine([NW]::List(__PID__))
    [Console]::Out.Flush()
  }
} else {
  [NW]::List(__PID__)
}
`;

let windowsCache = { at: 0, res: { list: [], error: null } };
let windowsBusy = null;
let psFile = null;
let server = null; // 常駐的 PowerShell：{ proc, buf, waiting: [{ resolve, timer }], ready }

function writePs() {
  if (!psFile) psFile = path.join(app.getPath('temp'), `nadeshiko-windows-${process.pid}.ps1`);
  fs.writeFileSync(psFile, '\ufeff' + LIST_WINDOWS_PS.replace(/__PID__/g, String(process.pid)), 'utf8');
}

function toDip(raw) {
  return raw.map((w) => {
    const a = screen.screenToDipPoint({ x: w.x, y: w.y });
    const b = screen.screenToDipPoint({ x: w.x + w.w, y: w.y + w.h });
    return { id: w.id, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  });
}

function stopServer() {
  if (!server) return;
  const s = server; server = null;
  for (const w of s.waiting) { clearTimeout(w.timer); w.resolve(null); }
  try { s.proc.stdin.end(); s.proc.kill(); } catch (_) { /* ignore */ }
}

// 常駐模式問一次；失敗回 null（呼叫端改用一次性的方式）
function askServer() {
  return new Promise((resolve) => {
    try {
      if (!server) {
        writePs();
        const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile, 'serve'], { windowsHide: true });
        const srv = { proc, buf: '', waiting: [], ready: false };
        server = srv;
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (d) => {
          srv.buf += d;
          let k;
          while ((k = srv.buf.indexOf('\n')) >= 0) {
            const line = srv.buf.slice(0, k).trim();
            srv.buf = srv.buf.slice(k + 1);
            if (!line.startsWith('[')) continue;
            const w = srv.waiting.shift();
            if (!w) continue;
            clearTimeout(w.timer);
            srv.ready = true;
            try { w.resolve(JSON.parse(line)); } catch (_) { w.resolve(null); }
          }
        });
        proc.stderr.on('data', (d) => console.error('[perch]', String(d).trim().slice(0, 200)));
        const gone = () => { if (server === srv) stopServer(); };
        proc.on('error', gone);
        proc.on('close', gone);
      }
      const srv = server;
      // 第一次要編譯 C#，給久一點；之後應該幾毫秒就回來
      const timer = setTimeout(() => { resolve(null); stopServer(); }, srv.ready ? 4000 : 15000);
      srv.waiting.push({ resolve, timer });
      srv.proc.stdin.write('list\n');
    } catch (_) { stopServer(); resolve(null); }
  });
}

// 一次性執行（常駐模式失敗時的備案）
function listOnce() {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    try {
      writePs();
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true });
      const timer = setTimeout(() => { try { ps.kill(); } catch (_) { /* ignore */ } resolve({ list: [], error: 'PowerShell 逾時（第一次編譯可能較慢，會再試）' }); }, 15000);
      ps.stdout.on('data', (d) => { out += d; });
      ps.stderr.on('data', (d) => { err += d; });
      ps.on('error', (e) => { clearTimeout(timer); resolve({ list: [], error: `無法啟動 PowerShell：${e.message}` }); });
      ps.on('close', () => {
        clearTimeout(timer);
        try { resolve({ list: toDip(JSON.parse(out.trim().split(/\r?\n/).pop())), error: null }); } catch (_) {
          resolve({ list: [], error: `PowerShell 沒回傳可用的視窗清單：${(err || out).trim().slice(0, 160) || '無輸出'}` });
        }
      });
    } catch (e) { resolve({ list: [], error: `執行失敗：${e.message}` }); }
  });
}

// 回傳 { list, error }；error 說明為什麼拿不到（給「找不到視窗」的提示用）
function listWindows() {
  if (process.platform !== 'win32') return Promise.resolve({ list: [], error: '只有 Windows 能偵測視窗' });
  if (Date.now() - windowsCache.at < 200) return Promise.resolve(windowsCache.res);
  if (windowsBusy) return windowsBusy;
  windowsBusy = askServer()
    .then((raw) => (raw ? { list: toDip(raw), error: null } : listOnce()))
    .then((res) => {
      if (res.error) console.error('[perch]', res.error);
      windowsCache = { at: Date.now(), res };
      windowsBusy = null;
      return res;
    });
  return windowsBusy;
}

// 語音台詞表 + 實際存在的音檔（沒有音檔就只出字，不會壞）
function voiceDir() {
  return path.join(__dirname, 'voice', i18n.voiceSub(settings.lang));
}
function readVoice() {
  const dir = voiceDir();
  let lines = {};
  let files = [];
  try { lines = JSON.parse(fs.readFileSync(path.join(dir, 'lines.json'), 'utf8')); } catch (_) { /* 沒有台詞表就當沒有語音 */ }
  try { files = fs.readdirSync(dir); } catch (_) { /* ignore */ }
  return { lines, files, sub: i18n.voiceSub(settings.lang) };
}

// ---------- 語音工作室：在控制面板生成、試聽、採用 ----------
const studio = require('./lib/voicestudio');
const takes = new Map(); // 還沒採用的試聽音檔（記憶體裡，關掉面板或再生成就丟掉）
let takeSeq = 0;
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };

function voiceReload() {
  const v = readVoice();
  send('pet:voice', v);
  return v;
}

// 調過音量、有原檔備份的句子（key_序號），面板用來決定要不要顯示「還原」
function backupList() {
  try { return fs.readdirSync(path.join(app.getPath('userData'), 'voice-original', i18n.voiceSub(settings.lang))).map((f) => f.replace(/\.[^.]+$/, '')); } catch (_) { return []; }
}

function setupVoiceIPC() {
  ipcMain.handle('voice:list', () => ({ ...readVoice(), url: settings.voiceUrl, voice: settings.voiceName, max: studio.MAX_LINES, backups: backupList() }));

  // 播現有的音檔（給面板試聽用）
  ipcMain.handle('voice:read', (_e, key, i) => {
    const base = `${key}_${i + 1}`;
    for (const ext of ['mp3', 'ogg', 'wav']) {
      const f = path.join(voiceDir(), `${base}.${ext}`);
      if (fs.existsSync(f)) return { bytes: fs.readFileSync(f), mime: MIME[ext] };
    }
    return null;
  });

  // 生成 n 次（Breeze 一次只收一個，所以依序），回傳每次的音檔與長度；不會動到正式檔
  ipcMain.handle('voice:gen', async (_e, o) => {
    try {
      const line = { text: o.text, say: o.say };
      const lang = i18n.norm(settings.lang);
      const text = studio.spokenText(line, o.pad == null ? studio.defaultPad(lang) : o.pad, lang);
      if (!text.replace(/…/g, '').trim()) throw new Error(T('沒有要唸的字'));
      takes.clear();
      const out = [];
      const n = Math.max(1, Math.min(5, o.takes | 0 || 1));
      for (let t = 0; t < n; t++) {
        let wav = await studio.synth({ url: settings.voiceUrl, voice: settings.voiceName }, text);
        if (o.tail > 0) wav = studio.padWavSilence(wav, o.tail);
        const id = ++takeSeq;
        takes.set(id, wav);
        out.push({ id, bytes: wav, ms: studio.wavDurationMs(wav) });
      }
      return { text, takes: out };
    } catch (e) {
      const hint = /fetch failed|ECONNREFUSED/.test(`${e.message} ${e.cause && (e.cause.code || e.cause.message)}`) ? T('連不上 {0}，請先啟動 Breeze-TTS', settings.voiceUrl) : e.message;
      return { error: hint };
    }
  });

  // 採用：改台詞表，有選定試聽版本就一併換掉音檔，然後讓撫子立刻重新載入
  // 直接改現有音檔的音量／還原（原檔備份在使用者資料夾，不會放進專案）
  const voiceBackup = () => path.join(app.getPath('userData'), 'voice-original', i18n.voiceSub(settings.lang));
  ipcMain.handle('voice:gain', (_e, o) => {
    try {
      if (o.restore) studio.restoreFile(voiceDir(), voiceBackup(), o.key, o.i);
      else studio.setFileGain(voiceDir(), voiceBackup(), o.key, o.i, o.percent);
      return { ok: true, ...voiceReload(), backups: backupList() };
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('voice:adopt', (_e, o) => {
    try {
      const wav = o.takeId ? takes.get(o.takeId) : null;
      if (o.takeId && !wav) throw new Error(T('這個試聽版本已經過期，請重新生成'));
      studio.adopt(voiceDir(), o.key, o.i, o.entry, wav);
      if (wav) { // 換了新音檔：舊的原檔備份作廢（之後調音量要從新音檔算）
        for (const e of ['mp3', 'ogg', 'wav']) fs.rmSync(path.join(voiceBackup(), `${o.key}_${o.i + 1}.${e}`), { force: true });
      }
      return { ok: true, ...voiceReload(), backups: backupList() };
    } catch (e) {
      return { error: e.message };
    }
  });
}

function updateSetting(key, value) {
  if (key === 'lang' && !i18n.LANGS.some(([k]) => k === value)) return;
  if (key === 'weatherTimes') value = weather.parseTimes(value).join(', ');
  if (key === 'nightFrom' || key === 'nightTo') { value = weather.parseTimes(value)[0]; if (!value) return; }
  if (key === 'notePendingMin') { value = Math.max(1, Math.min(240, Math.round(Number(value)))); if (!Number.isFinite(value)) return; }
  if (key === 'skyWidth') { value = Math.max(260, Math.min(640, Math.round(Number(value)))); if (!Number.isFinite(value)) return; }
  if (key === 'noteWidth') { value = Math.max(240, Math.min(560, Math.round(Number(value)))); if (!Number.isFinite(value)) return; }
  if (['rainAt', 'coldAt', 'hotAt'].includes(key)) { value = Number(value); if (!Number.isFinite(value)) return; }
  if (key === 'weatherPlace' && value != null && !(Number.isFinite(value.lat) && Number.isFinite(value.lon))) return;
  if ((key === 'birthday' || key === 'petBirthday') && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(value))) return;
  if (key === 'actMode') {
    if (!ACT_MODES.some(([k]) => k === value)) return;
    settings.random = value !== 'claude';
  }
  settings[key] = value;
  if (key === 'alwaysOnTop' && pet) applyOnTop();
  if (key === 'lang') { // 換語言：語音換成那個語言的資料夾，面板標題、托盤一起換
    voiceReload();
    if (panel && !panel.isDestroyed()) panel.setTitle(T('撫子 控制面板'));
    if (tray) tray.setToolTip(T('撫子'));
  }
  if (key === 'size') return setSize(value);
  saveSettingsSoon();
  broadcastSettings();
}

// ---------- 天氣提醒 ----------
// 每分鐘看一次：到了提醒時間（電腦睡著的話醒來 30 分鐘內補），今天這個時段還沒提醒過，就查天氣、演對應的動作
// show：打開星空天氣框、她演對應的動作（下雨又冷＝撐傘再圍圍巾）；manual：使用者自己按的，查不到也要說
async function checkWeather(show, manual) {
  const p = settings.weatherPlace;
  if (!p) {
    if (manual) openSky({ error: T('還沒設定城市'), hint: T('在控制面板的「天氣提醒」設定') });
    return { error: T('還沒設定城市') };
  }
  let r;
  try {
    r = weather.decide(await weather.forecast(p.lat, p.lon), settings);
  } catch (e) {
    const msg = T('查不到天氣（{0}）', e.message);
    if (manual) openSky({ error: msg, place: p });
    return { error: msg };
  }
  const text = weather.summary(r, T);
  settings.weatherLast = { at: new Date().toISOString(), text, kind: r ? r.kind : null };
  saveSettingsSoon();
  broadcastSettings();
  if (show) openSky({ r, place: p });
  return { text, kind: r ? r.kind : null };
}

// ---------- 星空天氣框（祐 2026-11-19）----------
// 古希臘大理石框＋帕德嫩神廟的星空；記事板的羽毛筆用亮金色的字把天氣寫上去。點一下收起，30 分鐘沒人點自己淡出。
let sky = null; // { win, payload, side }
const shortPlace = (p) => (p && p.label ? String(p.label).split('，')[0] : '');

// 放在撫子旁邊（左邊放得下就放左邊），大約在她胸口的高度；她走動、被拎走時框跟著她（side：上次放哪一邊，放得下就不換邊）
function skyBounds(side) {
  const F = Math.max(260, Math.min(640, Math.round(Number(settings.skyWidth) || 380)));
  const width = Math.round(F * 1.2), height = Math.round(F * 0.24 + F * 2 / 3);
  const pb = pet && !pet.isDestroyed() ? pet.getBounds() : null;
  const wa = (pb ? displayFor(pb) : screen.getPrimaryDisplay()).workArea;
  let x = wa.x + wa.width - width - 40, y = wa.y + wa.height - height;
  if (pb) {
    y = Math.round(pb.y + pb.height * 0.72 - height);
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - height));
    const left = Math.round(pb.x + pb.width * 0.22 - F), right = Math.round(pb.x + pb.width * 0.78);
    const fitsL = left >= wa.x, fitsR = right + width <= wa.x + wa.width;
    side = side === 'right' ? (fitsR || !fitsL ? 'right' : 'left') : (fitsL || !fitsR ? 'left' : 'right');
    x = side === 'left' ? left : right;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
  }
  return { x, y, width, height, side };
}

function followSky() {
  if (!sky || sky.win.isDestroyed()) return;
  const { side, ...b } = skyBounds(sky.side);
  sky.side = side;
  const now = sky.win.getBounds();
  if (now.x !== b.x || now.y !== b.y) sky.win.setBounds(b);
}

// o：{ r?（weather.decide 的結果）, place?, error?, hint? }
function openSky(o = {}) {
  if (sky && !sky.win.isDestroyed()) sky.win.destroy();
  sky = null;
  const d = o.error ? { lines: [o.error], tips: o.hint ? [o.hint] : [] } : weather.details(o.r, T);
  const payload = {
    lang: settings.lang, pen: Math.random() < 0.5 ? 'a' : 'b',
    place: shortPlace(o.place), sub: o.error ? '' : T('接下來 {0} 小時', weather.HOURS),
    lines: d.lines, tips: d.tips,
  };
  const { side, ...bounds } = skyBounds();
  const win = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, focusable: true, title: T('天氣提醒'),
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true }); // 透明的地方點擊穿過去，滑到框上才接住（sky.js 決定）
  const mine = { win, payload, side };
  sky = mine;
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  win.on('closed', () => { if (sky === mine) sky = null; });
  win.loadFile(path.join(__dirname, 'renderer', 'sky.html'));
  // 她一起演：下雨又冷就撐傘、接著圍圍巾（筆先飄進來，稍等一下再開始）
  const kind = o.r && o.r.kind;
  if (kind) setTimeout(() => send('pet:action', kind), 700);
}

function closeSky() {
  const s = sky;
  sky = null;
  if (s && !s.win.isDestroyed()) s.win.destroy();
}

function setupSkyIPC() {
  ipcMain.handle('sky:init', (e) => (sky && e.sender === sky.win.webContents ? sky.payload : null));
  ipcMain.on('sky:close', () => closeSky());
  ipcMain.on('sky:ignore', (e, v) => {
    if (sky && e.sender === sky.win.webContents && !sky.win.isDestroyed()) sky.win.setIgnoreMouseEvents(!!v, { forward: true });
  });
}

async function weatherTick() {
  if (!settings.weatherOn || !settings.weatherPlace) return;
  const now = new Date();
  const slot = weather.dueSlot(weather.parseTimes(settings.weatherTimes), now, settings.weatherFired || {});
  if (!slot) return;
  settings.weatherFired = { ...(settings.weatherFired || {}), [slot]: weather.dayKey(now) };
  saveSettingsSoon();
  await checkWeather(true);
}

// ---------- 記事板（祐 2026-11-17）----------
// 桌寵自己當鬧鐘（不靠 Claude，不花用量）；撫子用 tools/schedule.js 代筆，行程存在狀態資料夾的 schedule.json。
// 時間到了：她開書拿羽毛筆寫字（整理記憶那組動作），旁邊打開信紙，筆把該做的事寫上去。
// 點事項：完成（劃線）／變更（劃線＋寫原因）。開著 notePendingMin 分鐘沒處理就標「待處理」。
// 天氣提醒跟行程同一個時間：天氣寫進信紙最上面，關上信紙、她闔上書之後才演天氣的動作。
let note = null;        // { win, date, write, due, weather, pen, pendTimer }
let noteMtime = -1;

const noteFileMtime = () => { try { return fs.statSync(schedule.file()).mtimeMs; } catch (_) { return 0; } };
function saveSchedule(data) {
  schedule.save(data);
  noteMtime = noteFileMtime(); // 自己寫的不算「外面改了」
}

// 這筆行程最近哪天會用到（今天起一週內）；只有那天的就是那天
function nextDay(item, now = new Date()) {
  if (item.date) return item.date;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!item.days || !item.days.length || item.days.includes(d.getDay())) return schedule.dayKey(d);
  }
  return schedule.dayKey(now);
}

function notePayload() {
  const data = schedule.load();
  const [y, m, d] = note.date.split('-').map(Number);
  return {
    date: note.date, items: schedule.itemsFor(data, new Date(y, m - 1, d)),
    write: note.write, due: note.due, weather: note.weather, pen: note.pen, lang: settings.lang,
  };
}

function pushNote() {
  if (note && !note.win.isDestroyed()) note.win.webContents.send('note:data', notePayload());
}

// 信紙放在撫子旁邊（左邊放得下就放左邊），底部對齊她的腳
function noteBounds() {
  const W = Math.max(240, Math.min(560, Math.round(Number(settings.noteWidth) || 320)));
  const width = Math.round(W * 1.24), height = Math.round(W * 1.5 + W * 0.22); // 右邊、上面留給羽毛筆
  const pb = pet && !pet.isDestroyed() ? pet.getBounds() : null;
  const wa = (pb ? displayFor(pb) : screen.getPrimaryDisplay()).workArea;
  let x = wa.x + wa.width - width - 40, y = wa.y + wa.height - height;
  if (pb) {
    const feet = pb.y + pb.height;
    y = Math.max(wa.y, Math.min(feet - height, wa.y + wa.height - height));
    const left = Math.round(pb.x + pb.width * 0.2 - width);
    x = left >= wa.x ? left : Math.round(pb.x + pb.width * 0.8);
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
  }
  return { x, y, width, height };
}

// o：{ date?, write?: [id], due?: [id], weather?: { text, kind }, reason: 'due'|'add'|'manual' }
function openNote(o = {}) {
  const date = o.date || schedule.dayKey(new Date());
  if (note && !note.win.isDestroyed() && note.date === date) {
    note.write = [...new Set([...(note.write || []), ...(o.write || [])])];
    note.due = [...new Set([...(note.due || []), ...(o.due || [])])];
    if (o.weather) note.weather = o.weather;
    pushNote();
    note.win.showInactive();
  } else {
    if (note && !note.win.isDestroyed()) note.win.destroy();
    const win = new BrowserWindow({
      ...noteBounds(),
      transparent: true, frame: false, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, title: T('記事板'),
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    note = { win, date, write: o.write || [], due: o.due || [], weather: o.weather || null, pen: Math.random() < 0.5 ? 'a' : 'b', pendTimer: null };
    const mine = note;
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); }); // 不搶走正在打字的焦點
    win.on('closed', () => { if (note === mine) closeNote(); });
    win.loadFile(path.join(__dirname, 'renderer', 'note.html'));
  }
  // 時間到的提醒：放著 notePendingMin 分鐘沒處理，標「待處理」，她也闔上書回去做自己的事
  if (o.reason === 'due') {
    clearTimeout(note.pendTimer);
    const mine = note;
    note.pendTimer = setTimeout(() => {
      if (note !== mine) return;
      const data = schedule.load();
      for (const x of schedule.itemsFor(data, new Date())) if (mine.due.includes(x.id) && !x.s) schedule.setStatus(data, mine.date, x.id, 'pending');
      saveSchedule(data);
      pushNote();
      send('pet:letter', { open: true, pose: false });
    }, Math.max(1, Number(settings.notePendingMin) || 10) * 60 * 1000);
  }
  send('pet:letter', { open: true, pose: true, reason: o.reason || 'manual' }); // 她開書、拿羽毛筆寫字，直到信紙收起來
}

function closeNote() {
  const n = note;
  if (!n) return;
  note = null;
  clearTimeout(n.pendTimer);
  if (!n.win.isDestroyed()) n.win.destroy();
  send('pet:letter', { open: false, after: n.weather && n.weather.kind ? n.weather.kind : null });
}

// 撫子代筆加了新的行程 → 打開信紙，筆寫上去（每 0.6 秒看一次檔案有沒有變）
function noteCheckFile() {
  const m = noteFileMtime();
  if (m === noteMtime) return;
  const first = noteMtime < 0;
  noteMtime = m;
  if (!settings.noteOn) return;
  const data = schedule.load();
  const fresh = schedule.unwritten(data);
  if (fresh.length) {
    const date = nextDay(fresh[0]);
    const [y, mo, d] = date.split('-').map(Number);
    const day = new Date(y, mo - 1, d);
    const here = fresh.filter((x) => schedule.itemsFor(data, day).some((i) => i.id === x.id)).map((x) => x.id);
    schedule.markWritten(data, fresh.filter((x) => !here.includes(x.id)).map((x) => x.id)); // 別天的不寫，記成寫過
    if (here.length < fresh.length) saveSchedule(data);
    openNote({ date, write: here, reason: 'add' });
  } else if (!first) {
    pushNote();
  }
}

// 每分鐘：有行程到時間就打開信紙；天氣提醒同一個時間的話一起查、寫進信紙
async function noteTick() {
  if (!settings.noteOn) return;
  const now = new Date();
  const data = schedule.load();
  const due = schedule.dueItems(data, now);
  if (!due.length) return;
  schedule.markFired(data, due.map((x) => x.id), now);
  saveSchedule(data);
  let wx = null;
  if (settings.weatherOn && settings.weatherPlace) {
    const slot = weather.dueSlot(weather.parseTimes(settings.weatherTimes), now, settings.weatherFired || {});
    if (slot && due.some((x) => x.time === slot)) {
      settings.weatherFired = { ...(settings.weatherFired || {}), [slot]: weather.dayKey(now) };
      saveSettingsSoon();
      const r = await checkWeather(false);
      if (r && r.text) wx = { text: r.text, kind: r.kind || null };
    }
  }
  openNote({ date: schedule.dayKey(now), due: due.map((x) => x.id), weather: wx, reason: 'due' });
}

async function minuteTick() {
  try { await noteTick(); } catch (e) { console.error('note', e); }
  await weatherTick();
}

function setupNoteIPC() {
  ipcMain.handle('note:init', () => (note ? notePayload() : null));
  ipcMain.on('note:status', (_e, id, status, reason) => {
    if (!note || !['done', 'changed', 'pending', null].includes(status)) return;
    const data = schedule.load();
    schedule.setStatus(data, note.date, String(id), status, reason);
    saveSchedule(data);
  });
  ipcMain.on('note:written', (_e, ids) => {
    if (!Array.isArray(ids)) return;
    const data = schedule.load();
    schedule.markWritten(data, ids.map(String));
    saveSchedule(data);
    if (note) note.write = note.write.filter((x) => !ids.includes(x));
  });
  ipcMain.on('note:close', () => closeNote());
  // 控制面板：行程清單、加一筆、刪一筆、打開記事板
  ipcMain.handle('note:list', () => schedule.load().items.sort((a, b) => a.time.localeCompare(b.time)));
  // o：{ id?（有就是修改那筆）, time, text, date?（只有那天）, days?（''＝每天、'平日'、'週末'、'1-5'…） }
  ipcMain.handle('note:add', (_e, o) => {
    try {
      o = o || {};
      const data = schedule.load();
      const item = { time: o.time, text: o.text, date: o.date || undefined, days: o.date ? undefined : schedule.parseDays(o.days) };
      if (o.id) schedule.updateItem(data, String(o.id), item); else schedule.addItem(data, item);
      schedule.save(data); // 不更新 noteMtime：讓下一輪看到新行程，打開信紙寫上去
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('note:day', (_e, date) => {
    const d = schedule.normDate(date);
    if (!d) return [];
    const [y, m, dd] = d.split('-').map(Number);
    return schedule.itemsFor(schedule.load(), new Date(y, m - 1, dd));
  });
  ipcMain.handle('note:remove', (_e, id) => { const data = schedule.load(); const ok = schedule.removeItem(data, String(id)); saveSchedule(data); pushNote(); return ok; });
  ipcMain.on('note:open', () => openNote({ reason: 'manual' }));
}

// 「保持在最上層」：用最高的層級（screen-saver），瀏覽器或影片全螢幕時才比較不會被蓋住；
// macOS 另外讓她出現在全螢幕的桌面空間。Windows 上的實際效果仍取決於全螢幕程式的種類，見 README。
function applyOnTop() {
  if (!pet || pet.isDestroyed()) return;
  if (settings.alwaysOnTop) {
    pet.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    pet.moveTop();
  } else {
    pet.setAlwaysOnTop(false);
  }
}

// 視窗大小先差 1px 再改回來：實測螢幕休眠重啟後「拎不起來、重新調整尺寸就好」，
// 調尺寸會讓系統重新建立視窗的邊界與命中範圍，所以這裡做同樣的動作（透明視窗，看不出來）
function nudgeBounds() {
  if (!pet || pet.isDestroyed()) return;
  const b = pet.getBounds();
  const { width, height } = winSize();
  pet.setBounds({ x: b.x, y: b.y, width: width + 1, height });
  pet.setBounds({ x: b.x, y: b.y, width, height });
}

function recoverPet() {
  if (!pet || pet.isDestroyed()) return;
  clearInterval(dragTimer);
  dragTimer = null;
  nudgeBounds();
  pet.setIgnoreMouseEvents(true, { forward: true });
  if (!pet.isVisible()) pet.showInactive();
  applyOnTop();
  send('pet:recover');
}

// 喚醒：重整視窗、頂到最上層、人物醒來（躺著就爬起來，否則揮手）；人物在螢幕外就帶回右下角
function summonPet() {
  if (!pet || pet.isDestroyed()) return;
  const b = pet.getBounds();
  const onScreen = screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x + b.width / 2 >= w.x && b.x + b.width / 2 <= w.x + w.width && b.y + b.height / 2 >= w.y && b.y + b.height / 2 <= w.y + w.height;
  });
  if (!onScreen) resetPosition();
  recoverPet();
  pet.moveTop();
  setTimeout(() => send('pet:summon'), 150);
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const key = settings.hotkey;
  if (!key) return;
  try {
    if (!globalShortcut.register(key, summonPet)) console.error(`快捷鍵 ${key} 被別的程式佔用，改 settings.json 的 hotkey 換一組`);
  } catch (e) {
    console.error('hotkey', e.message);
  }
}

// ---------- Claude 狀態檔輪詢 ----------
// 撫子（Claude）叫的動作：只轉選單裡有的動作與 EMOTE_EXTRA（之後新素材的點頭、搖頭、回頭看等先列在這）
const EMOTE_EXTRA = ['happy', 'pose', 'perch_lie']; // perch_lie：趴到視窗上緣，待到被點或視窗動了
let lastActId = null;
function pollAction() {
  const a = bridge.takeAction(lastActId);
  if (!a) return;
  lastActId = a.id;
  if (a.action === 'note') { openNote({ reason: 'manual' }); return; } // 撫子叫的「打開記事板」（tools/schedule.js show）
  if (settings.actMode === 'random') return; // 「隨機」模式不接撫子的動作
  // 唱歌、小提琴、指揮、豎琴、電子琴：在該資料夾找曲名含 song 的第一首（找不到就只做動作）；跟使用者自己點曲子走同一條
  if (MUSIC_SUB[a.action] != null || SYNTH_KINDS.has(a.action)) {
    const want = String(a.song || '').trim();
    const hit = want ? listSongs(a.action).find((s) => s.title.includes(want)) : null;
    send('pet:action', hit ? `${a.action}:${hit.file}` : a.action);
    return;
  }
  const ok = ACTIONS.some(([k]) => k === a.action) || EMOTE_EXTRA.includes(a.action);
  if (ok) send('pet:emote', { action: a.action, say: a.say || '' });
}

function pollSnapshot() {
  pollAction();
  try { noteCheckFile(); } catch (e) { console.error('note', e); }
  const snap = bridge.readSnapshot();
  const json = JSON.stringify(snap);
  if (json !== lastSnapshotJSON) {
    lastSnapshotJSON = json;
    send('pet:snapshot', snap);
    if (panel && !panel.isDestroyed()) panel.webContents.send('panel:snapshot', snap);
  }
}

// ---------- 選單 ----------
const TEST_STATES = [
  ['free', '精神飽滿（隨機行為）'],
  ['thinking', '思考中'],
  ['working', '工作中'],
  ['compacting', '整理記憶（壓縮）'],
  ['waiting', '等你確認'],
  ['done', '完成'],
  ['hello', '打招呼'],
  ['tired', '疲憊（用量 85%+）'],
  ['exhausted', '5 小時額度用完（睡覺）'],
  ['faint', '暈倒（週上限）'],
];
const ACTIONS = [
  ['walk', '走一走'], ['fly', '飛一圈'], ['yawn', '打哈欠'], ['stretch', '伸懶腰'],
  ['wave', '揮手'], ['curious', '東張西望'], ['cheer', '歡呼'], ['nap', '睡午覺'],
  ['sit', '坐下休息'], ['perch', '坐到視窗邊緣'], ['shy', '害羞'], ['wake', '睡醒爬起來'],
  ['pray', '禱告'], ['doze', '坐著打盹'], ['standdoze', '站著打瞌睡'], ['curtsy', '提屈膝禮'],
  ['pirouette', '芭蕾：旋轉'], ['arabesque', '芭蕾：阿拉貝斯克'],
  ['pose', '擺姿勢'], ['nod', '點頭贊同'], ['shake', '搖頭困惑'], ['mail', '收信'], ['gift', '聖誕禮物'], ['birthday', '生日快樂'], ['lantern', '放天燈'], ['sparkler', '仙女棒'],
  ['newyear', '新年拜年'], ['petbday', '撫子的生日'], ['dragonboat', '端午香包'], ['valentine', '情人節巧克力'], ['midautumn', '中秋賞月'], ['rainy', '下雨帶傘'], ['chilly', '天冷保暖'], ['hot', '天熱喝水'], ['bedtime', '深夜勸睡'],
];

// 歌曲與樂曲：檔名（去掉副檔名）就是曲名；只在使用者自己點曲子時才演出
// sing：app/music/ 的歌曲（唱歌）；violin：app/music/violin/ 的樂曲（拉小提琴）；conduct：app/music/conduct/ 的管弦樂（指揮）
const MUSIC_DIR = path.join(__dirname, 'music');
const MUSIC_SUB = { sing: '', violin: 'violin', conduct: 'conduct' };
const PLAIN_LABEL = { sing: '只唱動作（不放音樂）', violin: '只拉琴（不放音樂）', conduct: '只指揮（不放音樂）', harp: '只彈動作（不出聲）', keys: '只彈動作（不出聲）' };
// 豎琴、電子琴（祐 2026-11-13）：撫子照 app/scores/ 的樂譜自己彈（聲音即時合成），樂譜檔名去掉 .json 就是曲名
const SCORE_DIR = path.join(__dirname, 'scores');
const SYNTH_KINDS = new Set(['harp', 'keys']);
function listScores() {
  try {
    return fs.readdirSync(SCORE_DIR).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((file) => { let title = path.basename(file, '.json'); try { title = JSON.parse(fs.readFileSync(path.join(SCORE_DIR, file), 'utf8')).title || title; } catch (_) { /* 讀不到就用檔名 */ } return { file, title }; });
  } catch (_) { return []; }
}
const MUSIC_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
function listSongs(kind = 'sing') {
  if (SYNTH_KINDS.has(kind)) return listScores();
  try {
    return fs.readdirSync(path.join(MUSIC_DIR, MUSIC_SUB[kind] || '')).filter((f) => MUSIC_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((file) => ({ file, title: path.basename(file, path.extname(file)) }));
  } catch (_) { return []; }
}
function songMenu(kind) {
  const songs = listSongs(kind);
  const where = SYNTH_KINDS.has(kind) ? 'app/scores' : ['app/music', MUSIC_SUB[kind]].filter(Boolean).join('/');
  return [
    ...(songs.length ? songs.map((s) => ({ label: s.title, click: () => send('pet:action', `${kind}:${s.file}`) }))
      : [{ label: T('（{0} 裡還沒有曲子）', where), enabled: false }]),
    { type: 'separator' },
    { label: T(PLAIN_LABEL[kind]), click: () => send('pet:action', kind) },
  ];
}

function menuTemplate() {
  // 尺寸、音量、頭上小字大小只放在控制面板（尺寸也可以 Ctrl＋滾輪），右鍵選單簡潔（祐 2026-11-08）
  return [
    { label: T('撫子'), enabled: false },
    { type: 'separator' },
    { label: T('動作'), submenu: ACTIONS.map(([k, l]) => ({ label: T(l), click: () => send('pet:action', k) })) },
    { label: T('記事板'), click: () => openNote({ reason: 'manual' }) },
    { label: T('天氣提醒'), click: () => checkWeather(true, true) },
    { label: T('歌曲'), submenu: songMenu('sing') },
    { label: T('小提琴'), submenu: songMenu('violin') },
    { label: T('指揮'), submenu: songMenu('conduct') },
    { label: T('豎琴'), submenu: songMenu('harp') },
    { label: T('電子琴'), submenu: songMenu('keys') },
    {
      label: T('測試狀態'),
      submenu: [
        { label: T('自動（跟 Claude 連動）'), type: 'radio', checked: forced == null, click: () => setForced(null) },
        { type: 'separator' },
        ...TEST_STATES.map(([k, l]) => ({ label: T(l), type: 'radio', checked: forced === k, click: () => setForced(k) })),
      ],
    },
    { type: 'separator' },
    {
      label: T('動作控制方式'),
      submenu: ACT_MODES.map(([k, l]) => ({ label: T(l), type: 'radio', checked: settings.actMode === k, click: () => updateSetting('actMode', k) })),
    },
    // 走動、飛、坐視窗邊緣、語音、頭上小字、體力條、最上層這些開關只放在控制面板，右鍵選單保持乾淨（祐 2026-11-08）
    {
      label: T('開機自動啟動'), type: 'checkbox',
      checked: app.getLoginItemSettings(LOGIN_ITEM).openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, ...LOGIN_ITEM }),
    },
    // 語言：選項用各自的語言寫，選單名稱也帶上「Language」，看不懂現在的語言也找得到（祐 2026-11-16）
    {
      label: i18n.norm(settings.lang) === 'en' ? 'Language' : `${T('語言')} / Language`,
      submenu: i18n.LANGS.map(([k, l]) => ({ label: l, type: 'radio', checked: i18n.norm(settings.lang) === k, click: () => updateSetting('lang', k) })),
    },
    { type: 'separator' },
    { label: T('控制面板與模擬器…'), click: openPanel },
    { label: T('喚醒（{0}）', (settings.hotkey || '').replace('CommandOrControl', 'Ctrl')), click: summonPet },
    { label: T('回到螢幕右下角'), click: resetPosition },
    { label: T('打開狀態資料夾'), click: () => { fs.mkdirSync(bridge.stateDir(), { recursive: true }); shell.openPath(bridge.stateDir()); } },
    { type: 'separator' },
    { label: T('結束'), click: () => app.quit() },
  ];
}

function popupMenu() {
  Menu.buildFromTemplate(menuTemplate()).popup({ window: pet });
}

function rebuildTray() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function setForced(k) {
  forced = k;
  send('pet:force', k);
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:force', k);
  rebuildTray();
}

function resetPosition() {
  if (!pet) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = pet.getBounds();
  placePet(wa.x + wa.width - b.width - 40, wa.y + wa.height - b.height);
  send('pet:action', 'land');
}

function openPanel() {
  if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; }
  panel = new BrowserWindow({
    // 羊皮紙卷軸當窗框：無邊框、透明，內容限制在紙面內（比例 560:778）
    width: 560, height: 778, title: T('撫子 控制面板'), autoHideMenuBar: true,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panel.on('closed', () => { panel = null; });
}

// ---------- IPC ----------
function setupIPC() {
  ipcMain.handle('pet:init', () => ({
    settings,
    forced,
    bubbleH: BUBBLE_H,
    manifest: bridge.readJSON(path.join(__dirname, 'sprites', 'manifest.json')),
    snapshot: bridge.readSnapshot(),
    voice: readVoice(),
    stateDir: bridge.stateDir(),
  }));

  setupVoiceIPC();
  setupNoteIPC();
  setupSkyIPC();

  ipcMain.handle('pet:windows', () => listWindows());

  ipcMain.on('pet:set-ignore', (_e, ignore) => {
    if (pet) pet.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.handle('pet:geom', () => {
    if (!pet) return null;
    const b = pet.getBounds();
    return { bounds: b, workArea: displayFor(b).workArea, cursor: screen.getCursorScreenPoint() };
  });

  ipcMain.on('pet:lantern', (_e, o) => launchLantern(o));
  // 深夜被碰到：記下來，下次跟 Claude 說話時由 hook 帶進對話
  ipcMain.on('pet:night-touch', (_e, kind) => {
    if (!settings.nightOn || !settings.nightTell) return;
    try { bridge.recordNightTouch(String(kind)); } catch (e) { console.error('night', e); }
  });
  ipcMain.on('pet:move', (_e, x, y) => {
    if (!pet) return;
    placePet(x, y);
    settings.x = Math.round(x);
    settings.y = Math.round(y);
    settings.winH = winSize().height;
    saveSettingsSoon();
  });

  // 拖曳在主程序跟游標，滑鼠甩出視窗也不會掉
  ipcMain.on('pet:drag-start', (_e, gx, gy) => {
    if (!pet) return;
    nudgeBounds();
    clearInterval(dragTimer);
    let last = screen.getCursorScreenPoint();
    let lastT = Date.now();
    dragTimer = setInterval(() => {
      if (!pet) return;
      const c = screen.getCursorScreenPoint();
      const t = Date.now();
      const dt = Math.max(1, t - lastT);
      placePet(c.x - gx, c.y - gy);
      send('pet:drag-move', { vx: ((c.x - last.x) / dt) * 16, vy: ((c.y - last.y) / dt) * 16 });
      last = c; lastT = t;
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    clearInterval(dragTimer);
    dragTimer = null;
    if (pet) {
      const b = pet.getBounds();
      settings.x = b.x; settings.y = b.y; settings.winH = b.height;
      saveSettingsSoon();
    }
  });

  ipcMain.on('pet:menu', popupMenu);
  ipcMain.on('pet:resize-step', (_e, dir) => setSize(settings.size * (dir > 0 ? 1.08 : 1 / 1.08)));

  // 控制面板
  ipcMain.handle('panel:init', () => ({ settings, forced, snapshot: bridge.readSnapshot(), stateDir: bridge.stateDir(), sizeMin: SIZE_MIN, sizeMax: SIZE_MAX }));
  ipcMain.on('panel:set', (_e, key, value) => updateSetting(key, value));
  ipcMain.on('panel:force', (_e, k) => setForced(k || null));
  ipcMain.on('panel:action', (_e, k) => send('pet:action', k));
  // 天氣：搜尋城市（用介面語言顯示地名：zh／ja／en）、現在查一次（有要提醒的就直接演給你看）
  ipcMain.handle('weather:search', async (_e, name) => {
    try { return { list: await weather.geocode(name, i18n.norm(settings.lang).slice(0, 2)) }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('weather:check', () => checkWeather(true, true));
  ipcMain.handle('music:list', (_e, kind) => listSongs(kind));
  // 樂譜（同步讀，只讀 app/scores/ 底下的 .json，檔名不能有路徑）
  ipcMain.on('score:read', (e, file) => {
    try {
      if (typeof file !== 'string' || path.basename(file) !== file || !file.endsWith('.json')) throw new Error('bad name');
      e.returnValue = JSON.parse(fs.readFileSync(path.join(SCORE_DIR, file), 'utf8'));
    } catch (_) { e.returnValue = null; }
  });
  ipcMain.on('music:open', (_e, kind) => {
    const dir = SYNTH_KINDS.has(kind) ? SCORE_DIR : path.join(MUSIC_DIR, MUSIC_SUB[kind] || '');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
  // 模擬器：走跟真正 hooks 一樣的寫檔路徑
  ipcMain.on('sim:hook', (_e, input) => { bridge.applyHookEvent({ session_id: 'simulator', cwd: 'simulator', ...input }); pollSnapshot(); });
  ipcMain.on('sim:usage', (_e, five, week) => {
    const now = Math.floor(Date.now() / 1000);
    bridge.applyStatusline({
      rate_limits: {
        five_hour: { used_percentage: Number(five), resets_at: now + 2 * 3600 },
        seven_day: { used_percentage: Number(week), resets_at: now + 3 * 86400 },
      },
    });
    pollSnapshot();
  });
  ipcMain.on('sim:clear', () => {
    const d = bridge.stateDir();
    for (const f of ['usage.json', 'limit.json', path.join('sessions', 'simulator.json')]) {
      try { fs.unlinkSync(path.join(d, f)); } catch (_) {}
    }
    pollSnapshot();
  });
}

function makeTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip(T('撫子'));
    rebuildTray();
    tray.on('click', summonPet);
  } catch (e) {
    console.error('tray', e);
  }
}

// 開機自動啟動（祐 2026-11-16 回報）：沒打包時是用 electron.exe 跑 app 資料夾，
// 登錄只寫 electron.exe 的話，開機只會跳出 Electron 的「electron.exe path-to-app」說明小視窗。
// 所以要把 app 資料夾當參數一起登錄。
const LOGIN_ITEM = app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };

// 舊版（v0.8.7 以前）勾過的登錄沒有帶 app 資料夾：啟動時發現就改成正確的
function fixLoginItem() {
  if (app.isPackaged || process.platform !== 'win32') return;
  try {
    if (app.getLoginItemSettings().openAtLogin && !app.getLoginItemSettings(LOGIN_ITEM).openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, ...LOGIN_ITEM });
    }
  } catch (e) {
    console.error('login item', e);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', summonPet);
  app.whenReady().then(() => {
    fixLoginItem();
    loadSettings();
    bridge.pruneSessions();
    setupIPC();
    createPet();
    makeTray();
    setInterval(pollSnapshot, 600);
    setInterval(minuteTick, 60 * 1000); // 記事板與天氣提醒（記事板先看，同時間的天氣併進信紙）
    setTimeout(minuteTick, 15 * 1000);
    setInterval(() => { if (settings.alwaysOnTop && pet && !pet.isDestroyed() && pet.isVisible()) pet.moveTop(); }, 3000);
    if (process.argv.includes('--panel')) openPanel();
    registerHotkey();
    // 偵測系統睡眠或螢幕休眠：計時器突然隔了很久才跑，就當作剛喚醒
    let lastBeat = Date.now();
    setInterval(() => {
      const n = Date.now();
      if (n - lastBeat > 8000) setTimeout(recoverPet, 600);
      lastBeat = n;
    }, 2000);
    // 螢幕休眠／鎖定／換顯示器後，透明視窗的滑鼠穿透狀態可能跟畫面端不同步（能摸頭但拎不起來）
    // → 重設成「穿透＋轉發移動」，並通知畫面端清掉殘留的按住狀態
    for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(recoverPet, 800));
    screen.on('display-metrics-changed', () => setTimeout(recoverPet, 800));
    screen.on('display-added', () => setTimeout(recoverPet, 800));
    screen.on('display-removed', () => setTimeout(recoverPet, 800));
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopServer(); });
}
