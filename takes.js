// Tomas: cada marca { t, keep } decide qué pasa con lo grabado desde la marca anterior.
// Lo que queda después de la última marca se guarda al detener.
function spans(marks, end) {
  const out = [];
  let a = 0;
  for (const m of marks) { out.push({ a, b: m.t, keep: m.keep }); a = m.t; }
  out.push({ a, b: end, keep: true });
  return out;
}
// Un trozo de vídeo { a, b } se guarda si su punto medio cae en un tramo guardado y no en una pausa [a, b).
function keepSeg(sp, s, pauses = []) {
  const mid = (s.a + s.b) / 2;
  if (pauses.some(([a, b]) => mid >= a && mid < b)) return false;
  return !!sp.find((x) => mid >= x.a && mid < x.b)?.keep;
}
// Segundos en pausa dentro de [a, b); una pausa abierta termina en `now`.
const pausedIn = (pauses, a, b, now) =>
  pauses.reduce((sum, [p, q]) => sum + Math.max(0, Math.min(b, q === Infinity ? now : q) - Math.max(a, p)), 0);
module.exports = { spans, keepSeg, pausedIn };

if (require.main === module) {
  const assert = require('assert');
  // grabo 0-2 s y guardo (botón 4), me equivoco 2-3.5 s y borro (botón 5), sigo hasta 5 s y detengo
  const sp = spans([{ t: 2, keep: true }, { t: 3.5, keep: false }], Infinity);
  const segs = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].map((a) => ({ a, b: a + 0.5 }));
  assert.deepStrictEqual(segs.filter((s) => keepSeg(sp, s)).map((s) => s.a), [0, 0.5, 1, 1.5, 3.5, 4, 4.5]);
  // sin marcas se guarda todo
  assert.ok(segs.every((s) => keepSeg(spans([], Infinity), s)));
  // borrar dos veces seguidas solo quita lo no guardado
  const sp2 = spans([{ t: 1, keep: false }, { t: 2, keep: false }], Infinity);
  assert.deepStrictEqual(segs.filter((s) => keepSeg(sp2, s)).map((s) => s.a), [2, 2.5, 3, 3.5, 4, 4.5]);
  // pausa de 1 a 2 s: esos trozos no entran aunque luego se guarde
  assert.deepStrictEqual(segs.filter((s) => keepSeg(spans([], Infinity), s, [[1, 2]])).map((s) => s.a), [0, 0.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  assert.strictEqual(pausedIn([[1, 2], [3, Infinity]], 0, 10, 4), 2);
  console.log('takes.js ok');
}
