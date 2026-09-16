# Decisiones técnicas — Avatar 3D (mejora de «Hola»)

**Fecha:** 2026-09-16. Rama `feature/avatar-poc`. Continúa el formato de [DECISIONES-TECNICAS.md](DECISIONES-TECNICAS.md) (qué / por qué / descartado), numerado aparte con prefijo **A** para no chocar con D1–D28.

Registra cómo se revisó `docs/propuesta-avatar-lengua-senas.pdf` contra el código existente y qué se cambió para que «Hola» deje de verse trabado y pixelado antes de procesar las demás señas.

![Antes y después: 8 capturas cada 350 ms en un panel de 320 px de alto a 1×](img/avatar-hola-antes-despues.png)

---

## Diagnóstico de partida

### A1. La propuesta del PDF ya estaba implementada en su arquitectura; lo que faltaba eran los pasos 3 y 4
**Qué:** VRM + `@pixiv/three-vrm`, MediaPipe Holistic en modo video y un JSON por seña ya existían (commits `4086caa`…`3341fc0`). Del PDF solo aportaban trabajo nuevo el paso 3 («normalizar y limpiar: smoothing, interpolar pérdidas, eliminar silencios») y el 4 («retargeting… guardar como cuaterniones y suavizarlos»), que el código no hacía o hacía a medias.
**Evidencia medida sobre `hola.landmarks.json` y `hola.mp4`, no supuesta:**
- El video fuente tiene ~31 fps (≈87 frames en 2.8 s, leído de la tabla `stts` del mp4). El JSON tenía **40 frames (~14 fps)**, con espaciado irregular (64 ms y 160 ms).
- El reproductor indexaba por `i / fps` ignorando `frame.t` → ritmo a tirones.
- La mano izquierda de la señante solo se detectaba en los últimos 7 frames (cuelga fuera de cuadro). El código rellenaba hacia atrás con la **última** detección: dedos congelados en una pose ajena al 80 % de la seña y brinco al final.
- Cero suavizado: el jitter de MediaPipe llegaba directo a los huesos.
- El bucle saltaba del último frame al primero sin transición.
- Render: `setPixelRatio(devicePixelRatio)` en un panel de 320 px; en pantallas 1× los dedos ocupan pocos píxeles y solo había MSAA. Encuadre fijo que cortaba la coronilla en paneles anchos. Las texturas del modelo se descartaron como causa: son de 1024–2048 px.

### A2. Alcance: pasos 1 (datos), 2 (limpieza) y 4 (render); el retargeting (paso 3) queda pendiente
**Por qué:** los tres son de bajo riesgo y atacan lo "trabado" y lo "pixelado". Lo que se "enciman" las articulaciones (mano que atraviesa el vientre, dedos que se cruzan) viene del retargeting por direcciones —sin giro del brazo, sin proporciones del avatar, sin abducción de dedos— y requiere IK; es un cambio más grande que conviene revisar aparte. Ver **Pendiente** al final.

---

## Paso 1 — Datos de entrada

### A3. Re-extracción a `playbackRate` 0.0625 (antes 0.15), expuesto como `--rate`
**Qué:** `extract-landmarks.mjs` acepta `--rate=` y usa 0.0625 por defecto. Hola pasa de 40 a **74 frames**, casi todos a 32 ms (la cadencia real del video), y ahora la mano izquierda aparece en 13 frames.
**Por qué:** la extracción muestrea con `requestVideoFrameCallback` durante reproducción real (los mp4 no permiten seek preciso, ver commit `12ff7d3`). La detección tarda ~230 ms por frame en CPU; a 0.15× cada frame del video dura ~213 ms reales, así que se perdía más de la mitad. A 0.0625× dura ~512 ms y casi todos alcanzan a procesarse.
**Por qué 0.0625 y no 0.05:** es el mínimo que acepta Chromium (0.05 lanza `NotSupportedError`).
**Costo asumido:** Hola tardó 1 min 52 s en extraerse (medido). Es aceptable para un proceso offline de 10 señas; para videos largos como el abecedario se puede seguir pasando `--rate=1`.
**Descartado:** pausar el video en cada frame y reanudar (más frágil: depende de latencias de play/pause del decodificador); decodificar con ffmpeg (no está instalado y agrega una dependencia nativa, ver el criterio de D10).

