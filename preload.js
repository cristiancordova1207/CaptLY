const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, d) => fn(d));

contextBridge.exposeInMainWorld('api', {
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  getTools: call('tools:get'),
  listSources: call('sources:list'),
  start: call('rec:start'),
  stop: call('rec:stop'),
  mark: call('rec:mark'),
  pause: call('rec:pause'),
  pickFolder: call('folder:pick'),
  donate: call('donate:open'),
  openFolder: call('folder:open'),
  editor: {
    pick: call('editor:pick'),
    probe: call('editor:probe'),
    thumbs: call('editor:thumbs'),
    wave: call('editor:wave'),
    premiere: call('editor:premiere'),
    render: call('editor:render'),
    onProgress: on('editor-progress'),
  },
  onInput: on('input'),
  onTime: on('rec-time'),
  onState: on('rec-state'),
  onMark: on('mark'),
  onDone: on('rec-done'),
  onNotice: on('notice'),
});
