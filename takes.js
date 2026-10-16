// Tomas: cada marca { t, keep } decide qué pasa con lo grabado desde la marca anterior.
// Lo que queda después de la última marca se guarda al detener.
function spans(marks, end) {
  const out = [];
  let a = 0;
  for (const m of marks) { out.push({ a, b: m.t, keep: m.keep }); a = m.t; }
  out.push({ a, b: end, keep: true });
  return out;
}
// Un trozo de vídeo { a, b } se guarda si su punto medio cae en un tramo guardado.
function keepSeg(sp, s) {
  const mid = (s.a + s.b) / 2;
  return !!sp.find((x) => mid >= x.a && mid < x.b)?.keep;
}
module.exports = { spans, keepSeg };

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
  console.log('takes.js ok');
}
