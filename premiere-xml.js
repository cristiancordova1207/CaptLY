// Exporta una edición a Premiere Pro como XML de Final Cut Pro 7 (Archivo > Importar en Premiere).
// No renderiza nada: la secuencia apunta al archivo original con cada clip recortado y colocado en su sitio.
//
// buildPremiereXml({
//   name: 'Mi edición',            // nombre de la secuencia
//   fps: 60,                       // base de tiempo (fotogramas por segundo)
//   file: { path, duration },      // archivo original (ruta absoluta) y su duración en segundos
//   video: { width, height } | null,
//   audio: { rate: 48000, channels: 2 } | null,
//   clips: [{ s, e, t, gain = 1, fi = 0, fo = 0 }],  // segundos: inicio/fin en el original, posición en la secuencia,
// })                                                   // volumen lineal y duración de los fundidos
const path = require('path');

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const pathUrl = (p) => 'file://localhost/' + path.resolve(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');

function buildPremiereXml({ name, fps, file, video, audio, clips }) {
  const tb = Math.max(1, Math.round(fps));
  const F = (sec) => Math.round(sec * tb);
  const rate = `<rate><timebase>${tb}</timebase><ntsc>FALSE</ntsc></rate>`;
  const fileName = path.basename(file.path);
  const fileFrames = F(file.duration);
  const items = clips
    .map((c) => ({ ...c, start: F(c.t), in: F(c.s), len: F(c.e) - F(c.s) }))
    .filter((c) => c.len > 0)
    .sort((a, b) => a.start - b.start);
  // Evita solapes por redondeo: cada clip empieza como pronto donde acaba el anterior
  for (let i = 1; i < items.length; i++) {
    const prevEnd = items[i - 1].start + items[i - 1].len;
    if (items[i].start < prevEnd) items[i].start = prevEnd;
  }
  const total = items.reduce((m, c) => Math.max(m, c.start + c.len), 0);
  const ch = audio?.channels || 2;

  const fileXml = () => `<file id="file-1">
            <name>${esc(fileName)}</name>
            <pathurl>${esc(pathUrl(file.path))}</pathurl>
            ${rate}
            <duration>${fileFrames}</duration>
            <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
            <media>${video ? `
              <video><samplecharacteristics>${rate}<width>${video.width}</width><height>${video.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : ''}${audio ? `
              <audio><samplecharacteristics><depth>16</depth><samplerate>${audio.rate}</samplerate></samplecharacteristics><channelcount>${ch}</channelcount></audio>` : ''}
            </media>
          </file>`;
  let fileWritten = false;
  const fileRef = () => (fileWritten ? '<file id="file-1"/>' : ((fileWritten = true), fileXml()));

  const links = (i) => [
    video && `<link><linkclipref>v-${i + 1}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>${i + 1}</clipindex></link>`,
    audio && `<link><linkclipref>a-${i + 1}</linkclipref><mediatype>audio</mediatype><trackindex>1</trackindex><clipindex>${i + 1}</clipindex><groupindex>1</groupindex></link>`,
  ].filter(Boolean).join('\n          ');
  const clipItem = (c, i, kind) => `
        <clipitem id="${kind}-${i + 1}">
          <masterclipid>masterclip-1</masterclipid>
          <name>${esc(fileName)}</name>
          <enabled>TRUE</enabled>
          <duration>${fileFrames}</duration>
          ${rate}
          <start>${c.start}</start>
          <end>${c.start + c.len}</end>
          <in>${c.in}</in>
          <out>${c.in + c.len}</out>
          ${fileRef()}${kind === 'a' ? `
          <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          <filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>
            <parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${Math.min(3.98109, Math.max(0, c.gain ?? 1)).toFixed(5)}</value></parameter>
          </effect></filter>` : ''}
          ${links(i)}
        </clipitem>`;
  // Fundido desde/hacia negro (o silencio) en el borde de un clip
  const fade = (c, kind, where) => {
    const n = Math.min(c.len, F(where === 'in' ? c.fi || 0 : c.fo || 0));
    if (n < 1) return '';
    const [st, en] = where === 'in' ? [c.start, c.start + n] : [c.start + c.len - n, c.start + c.len];
    const effect = kind === 'v'
      ? '<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype><wipecode>0</wipecode><wipeaccuracy>100</wipeaccuracy><startratio>0</startratio><endratio>1</endratio><reverse>FALSE</reverse></effect>'
      : '<effect><name>Cross Fade (0dB)</name><effectid>KGAudioTransCrossFade0dB</effectid><effecttype>transition</effecttype><mediatype>audio</mediatype></effect>';
    return `
        <transitionitem>${rate}<start>${st}</start><end>${en}</end><alignment>${where === 'in' ? 'start-black' : 'end-black'}</alignment>${effect}</transitionitem>`;
  };
  const track = (kind) => items.map((c, i) => fade(c, kind, 'in') + clipItem(c, i, kind) + fade(c, kind, 'out')).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${esc(name)}</name>
    <duration>${total}</duration>
    ${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${video?.width || 1920}</width><height>${video?.height || 1080}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>${video ? `
        <track>${track('v')}
          <enabled>TRUE</enabled><locked>FALSE</locked>
        </track>` : ''}
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format><samplecharacteristics><depth>16</depth><samplerate>${audio?.rate || 48000}</samplerate></samplecharacteristics></format>${audio ? `
        <track premiereTrackType="${ch === 1 ? 'Mono' : 'Stereo'}">${track('a')}
          <enabled>TRUE</enabled><locked>FALSE</locked>
        </track>` : ''}
      </audio>
    </media>
  </sequence>
</xmeml>
`;
}

module.exports = { buildPremiereXml, pathUrl };

if (require.main === module) {
  const assert = require('assert');
  const xml = buildPremiereXml({
    name: 'Prueba & co', fps: 60, file: { path: 'C:\\Users\\RAM\\Vídeos\\Grabación 1.mp4', duration: 10 },
    video: { width: 1920, height: 1080 }, audio: { rate: 48000, channels: 2 },
    clips: [{ s: 2, e: 4, t: 0, gain: 0.5, fi: 0.5 }, { s: 6, e: 7.5, t: 3, fo: 1 }],
  });
  assert.ok(xml.includes('<pathurl>file://localhost/C%3A/Users/RAM/V%C3%ADdeos/Grabaci%C3%B3n%201.mp4</pathurl>'));
  assert.ok(xml.includes('<name>Prueba &amp; co</name>'));
  assert.strictEqual((xml.match(/<clipitem /g) || []).length, 4);                 // 2 de vídeo + 2 de audio
  assert.ok(/<clipitem id="v-1">[\s\S]*?<start>0<\/start>\s*<end>120<\/end>\s*<in>120<\/in>\s*<out>240<\/out>/.test(xml));
  assert.ok(/<clipitem id="v-2">[\s\S]*?<start>180<\/start>\s*<end>270<\/end>\s*<in>360<\/in>\s*<out>450<\/out>/.test(xml));
  assert.ok(xml.includes('<value>0.50000</value>'));
  assert.strictEqual((xml.match(/<transitionitem>/g) || []).length, 4);             // fade-in y fade-out en vídeo y audio
  assert.ok(xml.includes('<start>0</start><end>30</end><alignment>start-black</alignment>'));
  assert.ok(xml.includes('<start>210</start><end>270</end><alignment>end-black</alignment>'));
  assert.strictEqual((xml.match(/<file id="file-1">/g) || []).length, 1);           // el archivo se define una sola vez
  const audioOnly = buildPremiereXml({ name: 'Voz', fps: 60, file: { path: 'C:\\a.wav', duration: 5 }, video: null, audio: { rate: 48000, channels: 1 }, clips: [{ s: 0, e: 5, t: 0 }] });
  assert.ok(audioOnly.includes('premiereTrackType="Mono"') && !audioOnly.includes('id="v-1"'));
  console.log('premiere-xml.js ok');
}
