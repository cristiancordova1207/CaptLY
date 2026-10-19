const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };

const DEFAULTS = {
  fps: 60, sound: 'desktop', mic: false, preview: true, theme: 'cozy-night', source: { type: 'screen', index: 0 },
  keys: { commit: { kind: 'mouse', code: 4 }, discard: { kind: 'mouse', code: 5 }, toggle: { kind: 'key', code: 120 }, pause: { kind: 'key', code: 121 } },
};
let S, sources = { screens: [], windows: [] }, recording = false, busy = false, listening = null;

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 6000 : 2200);
}
const save = (patch) => { Object.assign(S, patch); return api.setSettings(patch); };

// Botones blanditos: se aplastan y rebotan al pulsarlos.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest?.('button');
  if (!b || b.disabled) return;
  b.classList.remove('squish'); void b.offsetWidth; b.classList.add('squish');
});
document.addEventListener('animationend', (e) => { if (e.animationName === 'squish') e.target.classList.remove('squish'); });

// ---------- nombres de teclas (códigos virtuales de Windows) ----------
const VK = { 8: 'Retroceso', 9: 'Tab', 13: 'Enter', 19: 'Pausa', 20: 'Bloq Mayús', 27: 'Esc', 32: 'Espacio', 33: 'Re Pág', 34: 'Av Pág', 35: 'Fin', 36: 'Inicio',
  37: '←', 38: '↑', 39: '→', 40: '↓', 44: 'Impr Pant', 45: 'Insert', 46: 'Supr', 91: 'Win', 92: 'Win', 93: 'Menú', 106: 'Num *', 107: 'Num +', 109: 'Num -',
  110: 'Num .', 111: 'Num /', 144: 'Bloq Num', 145: 'Bloq Despl', 160: 'Mayús', 161: 'Mayús der.', 162: 'Ctrl', 163: 'Ctrl der.', 164: 'Alt', 165: 'AltGr',
  186: 'Ñ´', 187: '+', 188: ',', 189: '-', 190: '.', 191: 'ç', 192: 'Ñ', 219: "'", 220: 'º', 221: '¡', 222: '´', 226: '<' };
function bindLabel(b) {
  if (!b) return '—';
  if (b.kind === 'mouse') return { 3: 'Rueda (clic)', 4: 'Ratón 4', 5: 'Ratón 5' }[b.code] || 'Ratón ' + b.code;
  const c = b.code;
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) return String.fromCharCode(c);
  if (c >= 96 && c <= 105) return 'Num ' + (c - 96);
  if (c >= 112 && c <= 135) return 'F' + (c - 111);
  return VK[c] || 'Tecla ' + c;
}
const same = (a, b) => a && b && a.kind === b.kind && a.code === b.code;

// ---------- fuentes ----------
const srcKey = (s) => (s.type === 'screen' ? 's:' + s.index : 'w:' + s.hwnd);
async function loadSources() {
  sources = await api.listSources();
  const sel = $('#source');
  sel.innerHTML =
    `<optgroup label="Pantalla">${sources.screens.map((s) => `<option value="${srcKey(s)}">${s.name} · ${s.width}×${s.height}${s.hz ? ' · ' + s.hz + ' Hz' : ''}</option>`).join('')}</optgroup>` +
    `<optgroup label="Aplicación">${sources.windows.map((w) => `<option value="${srcKey(w)}"></option>`).join('')}</optgroup>`;
  // los títulos van por textContent (pueden traer cualquier carácter)
  $$('optgroup[label="Aplicación"] option', sel).forEach((o, i) => (o.textContent = `${sources.windows[i].exe} — ${sources.windows[i].name}`));
  // recupera la fuente guardada (la ventana por su programa si cambió de identificador)
  const s = S.source;
  const match = s.type === 'screen' ? sources.screens[s.index] : sources.windows.find((w) => w.hwnd === s.hwnd) || sources.windows.find((w) => w.exe === s.exe);
  sel.value = srcKey(match || sources.screens[0]);
  await chooseSource(false);
}
function currentSource() {
  const v = $('#source').value;
  return v.startsWith('s:') ? sources.screens[+v.slice(2)] : sources.windows.find((w) => 'w:' + w.hwnd === v);
}
async function chooseSource(persist = true) {
  const s = currentSource();
  if (!s) return;
  if (persist) await save({ source: s.type === 'screen' ? { type: 'screen', index: s.index } : { type: 'window', hwnd: s.hwnd, pid: s.pid, exe: s.exe } });
  $('#soundApp').disabled = s.type !== 'window';
  if (s.type !== 'window' && S.sound === 'app') setSeg('sound', 'desktop');
  startPreview();
}
$('#source').onchange = () => chooseSource();
$('#refresh').onclick = loadSources;

