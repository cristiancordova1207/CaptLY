# CaptLY

Grabador de pantalla para Windows que funciona por tomas: un botón **guarda** lo grabado hasta ese momento y otro **borra** todo lo que no has guardado, y la grabación sigue.

**Descarga:** [Releases](https://github.com/cristiancordova1207/CaptLY/releases/latest) → `CaptLY-Setup-x.y.z.exe`

## Cómo se usa
- `F9` empieza y detiene la grabación; `F10` (o el botón ⏸) la pausa y la reanuda.
- **Ratón 4** guarda lo grabado hasta ahí.
- **Ratón 5** borra lo que no has guardado y sigues grabando.
- Los atajos se cambian con un clic: pulsa la tecla o el botón del ratón que quieras. Funcionan aunque estés dentro de un juego y no bloquean la tecla.

## Opciones
- **Qué grabar:** una pantalla o una aplicación (si la ventana está minimizada, se restaura sola).
- **Sonido:** nada, el escritorio o solo el de la aplicación elegida. El micrófono se activa aparte.
- **FPS:** 30, 60, 120, 144, 165 o 240.
- **Vista previa:** se puede apagar para ganar rendimiento.
- **Temas:** 10 temas de color.

## Cómo funciona
- **Vídeo:** ffmpeg con `ddagrab` para la pantalla y `gfxcapture` para las ventanas, codificado por hardware a calidad constante, como OBS con CQP 15 y el preajuste «Calidad» (AMD AMF, NVIDIA NVENC o Intel QSV; si no hay ninguno, `libx264` con CRF 18).
- **Tomas:** se graba en trozos de 0,5 s y al detener se unen sin recodificar los trozos guardados, con su duración exacta.
- **Ayudante nativo** (`helper/VrHelper.cs`): ganchos globales de ratón y teclado, y captura de audio con WASAPI, incluido el sonido de un solo proceso (`Process Loopback`, Windows 10 2004 o posterior).

Requiere **ffmpeg** (`winget install Gyan.FFmpeg`).

## Desarrollo
```
npm install
npm run helper   # compila el ayudante con el csc.exe de Windows
npm start
npm test         # prueba la lógica de tomas
npm run dist     # instalador en dist/
```

## Apoyo y estadísticas
- Botón **💜 Apoyar** y una ventana al abrir para donar la cantidad que quieras (Stripe, desde la web de Fluxy).
- Al abrirse avisa de forma anónima a `fluxy-8yg.pages.dev` (instalación o apertura, versión, Windows y un id aleatorio de la instalación) para las estadísticas de descargas por país. No envía nada personal.
