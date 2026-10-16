const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, shell } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { spans, keepSeg, pausedIn } = require('./takes');

let win;
let settings = {};
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const resource = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, ...p));
const HELPER = () => resource('helper', 'VrHelper.exe');
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

// Web de Fluxy: descargas, donaciones y estadísticas anónimas.
const SITE = 'https://fluxy-8yg.pages.dev';
const APP_ID = 'captly';

function loadSettings() {
  // VidRecorder OS pasó a llamarse CaptLY: se traen sus ajustes la primera vez
  const old = path.join(app.getPath('appData'), 'VidRecorder OS', 'settings.json');
  if (!fs.existsSync(settingsFile()) && fs.existsSync(old)) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.copyFileSync(old, settingsFile()); }
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { settings = {}; }
  settings.folder ??= path.join(app.getPath('videos'), 'CaptLY');
  fs.mkdirSync(settings.folder, { recursive: true });
}
const saveSettings = () => fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));

// Aviso anónimo para las estadísticas (instalación la primera vez, apertura las siguientes). Sin datos personales:
// un identificador aleatorio de esta instalación, la versión y Windows; el país lo pone Cloudflare.
function ping() {
  const kind = settings.installId ? 'open' : 'install';
  settings.installId ??= crypto.randomUUID();
  saveSettings();
  fetch(SITE + '/api/event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: APP_ID, kind, version: app.getVersion(), os: `Windows ${os.release()}`, install_id: settings.installId }),
  }).catch(() => {});
}

// ---------- ffmpeg y codificador ----------
function findFfmpeg() {
  const cands = [settings.ffmpeg];
  try { cands.push(...execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)); } catch {}
  const wg = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(wg).filter((d) => /ffmpeg/i.test(d)))
      for (const b of fs.readdirSync(path.join(wg, d))) cands.push(path.join(wg, d, b, 'bin', 'ffmpeg.exe'));
  } catch {}
  return cands.find((c) => c && fs.existsSync(c.trim()))?.trim() || null;
}
// Codificadores por hardware primero (AMD, NVIDIA, Intel); libx264 si no hay ninguno.
// Calidad constante como en OBS (CQP 15, preajuste "Calidad"): nítido aunque haya mucho movimiento.
const QP = '15';
const ENCODERS = [
  ['hevc_amf', (g) => ['-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', QP, '-qp_p', QP, '-forced_idr', '1', '-g', g]],
  ['hevc_nvenc', (g) => ['-preset', 'p5', '-tune', 'hq', '-rc', 'constqp', '-qp', QP, '-forced-idr', '1', '-g', g]],
  ['hevc_qsv', (g) => ['-preset', 'medium', '-q', QP, '-forced_idr', '1', '-g', g]],
  ['h264_amf', (g) => ['-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', QP, '-qp_p', QP, '-qp_b', QP, '-forced_idr', '1', '-g', g]],
  ['h264_nvenc', (g) => ['-preset', 'p5', '-tune', 'hq', '-rc', 'constqp', '-qp', QP, '-forced-idr', '1', '-g', g]],
  ['libx264', (g) => ['-preset', 'veryfast', '-crf', '18', '-g', g]],
];
let tools = null;
function detectTools() {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return (tools = { ffmpeg: null });
  let list = '';
  try { list = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true }); } catch {}
  const enc = ENCODERS.find(([n]) => new RegExp(`\\b${n}\\b`).test(list)) || ENCODERS.at(-1);
  return (tools = { ffmpeg, encoder: enc[0], encArgs: enc[1] });
}

