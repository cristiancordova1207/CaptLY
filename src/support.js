// Ventana "¿Quieres apoyar el proyecto?" de los programas de Fluxy. Usa los tokens de themes.css.
// Uso: Support.show({ name: 'CaptLY', logo: 'icon.png', onDonate }) — se muestra al abrir el programa.
(function () {
  const css = `
.sp-bg { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(10,8,14,.45); animation: sp-fade .3s ease; }
.sp-card { width: 380px; max-width: calc(100vw - 32px); background: var(--panel); color: var(--text); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 26px; padding: 26px 24px 20px; text-align: center; box-shadow: 0 24px 60px -20px rgba(0,0,0,.55); animation: sp-jelly .7s cubic-bezier(.34,1.56,.64,1); font-family: Inter, system-ui, sans-serif; }
.sp-card img { width: 72px; height: 72px; border-radius: 20px; animation: sp-bob 2.6s ease-in-out infinite; }
.sp-card h2 { margin: 14px 0 6px; font-size: 19px; }
.sp-card p { margin: 0 0 18px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
.sp-row { display: flex; gap: 10px; justify-content: center; }
.sp-row button { border: 0; cursor: pointer; font: 600 14px Inter, system-ui, sans-serif; border-radius: 999px; padding: 11px 20px; transition: transform .45s cubic-bezier(.34,1.56,.64,1); }
.sp-row button:hover { transform: translateY(-2px) scale(1.05); }
.sp-row button:active { transform: scale(1.1, .86); transition-duration: .08s; }
.sp-yes { background: var(--grad); color: var(--on-accent); box-shadow: inset 0 2px 0 rgba(255,255,255,.35), 0 8px 20px -8px var(--violet); }
.sp-no { background: var(--panel2); color: var(--text); }
.sp-hearts { position: relative; height: 0; }
.sp-hearts i { position: absolute; left: 50%; top: -40px; font-style: normal; animation: sp-heart 1.2s ease-out forwards; }
@keyframes sp-fade { from { opacity: 0; } }
@keyframes sp-jelly { 0% { opacity: 0; transform: scale(.6, .5); } 40% { opacity: 1; transform: scale(1.06, .94); } 60% { transform: scale(.97, 1.04); } 80% { transform: scale(1.01, .99); } 100% { transform: none; } }
@keyframes sp-bob { 50% { transform: translateY(-5px) rotate(-3deg); } }
@keyframes sp-heart { to { transform: translate(var(--x), -90px) scale(1.4); opacity: 0; } }`;

  function show({ name, logo, onDonate }) {
    if (!document.getElementById('sp-style')) {
      const s = document.createElement('style'); s.id = 'sp-style'; s.textContent = css; document.head.append(s);
    }
    return new Promise((done) => {
      const bg = document.createElement('div');
      bg.className = 'sp-bg';
      bg.innerHTML = `<div class="sp-card" role="dialog" aria-modal="true" aria-labelledby="sp-t">
        <img alt="" src="${logo}"><h2 id="sp-t">¿Quieres apoyar el proyecto? 💜</h2>
        <p></p><div class="sp-hearts"></div>
        <div class="sp-row"><button class="sp-no">Ahora no</button><button class="sp-yes">💜 Donar</button></div></div>`;
      bg.querySelector('p').textContent = `${name} es gratis y sin anuncios. Si te sirve, una donación (la cantidad que tú quieras) ayuda a seguir mejorándolo.`;
      const close = () => { bg.remove(); done(); };
      bg.querySelector('.sp-no').onclick = close;
      bg.querySelector('.sp-yes').onclick = () => {
        const h = bg.querySelector('.sp-hearts');
        for (let i = 0; i < 6; i++) { const e = document.createElement('i'); e.textContent = '💜'; e.style.setProperty('--x', `${(i - 2.5) * 22}px`); e.style.animationDelay = i * 60 + 'ms'; h.append(e); }
        onDonate?.();
        setTimeout(close, 900);
      };
      bg.onclick = (e) => e.target === bg && close();
      bg.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
      document.body.append(bg);
      bg.querySelector('.sp-yes').focus();
    });
  }
  window.Support = { show };
})();
