'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (cb) => {
  const fn = (e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  info: invoke('app:info'),
  setState: invoke('app:state'),

  ocrSelect: invoke('ocr:select'),
  ocrLast: invoke('ocr:last'),
  regionInfo: invoke('region:info'),
  regionClear: invoke('region:clear'),
  scroll: invoke('mouse:scroll'),
  cursorOnOwnWindow: invoke('cursor:onOwnWindow'),

  voices: invoke('tts:voices'),
  synth: invoke('tts:synth'),

  recSources: invoke('rec:sources'),
  recUseSource: invoke('rec:useSource'),
  recBegin: invoke('rec:begin'),
  recChunk: invoke('rec:chunk'),
  recEnd: invoke('rec:end'),
  recChooseFolder: invoke('rec:chooseFolder'),

  saveText: invoke('file:saveText'),
  copy: invoke('clip:write'),
  openPath: invoke('shell:open'),
  showItem: invoke('shell:showItem'),
  openRecFolder: invoke('shell:openFolder'),
  openExternal: invoke('shell:external'),
  isWindowVisible: invoke('win:visible'),
  hideWindow: invoke('win:hide'),
  showWindow: invoke('win:show'),
  minimize: invoke('win:minimize'),

  onHotkey: on('hotkey'),
  onRegionChanged: on('region:changed'),
  onProgress: on('ocr:progress'),
  onUpdateReady: on('update:ready'),
  installUpdate: invoke('update:install'),
  checkUpdate: invoke('update:check'),
  updateStatus: invoke('update:getStatus'),
  onUpdateStatus: on('update:status'),
  onUpdateShow: on('update:show'),

  // kumpulkan screenshot
  snapOnce: invoke('snap:once'),
  snapStart: invoke('snap:start'),
  snapSelectAndStart: invoke('snap:selectAndStart'),
  snapStop: invoke('snap:stop'),
  snapStatus: invoke('snap:status'),
  snapOpenFolder: invoke('snap:openFolder'),
  snapChooseFolder: invoke('snap:chooseFolder'),
  onSnapStatus: on('snap:status'),

  // halaman di dalam aplikasi
  pageOpen: invoke('page:open'),
  pageState: invoke('page:state'),
  pageGo: invoke('page:go'),
  pageNav: invoke('page:nav'),
  pageScroll: invoke('page:scroll'),
  pageUseWhole: invoke('page:useWhole'),
  pageSelectArea: invoke('page:selectArea'),
  pageDomText: invoke('page:domText'),
  pageTrigger: invoke('page:trigger'),
  onPageState: on('page:state'),
  onPageError: on('page:error'),
  onPageFocusUrl: on('page:focusUrl'),
  onPageText: on('page:text'),

  // jendela pilih area
  onOverlayInit: on('overlay:init'),
  overlayDone: (rect) => ipcRenderer.send('overlay:done', rect),
});