// ---------- vista previa (a 30 FPS y reducida, para no restar rendimiento) ----------
let previewStream = null;
async function startPreview() {
  previewStream?.getTracks().forEach((t) => t.stop());
  previewStream = null;
  const v = $('#preview');
  v.srcObject = null;
  $('#previewOff').hidden = S.preview;
  if (!S.preview) return;
  const s = currentSource();
  if (!s?.id) return;
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: s.id, maxFrameRate: 20, maxWidth: 960, maxHeight: 540 } } });
    v.srcObject = previewStream;
    v.play();
  } catch { $('#previewOff').hidden = false; $('#previewOff').textContent = 'No se puede previsualizar esta ventana'; }
}
$('#previewOn').onchange = (e) => { save({ preview: e.target.checked }); startPreview(); };

// ---------- opciones ----------
function setSeg(id, v) {
  $$(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  save({ [id]: id === 'fps' ? +v : v });
}
$$('#sound button, #fps button').forEach((b) => (b.onclick = () => setSeg(b.parentElement.id, b.dataset.v)));
$('#mic').onchange = (e) => save({ mic: e.target.checked });
$('#pickFolder').onclick = async () => { const f = await api.pickFolder(); if (f) $('#folder').textContent = f; };
$('#openFolder').onclick = () => api.openFolder();

function renderKeys() {
  $$('[data-key]').forEach((b) => { b.textContent = listening === b.dataset.key ? 'Pulsa tecla o botón…' : bindLabel(S.keys[b.dataset.key]); b.classList.toggle('listen', listening === b.dataset.key); });
  $('#kCommit').textContent = bindLabel(S.keys.commit);
  $('#kDiscard').textContent = bindLabel(S.keys.discard);
}
$$('[data-key]').forEach((b) => (b.onclick = () => { if (!recording) { listening = b.dataset.key; renderKeys(); } }));

// ---------- grabar ----------
function setOptionsEnabled(on) {
  $$('.opts button, .opts select, .opts input').forEach((el) => (el.disabled = !on));
  if (on) $('#soundApp').disabled = currentSource()?.type !== 'window';
}
async function toggleRec() {
  if (busy) return;
  if (recording) return api.stop();
  const s = currentSource();
  if (!s) return toast('Elige qué grabar', true);
  $('#result').hidden = true;
  try {
    await api.start({ source: s, fps: S.fps, sound: S.sound, mic: S.mic, width: s.width || 1920, height: s.height || 1080 });
  } catch (e) { toast(e.message.replace(/^.*Error: /, ''), true); }
}
$('#recBtn').onclick = toggleRec;
$('#pauseBtn').onclick = () => recording && api.pause();

function flash(id) { const k = $(id).parentElement; k.classList.remove('flash'); void k.offsetWidth; k.classList.add('flash'); }

api.onInput((ev) => {
  const b = { kind: ev.kind, code: ev.code };
  if (listening) {
    if (!(b.kind === 'key' && b.code === 27)) {
      const other = Object.keys(S.keys).find((k) => k !== listening && same(S.keys[k], b));
      if (other) S.keys[other] = S.keys[listening]; // si ya estaba usada, se intercambian
      S.keys[listening] = b;
      save({ keys: S.keys });
    }
    listening = null;
    return renderKeys();
  }
  if (same(b, S.keys.toggle)) return toggleRec();
  if (!recording) return;
  if (same(b, S.keys.pause)) return api.pause();
  if (same(b, S.keys.commit)) api.mark(true);
  else if (same(b, S.keys.discard)) api.mark(false);
});

api.onState((st) => {
  recording = !!st.recording;
  busy = !!st.busy;
  document.body.classList.toggle('recording', recording);
  if (!recording) document.body.classList.remove('paused');
  $('#pauseBtn').disabled = !recording;
  setOptionsEnabled(!recording && !busy);
  $('#recBtn').title = recording ? 'Detener' : 'Grabar';
  if (recording) { $('#timer').textContent = '00:00'; $('#info').textContent = `Grabando · ${S.fps} FPS · ${st.encoder}`; }
  if (busy) $('#info').textContent = 'Guardando el vídeo…';
});
api.onTime((t) => {
  document.body.classList.toggle('paused', !!t.paused);
  $('#pauseBtn').title = t.paused ? 'Reanudar' : 'Pausar';
  $('#timer').textContent = fmt(t.t);
  $('#info').textContent = (t.paused ? '⏸ En pausa · ' : '') + `Guardado ${fmt(t.saved)} · sin guardar ${fmt(t.pending)} · ${t.takes} ${t.takes === 1 ? 'toma' : 'tomas'}`;
  const total = Math.max(1, t.saved + t.pending);
  $('#barSaved').style.width = (t.saved / total) * 100 + '%';
  $('#barPending').style.width = (t.pending / total) * 100 + '%';
});
api.onMark(({ keep }) => {
  flash(keep ? '#kCommit' : '#kDiscard');
  toast(keep ? '✓ Guardado hasta aquí' : '↺ Borrado lo no guardado');
});
api.onDone((r) => {
  busy = false; recording = false;
  document.body.classList.remove('recording', 'paused');
  $('#pauseBtn').disabled = true;
  setOptionsEnabled(true);
  $('#barSaved').style.width = $('#barPending').style.width = '0';
  const box = $('#result');
  box.hidden = false;
  if (r.error) { box.innerHTML = '<span>⚠️</span><b></b>'; $('b', box).textContent = r.error; $('#info').textContent = 'Error al grabar'; return; }
  if (r.empty) { box.innerHTML = '<span>🗑</span><b>Todo estaba borrado: no se guardó ningún vídeo.</b>'; $('#info').textContent = 'Listo'; return; }
  box.innerHTML = '<span>🎬</span><b></b><button class="ghost sm">Mostrar en carpeta</button>';
  $('b', box).textContent = `${r.file.split('\\').pop()} · ${fmt(r.seconds)}`;
  $('button', box).onclick = () => api.openFolder(r.file);
  $('button', box).dataset.file = r.file;
  $('#info').textContent = 'Listo';
});
api.onNotice((m) => toast(m, true));

// ---------- inicio ----------
(async () => {
  const saved = await api.getSettings();
  S = { ...DEFAULTS, ...saved, keys: { ...DEFAULTS.keys, ...(saved.keys || {}) } };
  ThemePicker.mount($('#themes'), S.theme, (id) => save({ theme: id }));
  $('#folder').textContent = S.folder;
  $('#mic').checked = S.mic;
  $('#previewOn').checked = S.preview;
  $$('#sound button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.sound));
  $$('#fps button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(S.fps)));
  renderKeys();
  await loadSources();
  $('#donateBtn').onclick = () => api.donate();
  Support.show({ name: 'CaptLY', logo: 'logo.png', onDonate: () => api.donate() });
  const tools = await api.getTools();
  if (!tools.ffmpeg) toast('Falta ffmpeg. Instálalo con: winget install Gyan.FFmpeg', true);
})();