---

## Paso 2 — Limpieza de la animación (`apps/web/src/avatar/cleanup.ts`)

### A4. Se limpia en rotaciones de hueso, no en landmarks
**Qué:** primero se retargetea cada frame (como antes) y luego se limpia por hueso.
**Por qué:** los landmarks de mano vienen centrados en la mano; suavizar posiciones no evita que el ángulo de curl derivado salte, suavizar la rotación resultante sí. Además, así cada hueso tiene su propia pista con huecos explícitos, lo que hace simple el relleno (A5).
**Descartado:** suavizar landmarks antes de retargetear (dos pasadas de filtro para el mismo efecto y la de rotación seguiría siendo necesaria).

### A5. Relleno de huecos: interpolación si es corto, pose de reposo con rampa si es largo o está en un extremo
**Qué:** huecos interiores de ≤ 0.3 s → slerp por **tiempo real** entre detecciones vecinas. Huecos largos o en los extremos → pose de reposo (`restRotation` en `retarget.ts`: brazo abajo, dedos ligeramente flexionados), con rampa `smoothstep` de 0.25 s hacia y desde la detección más cercana.
**Por qué:** la mano izquierda de Hola cuelga fuera de cuadro; una mano relajada es lo que realmente hace la señante. La rampa evita el brinco al aparecer. 0.3 s cubre parpadeos de tracking sin inventar movimiento en pérdidas reales.
**Descartado:** mantener el relleno "último valor conocido" (causa directa del brinco).

### A6. Suavizado gaussiano centrado + remuestreo a 30 fps, en una sola pasada
**Qué:** para cada instante de salida (cada 1/30 s) se promedian las muestras cercanas con peso gaussiano sobre su tiempo real. σ = 35 ms para brazos, muñeca y cabeza; 50 ms para dedos (más ruidosos). Promedio de cuaterniones: suma ponderada normalizada con alineación de hemisferio.
**Por qué:**
- Tenemos el clip completo, así que el filtro puede ser **no causal** (mira hacia adelante y hacia atrás): quita jitter sin introducir retraso.
- Resolver jitter y espaciado irregular en la misma operación elimina el error de indexar por posición: en la prueba unitaria con un hueco de 64 ms, por índice se obtiene 28 ms de error y con el kernel menos de 10 ms.
- σ pequeños (≈1–1.5 frames) para no borrar movimientos rápidos, que en señas son significativos. Son parámetros nombrados en `DEFAULT_CLEANUP` para calibrarlos con otras señas.
- La suma normalizada de cuaterniones es válida porque el kernel abarca ±3σ ≈ ±0.15 s, donde las rotaciones son cercanas.
**Descartado:** filtro One-Euro, que sugiere la literatura de tracking. Es causal: está pensado para tiempo real y aquí solo agregaría retraso. SLERP/SQUAD sin suavizado: pasa por cada muestra ruidosa.
**Bug encontrado en el camino:** `new THREE.Vector4()` inicia en `(0,0,0,1)`, no en ceros. El acumulador sesgaba todo hacia la identidad (T-pose) y los brazos salían abiertos. Se inicializa explícito en ceros y quedó comentado.

### A7. Recorte de quietud relativo al pico del propio clip
**Qué:** se suma la velocidad angular de todos los huesos; los frames bajo el 10 % del pico al inicio y al final se recortan, dejando 0.12 s de margen.
**Por qué:** umbral relativo y no absoluto para no depender de la escala del ruido de cada video. En Hola casi no recorta (la seña empieza de inmediato y la quietud final coincide con la mano izquierda entrando en cuadro), pero queda listo para videos con silencios largos, como pide el PDF.

