'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('petHost', {
  init: () => ipcRenderer.invoke('pet:init'),
  geom: () => ipcRenderer.invoke('pet:geom'),
  windows: () => ipcRenderer.invoke('pet:windows'),
  setIgnore: (v) => ipcRenderer.send('pet:set-ignore', v),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  dragStart: (gx, gy) => ipcRenderer.send('pet:drag-start', gx, gy),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  menu: () => ipcRenderer.send('pet:menu'),
  resizeStep: (dir) => ipcRenderer.send('pet:resize-step', dir),
  onSnapshot: on('pet:snapshot'),
  onSettings: on('pet:settings'),
  onForce: on('pet:force'),
  onAction: on('pet:action'),
  onEmote: on('pet:emote'),
  onDragMove: on('pet:drag-move'),
  onRecover: on('pet:recover'),
  onSummon: on('pet:summon'),
  onVoice: on('pet:voice'),
  lantern: (o) => ipcRenderer.send('pet:lantern', o),
  nightTouch: (kind) => ipcRenderer.send('pet:night-touch', kind),
  onLetter: on('pet:letter'),
  readScore: (file) => ipcRenderer.sendSync('score:read', file),
});

// 記事板的信紙視窗（祐 2026-11-17）
contextBridge.exposeInMainWorld('noteHost', {
  init: () => ipcRenderer.invoke('note:init'),
  status: (id, status, reason) => ipcRenderer.send('note:status', id, status, reason),
  written: (ids) => ipcRenderer.send('note:written', ids),
  close: () => ipcRenderer.send('note:close'),
  onData: on('note:data'),
});

contextBridge.exposeInMainWorld('panelHost', {
  init: () => ipcRenderer.invoke('panel:init'),
  set: (k, v) => ipcRenderer.send('panel:set', k, v),
  force: (k) => ipcRenderer.send('panel:force', k),
  action: (k) => ipcRenderer.send('panel:action', k),
  weatherSearch: (name) => ipcRenderer.invoke('weather:search', name),
  weatherCheck: () => ipcRenderer.invoke('weather:check'),
  noteList: () => ipcRenderer.invoke('note:list'),
  noteAdd: (o) => ipcRenderer.invoke('note:add', o),
  noteDay: (date) => ipcRenderer.invoke('note:day', date),
  noteRemove: (id) => ipcRenderer.invoke('note:remove', id),
  noteOpen: () => ipcRenderer.send('note:open'),
  simHook: (input) => ipcRenderer.send('sim:hook', input),
  simUsage: (five, week) => ipcRenderer.send('sim:usage', five, week),
  simClear: () => ipcRenderer.send('sim:clear'),
  musicList: (kind) => ipcRenderer.invoke('music:list', kind),
  musicOpen: (kind) => ipcRenderer.send('music:open', kind),
  voiceList: () => ipcRenderer.invoke('voice:list'),
  voiceRead: (key, i) => ipcRenderer.invoke('voice:read', key, i),
  voiceGen: (o) => ipcRenderer.invoke('voice:gen', o),
  voiceAdopt: (o) => ipcRenderer.invoke('voice:adopt', o),
  voiceGain: (o) => ipcRenderer.invoke('voice:gain', o),
  onSettings: on('panel:settings'),
  onSnapshot: on('panel:snapshot'),
  onForce: on('panel:force'),
});
