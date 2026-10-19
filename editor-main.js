// Editor de vídeo de CaptLY (proceso principal): abrir, miniaturas, onda de audio, exportar MP4 y exportar a Premiere.
const { dialog, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { buildPremiereXml } = require('./premiere-xml');

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 1 << 30, encoding: opts.encoding || 'utf8' }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim().split('\n').pop())) : resolve(out));
  });
}

function register(ipcMain, { getWin, getTools, getFolder, send }) {
  const ffprobe = () => getTools().ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  const cacheDir = () => path.join(require('electron').app.getPath('userData'), 'editor-cache');

  async function probe(file) {
    const j = JSON.parse(await run(ffprobe(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
    const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
    if (!v) throw new Error('Ese archivo no tiene vídeo');
    const [n, d] = String(v.r_frame_rate || '60/1').split('/').map(Number);
    return {
      path: file, url: pathToFileURL(file).href, name: path.basename(file),
      duration: +j.format.duration, fps: Math.max(1, Math.round(n / (d || 1))), width: v.width, height: v.height,
      audio: a ? { rate: +a.sample_rate || 48000, channels: a.channels || 2 } : null,
    };
  }

  const handlers = {
    'editor:pick': async () => {
      const r = await dialog.showOpenDialog(getWin(), {
        title: 'Abrir vídeo para editar', defaultPath: getFolder(), properties: ['openFile'],
        filters: [{ name: 'Vídeo', extensions: ['mp4', 'mkv', 'mov', 'webm'] }],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    'editor:probe': (file) => probe(file),
    // Tira de miniaturas: solo fotogramas clave (CaptLY pone uno cada 0,5 s), así es casi instantáneo.
    'editor:thumbs': async (file, duration) => {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const st = fs.statSync(file);
      const key = crypto.createHash('md5').update(file + st.size + st.mtimeMs).digest('hex');
      const n = Math.min(240, Math.max(1, Math.ceil(duration)));
      const iv = duration / n, cols = 20, rows = Math.ceil(n / cols), w = 160, h = 90;
      const out = path.join(cacheDir(), key + '.jpg');
      if (!fs.existsSync(out)) {
        await run(getTools().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', file, '-an',
          '-vf', `fps=1/${iv.toFixed(4)},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:-1:-1,tile=${cols}x${rows}`,
          '-frames:v', '1', '-q:v', '5', out]);
      }
      return { url: pathToFileURL(out).href, iv, n, cols, w, h };
    },
    // Onda del audio: mono a 4 kHz, suficiente para dibujar
    'editor:wave': async (file) => {
      const buf = await run(getTools().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '4000', '-f', 'f32le', '-'], { encoding: 'buffer' });
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    // Proyecto para Premiere Pro: .xml que apunta al vídeo original (sin renderizar)
    'editor:premiere': async (info, clips) => {
      const r = process.env.FLUXY_XML_OUT ? { filePath: process.env.FLUXY_XML_OUT } : await dialog.showSaveDialog(getWin(), {
        title: 'Exportar a Premiere Pro', defaultPath: info.path.replace(/\.[^.]+$/, ' (Premiere).xml'),
        filters: [{ name: 'XML de Premiere / Final Cut Pro 7', extensions: ['xml'] }],
      });
      if (r.canceled) return null;
      const xml = buildPremiereXml({
        name: path.basename(info.path).replace(/\.[^.]+$/, ''), fps: info.fps, file: { path: info.path, duration: info.duration },
        video: { width: info.width, height: info.height }, audio: info.audio, clips,
      });
      fs.writeFileSync(r.filePath, xml, 'utf8');
      shell.showItemInFolder(r.filePath);
      return r.filePath;
    },
    // MP4 final con cortes, huecos en negro, fades y volumen
    'editor:render': async (info, clips) => {
      const r = process.env.FLUXY_MP4_OUT ? { filePath: process.env.FLUXY_MP4_OUT } : await dialog.showSaveDialog(getWin(), {
        title: 'Exportar vídeo', defaultPath: info.path.replace(/\.[^.]+$/, ' (editado).mp4'),
        filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
      });
      if (r.canceled) return null;
      const tools = getTools(), W = info.width, H = info.height, FPS = info.fps;
      const list = [...clips].sort((a, b) => a.t - b.t);
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1'];
      const parts = [], labels = [];
      let prevEnd = 0, k = 0;
      const gap = (d) => {
        parts.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${d.toFixed(4)},format=yuv420p[g${k}v]`, `anullsrc=r=48000:cl=stereo,atrim=0:${d.toFixed(4)}[g${k}a]`);
        labels.push(`[g${k}v][g${k}a]`); k++;
      };
      list.forEach((c, i) => {
        const len = c.e - c.s;
        if (c.t - prevEnd > 0.5 / FPS) gap(c.t - prevEnd);
        args.push('-ss', c.s.toFixed(4), '-t', len.toFixed(4), '-i', info.path);
        const vf = [`setpts=PTS-STARTPTS`, `fps=${FPS}`, `scale=${W}:${H}`, 'format=yuv420p'];
        if (c.fi > 0) vf.push(`fade=t=in:st=0:d=${c.fi.toFixed(3)}`);
        if (c.fo > 0) vf.push(`fade=t=out:st=${(len - c.fo).toFixed(3)}:d=${c.fo.toFixed(3)}`);
        parts.push(`[${i}:v]${vf.join(',')},trim=duration=${len.toFixed(4)}[c${i}v]`);
        const af = [info.audio ? `[${i}:a]asetpts=PTS-STARTPTS,aresample=48000` : `anullsrc=r=48000:cl=stereo`, `volume=${(c.gain ?? 1).toFixed(4)}`];
        if (c.fi > 0) af.push(`afade=t=in:st=0:d=${c.fi.toFixed(3)}`);
        if (c.fo > 0) af.push(`afade=t=out:st=${(len - c.fo).toFixed(3)}:d=${c.fo.toFixed(3)}`);
        parts.push(`${af.join(',')},apad,atrim=0:${len.toFixed(4)}[c${i}a]`);
        labels.push(`[c${i}v][c${i}a]`);
        prevEnd = c.t + len;
      });
      parts.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=1[vo][ao]`);
      args.push('-filter_complex', parts.join(';'), '-map', '[vo]', '-map', '[ao]',
        '-c:v', tools.encoder, ...tools.encArgs(String(FPS * 2)), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', r.filePath);
      const total = prevEnd;
      await new Promise((resolve, reject) => {
        const p = spawn(tools.ffmpeg, args, { windowsHide: true });
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        p.stdout.on('data', (d) => {
          const m = String(d).match(/out_time_us=(\d+)/g);
          if (m) send('editor-progress', Math.min(1, +m.at(-1).split('=')[1] / 1e6 / total));
        });
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg falló'))));
      });
      shell.showItemInFolder(r.filePath);
      return r.filePath;
    },
  };
  for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...a) => fn(...a));
}

module.exports = { register };