### A8. Cierre del bucle: transición de 0.45 s al primer frame y pausa de 0.2 s
**Qué:** al clip se le agregan frames que van de la última pose a la primera con `smoothstep`, y luego se mantiene la pose inicial 0.2 s. El reproductor envuelve de forma continua. Ciclo de Hola ≈ 3.4 s.
**Por qué:** elimina el golpe al repetir, y la breve pausa marca visualmente dónde empieza cada repetición. En Hola el inicio y el final ya son poses neutras, así que la transición es corta y natural.
**Descartado:** crossfade a una pose neutra genérica. Alarga el ciclo y agrega un movimiento que no está en el video.

---

## Paso 4 — Render (`apps/web/src/avatar/scene.ts`)

### A9. Supersampling: resolución interna de al menos 2×, tope en 3×
**Qué:** `setPixelRatio(min(max(devicePixelRatio, 2), 3))`, recalculado en cada `resize` (cambia al mover la ventana entre monitores o al hacer zoom).
**Por qué:** en pantallas 1× el canvas se dibuja a 2× y el navegador lo reduce promediando 2×2 píxeles. Eso quita el dentado de bordes de pelo, camisa y dedos. El costo es trivial en un panel de ~600×320. El tope en 3× evita disparar el costo en 4K.
**Descartado:** FXAA/SMAA con `EffectComposer`. Agrega un pipeline de postproceso y es un suavizado aproximado: difumina detalle fino, como las líneas de ojos y contornos de MToon, mientras que renderizar a mayor resolución lo conserva. A este tamaño de panel se puede pagar la opción exacta.

### A10. Encuadre por ajuste de caja según la proporción del panel
**Qué:** la cámara encuadra de la cintura (cadera + 20 % del torso) a la punta del pelo (caja del modelo en reposo + margen), con ancho mínimo de ±0.75 torsos para el espacio de señas. La distancia se recalcula con el aspecto del panel.
**Por qué:** el encuadre fijo cortaba la cabeza en paneles anchos. La coronilla se toma de la caja del modelo porque la estimación desde el hueso de la cabeza quedó 3 cm por debajo del pelo (medido: 1.587 m frente a 1.615 m).

### A11. Paso de física del pelo acotado a 1/20 s
**Qué:** `vrm.update(min(delta, 1/20))`.
**Por qué:** tras volver de una pestaña en segundo plano, el delta puede ser de segundos y los springbones del pelo salen disparados a través del cuerpo. Es una fuente de "cosas que se enciman" que no tiene que ver con la seña.

---

## Verificación

- `apps/web/test/avatar-cleanup.test.ts` (6 pruebas): interpolación por tiempo, rampa monótona a reposo, reducción de jitter, espaciado irregular, cierre de bucle sin brincos y recorte de quietud. Suite web: 14/14. `tsc -b` y `vite build` sin errores.
- Comparación visual con `tools/avatar/capture-frames.mjs` (nuevo): panel forzado a 320 px de alto y `deviceScaleFactor` 1, que es el peor caso de nitidez. La imagen de arriba se generó así.

## Pendiente (paso 3 del PDF: retargeting)

Lo que sigue viéndose encimado en las capturas (las manos juntas atraviesan el vientre) no se resuelve limpiando, sino con:
1. **Giro del brazo:** construir la rotación de brazo y antebrazo con el plano hombro–codo–muñeca, en vez de `setFromUnitVectors`, y repartir el giro entre antebrazo y muñeca (hoy lo absorbe la muñeca).
2. **Proporciones:** posicionar la muñeca escalando por el ancho de hombros (normalización del PDF) y resolver con IK de dos huesos, con un límite para que la mano no entre al torso.
3. **Dedos:** abducción y eje real del pulgar.
4. **Validación:** video y avatar lado a lado en `/avatar-poc` para revisión con ICAL (PDF §6).