// ---------- ayudante nativo ----------
let hooks = null;
function startHooks() {
  hooks = spawn(HELPER(), ['hooks'], { windowsHide: true });
  let buf = '';
  hooks.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const [kind, val] = buf.slice(0, i).trim().split(' ');
      buf = buf.slice(i + 1);
      if (kind) send('input', { kind, code: +val });
    }
  });
  hooks.on('exit', () => { hooks = null; });
}
function listWindows() {
  try {
    return execFileSync(HELPER(), ['windows'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
      .filter((w) => w.pid !== process.pid && !/^(CaptLY|Program Manager)$/.test(w.title));
  } catch { return []; }
}

// ---------- grabación ----------
// ffmpeg graba en trozos de 0,5 s. Cada marca (guardar / borrar) decide qué pasa con lo grabado desde la marca anterior;
// al detener se unen los trozos guardados sin recodificar.
let rec = null;
const SEG = 0.5;

function startRecording(o) {
  if (rec) return;
  detectTools();
  if (!tools.ffmpeg) throw new Error('No encontré ffmpeg. Instálalo con: winget install Gyan.FFmpeg');
  const stamp = new Date();
  const tmp = path.join(settings.folder, `.vr-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const fps = o.fps;
  const gop = String(Math.max(1, Math.round(fps * SEG)));

  const audio = [];
  if (o.mic) audio.push('mic');
  if (o.sound === 'desktop') audio.push('desktop');
  if (o.sound === 'app' && o.source.pid) audio.push('app', String(o.source.pid));

  let src = o.source.type === 'window'
    ? `gfxcapture=hwnd=${o.source.hwnd}:max_framerate=${fps}:capture_cursor=1`
    : `ddagrab=output_idx=${o.source.index}:framerate=${fps}:dup_frames=0:draw_mouse=1`;
  if (tools.encoder === 'libx264') src += ',hwdownload,format=bgra';
  // Windows no da imagen de una ventana minimizada: se restaura (sin quitarte el foco)
  if (o.source.type === 'window') try { execFileSync(HELPER(), ['restore', String(o.source.hwnd)], { windowsHide: true }); } catch {}

  const r = (rec = { tmp, stamp, marks: [], pauses: [], outTime: 0, outAt: Date.now(), helper: null, server: null, ff: null, stopping: false });
  const launch = (pipeName) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-init_hw_device', 'd3d11va'];
    if (pipeName) args.push('-f', 's16le', '-ar', '48000', '-ac', '2', '-thread_queue_size', '8192', '-i', pipeName);
    args.push('-filter_complex', `${src}[v]`, '-map', '[v]');
    if (pipeName) args.push('-map', '0:a', '-c:a', 'aac', '-b:a', '192k');
    args.push('-c:v', tools.encoder, ...tools.encArgs(gop), '-force_key_frames', `expr:gte(t,n_forced*${SEG})`,
      '-f', 'segment', '-segment_time', String(SEG), '-segment_format', 'matroska', '-reset_timestamps', '1',
      '-segment_list', path.join(tmp, 'segs.csv'), '-segment_list_type', 'csv', path.join(tmp, 'seg%06d.mkv'));
    r.ff = spawn(tools.ffmpeg, args, { windowsHide: true });
    let err = '';
    r.ff.stderr.on('data', (d) => (err += d.toString()));
    r.ff.stdout.on('data', (d) => {
      const m = d.toString().match(/out_time_us=(\d+)/g);
      if (m) { r.outTime = +m.at(-1).split('=')[1] / 1e6; r.outAt = Date.now(); send('rec-time', recState()); }
    });
    r.ff.on('close', (code) => finish(r, code, err));
    // si en unos segundos no llega ni un fotograma, se avisa en vez de quedarse colgado
    setTimeout(() => { if (rec === r && !r.outTime && !r.stopping) { r.noFrames = true; stopRecording(); } }, 7000);
  };
  if (audio.length) {
    r.helper = spawn(HELPER(), ['audio', ...audio], { windowsHide: true });
    r.helper.stderr.on('data', (d) => send('notice', d.toString().trim()));
    const pipeName = String.raw`\\.\pipe\vidrecorder-` + process.pid + '-' + Date.now();
    r.server = net.createServer((sock) => { r.helper.stdout.pipe(sock); sock.on('error', () => {}); }).listen(pipeName, () => launch(pipeName));
  } else launch(null);
  send('rec-state', { recording: true, encoder: tools.encoder });
}

const nowT = () => (rec ? rec.outTime + Math.min(1, (Date.now() - rec.outAt) / 1000) : 0);
const lastMark = () => (rec.marks.length ? rec.marks.at(-1).t : 0);
function recState() {
  const now = nowT(), P = (a, b) => pausedIn(rec.pauses, a, b, now);
  const saved = spans(rec.marks, lastMark()).filter((s) => s.keep).reduce((a, s) => a + (s.b - s.a) - P(s.a, s.b), 0);
  return { t: now - P(0, now), saved, pending: now - lastMark() - P(lastMark(), now), takes: rec.marks.filter((m) => m.keep).length, paused: isPaused() };
}
const isPaused = () => !!rec?.pauses.length && rec.pauses.at(-1)[1] === Infinity;
// La pausa no detiene ffmpeg (así no hay saltos al reanudar): lo grabado en pausa se descarta al unir.
function togglePause() {
  if (!rec || rec.stopping) return;
  if (isPaused()) rec.pauses.at(-1)[1] = nowT();
  else rec.pauses.push([nowT(), Infinity]);
  send('rec-time', recState());
}
function readSegments(r) {
  try {
    return fs.readFileSync(path.join(r.tmp, 'segs.csv'), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { const [file, a, b] = l.split(','); return { file: path.join(r.tmp, file), a: +a, b: +b }; });
  } catch { return []; }
}

function mark(keep) {
  if (!rec || rec.stopping) return;
  const t = nowT();
  if (t - lastMark() < 0.05) return;
  rec.marks.push({ t, keep });
  if (!keep) {
    // lo descartado se borra ya del disco
    const sp = spans(rec.marks, t);
    for (const s of readSegments(rec)) if (s.b <= t && !keepSeg(sp, s, rec.pauses)) fs.rm(s.file, { force: true }, () => {});
  }
  send('rec-time', recState());
  send('mark', { keep });
}

function stopRecording() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.end = nowT();
  if (isPaused()) rec.pauses.at(-1)[1] = rec.end;
  send('rec-state', { recording: false, busy: true });
  try { rec.ff.stdin.write('q'); } catch { rec.ff.kill(); }
}

async function finish(r, code, err) {
  r.helper?.stdin.end();
  r.server?.close();
  rec = null;
  const sp = spans(r.marks, Infinity);
  const segs = readSegments(r).filter((s) => keepSeg(sp, s, r.pauses) && fs.existsSync(s.file));
  if (!segs.length) {
    fs.rmSync(r.tmp, { recursive: true, force: true });
    if (r.noFrames) return send('rec-done', { error: 'Esa ventana no está enviando imagen. Ábrela (que no esté minimizada) o graba la pantalla.' });
    return send('rec-done', code === 0 || r.stopping ? { empty: true } : { error: err.trim().split('\n').pop() || 'ffmpeg se cerró' });
  }
  const p2 = (n) => String(n).padStart(2, '0'), d = r.stamp;
  let out = path.join(settings.folder, `Grabación ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}.mp4`);
  const list = path.join(r.tmp, 'list.txt');
  // la duración exacta de cada trozo evita que se acumule desfase al unir miles de trozos
  fs.writeFileSync(list, segs.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'\nduration ${(s.b - s.a).toFixed(6)}`).join('\n'));
  const join = spawn(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
    ...(tools.encoder.startsWith('hevc') ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart', out], { windowsHide: true });
  let jerr = '';
  join.stderr.on('data', (x) => (jerr += x));
  join.on('close', (c) => {
    if (c === 0) {
      fs.rmSync(r.tmp, { recursive: true, force: true });
      send('rec-done', { file: out, seconds: segs.reduce((a, s) => a + (s.b - s.a), 0) });
    } else send('rec-done', { error: 'No se pudieron unir los trozos (están en ' + r.tmp + '): ' + jerr.trim().split('\n').pop() });
  });
}

// ---------- IPC ----------
const handlers = {
  'settings:get': () => settings,
  'settings:set': (patch) => { Object.assign(settings, patch); saveSettings(); return settings; },
  'tools:get': () => { const t = detectTools(); return { ffmpeg: t.ffmpeg, encoder: t.encoder }; },
  'sources:list': async () => {
    const displays = screen.getAllDisplays();
    const shots = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    return {
      screens: displays.map((d, i) => ({
        type: 'screen', index: i, id: shots.find((s) => s.display_id === String(d.id))?.id || shots[i]?.id,
        name: `Pantalla ${i + 1}`, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor),
        hz: d.displayFrequency,
      })),
      windows: listWindows().map((w) => ({ type: 'window', hwnd: w.hwnd, pid: w.pid, exe: w.exe, name: w.title, id: `window:${w.hwnd}:0` })),
    };
  },
  'rec:start': (o) => startRecording(o),
  'rec:stop': () => stopRecording(),
  'rec:mark': (keep) => mark(keep),
  'rec:pause': () => togglePause(),
  'donate:open': () => shell.openExternal(`${SITE}/donar?app=${APP_ID}`),
  'folder:pick': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.folder });
    if (r.canceled) return null;
    settings.folder = r.filePaths[0]; saveSettings();
    return settings.folder;
  },
  // Pestaña nueva en el Explorador que tenga más pestañas (igual que MicRecorder OS).
  'folder:open': (file) => {
    if (file) return shell.showItemInFolder(file);
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resource('explorer-tab.ps1'), '-Path', settings.folder], { windowsHide: true, stdio: 'ignore' });
  },
};
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...a) => fn(...a));

app.whenReady().then(() => {
  loadSettings();
  ping();
  startHooks();
  win = new BrowserWindow({
    width: 1100, height: 800, minWidth: 900, minHeight: 640, backgroundColor: '#121016', title: 'CaptLY', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('close', (e) => {
    if (!rec) return;
    e.preventDefault();
    stopRecording();
    const t = setInterval(() => { if (!rec) { clearInterval(t); win.destroy(); } }, 200);
  });
});
app.on('window-all-closed', () => { hooks?.stdin.end(); app.quit(); });
