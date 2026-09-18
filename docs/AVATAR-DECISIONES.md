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

### A6. Suavizado gaussiano centrado + remuestreo a 30 fps, en una sola pasada *(salida a 60 fps desde A18)*
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

### A8. Cierre del bucle: transición de 0.45 s al primer frame y pausa de 0.2 s *(reemplazada por A18)*
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

La lista de pendientes de esta primera iteración (giro del brazo, proporciones con IK, dedos) se resolvió en la segunda iteración, abajo.

---

# Segunda iteración: retargeting (paso 3), pelo y seña breve

**Fecha:** 2026-09-16, después del merge de la primera iteración. Qué se pidió: que se vea "súper smooth" antes de seguir con otras señas. Los problemas señalados fueron tres: los dedos se mueven raro, las manos se traban al juntarse al final y el pelo atraviesa el cuerpo. Además, la animación debe ser breve, solo la seña.

![Video de referencia (arriba) y avatar (abajo) en los mismos instantes](img/avatar-hola-video-vs-avatar.png)

## Retargeting (`retarget.ts`, `rig.ts`)

### A12. Medir el modelo en vez de suponer un rig ideal
**Qué:** `measureRig` lee, al cargar el modelo, la posición de cada articulación en reposo y la dirección real de cada hueso hacia su hijo. Para las falanges distales usa los nodos `_end` del VRM. Ese rig medido es la referencia de todas las rotaciones.
**Por qué:** el retargeting anterior suponía brazos exactamente en ±X y dedos rectos. En VRoid el pulgar sale en diagonal y los dedos van ligeramente abiertos. Calcular "de la dirección supuesta a la observada" metía esa diferencia como una rotación falsa en cada frame.

### A13. Brazos por posición de la muñeca + IK de dos huesos, no por direcciones
**Qué:** se toma la muñeca de la persona relativa a su hombro, se escala por el largo de brazo (avatar ÷ persona, mediana del clip) y se coloca relativa al hombro del avatar. El codo se resuelve con IK de dos huesos, usando el codo de la persona como polo.
**Por qué:** copiar solo direcciones respeta los ángulos pero no dónde termina la mano. El avatar tiene otras proporciones (cabeza grande, torso corto), así que la mano acababa dentro de la cara o del vientre. Se escala por largo de brazo, y no por ancho de hombros como sugiere el PDF, porque lo que hay que preservar es el alcance: una mano extendida debe seguir extendida, sin importar cuán anchos sean los hombros de cada quien.
**Costo asumido:** la mediana del largo de brazo depende de que la pose detecte bien hombro, codo y muñeca en la mayoría de los frames. En Hola la visibilidad del brazo derecho es ≥ 0.9.

### A14. Colisión mano–cuerpo contra la silueta medida
**Qué:** `measureBody` recorre los vértices de piel y ropa (con skinning aplicado) y guarda, por franjas de 2 cm de altura, el centro, el ancho y el fondo del torso y la cabeza como elipses. Antes del IK se prueban tres puntos de la mano (muñeca, nudillos y mitad de los dedos). Si alguno queda dentro, el objetivo de la muñeca se adelanta en +Z con 2.5 cm de holgura.
**Por qué:** es suficiente para que la mano no atraviese el pecho ni la frente (en Hola la mano toca la frente) sin integrar un motor de física. Se mide sobre la ropa y no sobre los colliders del modelo porque la camisa es holgada.
**Detalle:** los brazos en T-pose se excluyen por el hueso dominante de cada vértice (brazo o mano) y además con un tope lateral (hombro + 7 cm). Primero se intentó solo con el tope en la x del hombro y el torso salió de ±10 cm, cuando la camisa mide ±17 cm: la articulación del hombro queda por dentro de la camisa.

### A15. Giro del brazo por el plano del codo; pronación repartida 50/50
**Qué:** el brazo se orienta con la base (dirección del brazo, dirección en que dobla el antebrazo), así que su giro sobre el propio eje sale del plano hombro–codo–muñeca. Con el brazo casi recto ese plano no existe y se mezcla suavemente con el giro mínimo. La pronación/supinación que pide la mano se reparte: la mitad la gira el antebrazo y la otra mitad la muñeca.
**Por qué:** antes todo el giro lo absorbía la muñeca y la malla se torcía como envoltura de caramelo. Sin huesos de giro en el antebrazo (VRM no los tiene), repartir 50/50 es el compromiso estándar.

### A16. Dedos con límites anatómicos; pulgar por dirección observada
**Qué:** cada falange se expresa en el marco de su hueso padre y se descompone en flexión (hacia la palma) y abducción (lateral). Se limita cada una: base −0.25…1.6 rad y ±0.3 de abducción; media 0…1.9; distal 0…1.4; sin abducción fuera de la base. El pulgar sigue la dirección observada de cada falange con un tope de 1.1 rad.
**Por qué:** antes se usaba solo el ángulo entre segmentos, alrededor de un eje fijo, sin abducción y con el pulgar en un eje supuesto. El ruido de profundidad de MediaPipe se convertía en dedos doblados hacia atrás o cruzados; los límites cortan exactamente esos casos. El pulgar no se restringe a una bisagra porque su eje de flexión es oblicuo y distinto entre personas.
**Verificado:** en el recorte de la mano a 1.3 s coincide con el video (tres dedos arriba, meñique doblado contra el pulgar).

### A17. Solo la seña: tramo explícito por seña (Hola: 0.15–1.8 s)
**Qué:** `animations.ts` registra por seña el tramo del video que es la seña. El suavizado se calcula con todo el video y el corte se aplica después. El brazo cuya mano nunca aparece en el tramo (aquí el izquierdo, en el regazo) va en reposo todo el clip.
**Por qué:**
- **Tramo elegido a mano:** viendo el video cuadro por cuadro, de 1.9 a 2.8 s la señante solo baja las manos y las entrelaza. Eso era el "se traban al juntarse" y no es parte de la seña. Qué es la seña es una decisión lingüística, no un umbral de movimiento, así que se registra explícito y se revisa con ICAL.
- **Cortar después de suavizar:** si se corta antes, el filtro ve un solo lado en el borde y deforma el arranque. Medido: el tirón máximo del brazo estaba en 0.07 s.
- **Por qué 0.15 s:** el video empieza con la mano ya en movimiento y antes de 0.05 s no hay datos.
- **Brazo en reposo:** una mano fuera de cuadro hace que la pose estime el brazo a ciegas; quedaba flotando frente al vientre.
**Ciclo resultante:** 2.05 s, frente a 3.4 s antes.
**El mismo tramo define la plantilla de reconocimiento** (D29 en DECISIONES-TECNICAS.md): una sola fuente de verdad de qué es la seña.

### A18. Cierre del bucle que conserva la velocidad, y salida a 60 fps
**Qué:** la transición de regreso (0.4 s, sin pausa) mezcla con `smoothstep` dos cosas: la continuación del final de la seña, con su velocidad apagándose en ~0.1 s, y la anticipación del inicio, que llega con la velocidad con que arranca la seña. La animación limpia se muestrea a 60 fps en vez de 30.
**Por qué:** un slerp directo entre la última y la primera pose arranca y termina con velocidad cero. Junto con la pausa, eso se sentía como un frenón en cada repetición. Con muestras a 30 fps, además, la velocidad cambiaba de golpe en cada muestra.
**Medido** con `tools/avatar/measure-smoothness.mjs` (nuevo), aceleración angular máxima en rad/s², comparando la primera versión de este retargeting (cierre anterior, 30 fps, corte antes de suavizar) con la final:

| Hueso | Antes | Después |
|---|---|---|
| Brazo | 553 | 149 |
| Meñique (base) | 460 | 136 |
| Índice (base) | 294 | 124 |
| Cabeza | 212 | 48 |

La prueba unitaria de continuidad del bucle falla si se vuelve al slerp directo (verificado).

## Pelo (`rig.ts: addHairColliders`)

![Pelo antes (izquierda) y después (derecha)](img/avatar-pelo-antes-despues.png)

### A19. Colliders de pelo que siguen la silueta de la ropa
**Qué:** con el mismo perfil de A14 se colocan esferas de 3 cm apoyadas por dentro de la superficie, al frente y atrás del torso, cada ~4 cm, y se agregan a las articulaciones del pelo. Las cápsulas de brazo del modelo se engrosan 1.8× solo para el pelo, porque las mangas son holgadas.
**Por qué:** los colliders del modelo cubren columna, pecho alto, cuello, cabeza y brazos, pero no hombros ni el frente del pecho con la camisa. Por ahí el pelo largo se metía en la tela (se veían cortes dentados en los hombros).
**Descartado:** cápsulas horizontales con el radio del fondo del torso. Sobresalen por arriba del hombro y dejan el pelo flotando.
**Límite conocido:** la física de three-vrm solo corrige la punta de cada segmento de pelo, así que puede quedar algún cruce leve a mitad de segmento. En las capturas no se ve.

## Verificación de la segunda iteración

- **Pruebas nuevas:**
  - `avatar-retarget.test.ts`: IK (alcance y largo de segmentos, polo, objetivo fuera de alcance) y colisión (empuje, puntos afuera, sección elíptica).
  - `avatar-cleanup.test.ts`, dos más: bucle con velocidad continua y tramo aplicado después de suavizar.
  - Suite web: 21/21. `tsc -b`, `oxlint` y `vite build` sin errores nuevos.
- **Revisión cuadro por cuadro:** `/avatar-poc?t=1.2` congela la seña, y `capture-frames.mjs --tiempos=...` lo usa.

## Pendiente

1. **Validación con ICAL** del tramo elegido (A17) y de la configuración manual. La imagen de arriba sirve para esa revisión.
2. **Expresión facial:** no se transfiere (PDF, fase posterior).
3. **Mano con mano:** no hay colisión entre las dos manos. Hola no la necesita; señas donde las manos se tocan sí.

---

# Tercera iteración: Por favor (2026-09-17)

Primera seña después de Hola. El objetivo era repetir el proceso tal cual, pero la seña sacó a la luz cuatro problemas que Hola no tenía: el pulgar separado del puño, un giro falso de muñeca, el pelo atrapado por el brazo y el pelo rígido al inclinar la cabeza. Se corrigieron en el pipeline, así que también benefician a Hola y a las señas siguientes.

![Video de referencia (arriba) y avatar (abajo), Por favor](img/avatar-por-favor-video-vs-avatar.png)

## Receta para una seña nueva

Es el proceso seguido con Por favor. Hay que cambiar el slug, el `signId` y los tiempos.

1. **Ver la seña:** `node tools/avatar/video-sheet.mjs content/ical-2026-09/<slug>.mp4 hoja.png --cada=0.1`. Para acercar la mano: `--recorte=x,y,w,h --desde --hasta --ancho`. Decidir el tramo que es la seña (sin preparación ni regreso a reposo) y anotar qué se ve: mano dominante, configuración, contacto, movimiento, gestos no manuales.
2. **Extraer landmarks:** `node tools/avatar/extract-landmarks.mjs content/ical-2026-09/<slug>.mp4 apps/web/public/avatar/<slug>.landmarks.json` (~2 min). Revisar en qué frames se detectó cada mano.
3. **Registrar la seña** en `apps/web/src/avatar/animations.ts`, con `gloss`, `url` y `window`, y un comentario de por qué ese tramo. Con eso la lección ya muestra el avatar.
4. **Revisar el avatar** en `/avatar-poc?sena=<signId>`:
   - `&t=` congela la seña en un instante;
   - `&angulo=70` la muestra de lado (contactos con el cuerpo);
   - `capture-frames.mjs --tiempos=...` saca cuadros a comparar con la hoja del video;
   - `measure-smoothness.mjs "<url>?sena=<signId>"` busca tirones (maxAcc aislados).
5. **Plantilla de reconocimiento:** `npx vite-node tools/content/build-templates.mjs courtesy --only <todas las señas ya revisadas>`. `--only` reemplaza el bundle, así que hay que listar también las anteriores.
6. **Verificar:**
   - `npx vite-node tools/content/verify-template.mjs <signId>`: su video a varias velocidades, sin falsos positivos contra las otras 9.
   - `npx vite-node tools/content/diagnose-practice.mjs <signId>`: detector real de la app, cámaras 16:9 y 4:3. Hay que registrar el video en su mapa `VIDEOS`.
   - `JITTER=0.003 npx vite-node tools/content/tune-motion.mjs 0.5:0.4`: que la mano quieta no valide la seña y la real sí, sin falsos positivos (D36). Si la seña nueva rompe algo, comparar otras combinaciones de peso y fracción.
7. **Probar con la cámara** en la lección, y **documentar** aquí lo que la seña haya enseñado.

## A20. Tramo de Por favor: solo el contacto (0.37–2.06 s)
**Qué:** puño derecho apoyado en el lado izquierdo del pecho, con círculos pequeños. Antes de 0.37 s la mano sube desde el reposo; después de 2.06 s se retira y las manos se entrelazan.
**Por qué:** si el tramo es solo el contacto, el cierre del bucle (A18) va de círculo a círculo sin despegar la mano del pecho. Si incluyera la subida, cada repetición despegaría la mano y volvería a subir, algo que no es parte de la seña.
**No transferido:** la cabeza inclinada sí pasa al avatar (retargeting de cabeza), pero el gesto de súplica de la cara no. Es parte de la seña y queda como pendiente.

## A21. El rig se mide completo al cargar, no a demanda
**Qué:** `measureRig` lee de una vez, con el modelo en reposo, la posición de todos los huesos humanoides y de los nodos `_end`.
**Por qué:** antes las posiciones se leían la primera vez que se pedían. Cualquier lectura posterior (otra seña, una herramienta de revisión) obtenía la pose animada como si fuera reposo. En la depuración de Por favor, la falange distal del pulgar derecho apuntaba al revés (+X). En la app no llegaba a pasar porque el reproductor se crea antes de animar, pero era una trampa latente.

## A22. Contacto del pulgar preservado con IK
**Qué:** si en el video la punta del pulgar está a menos de 0.45 largos de mano de algún punto de los dedos (PIP, DIP o yema), se toma ese mismo punto en la mano del avatar, se le suma el desplazamiento observado escalado, y se resuelve con CCD sobre metacarpo y falange proximal. El peso se apaga con `smoothstep` entre 0.45 y 0.30, para no forzar contactos que no existen.
**Por qué:** copiar la dirección de cada falange no basta. El pulgar de VRoid es más largo y nace en otro punto, así que con las mismas direcciones su punta quedaba separada del puño.
**Medido:** separación en largos de mano, avatar / video.
- **Por favor** (pulgar a PIP del índice, t = 1.33 s): antes 0.49 / 0.32, después 0.30 / 0.32. En los demás instantes medidos quedó a ±0.07 del video.
- **Hola** (pulgar al punto más cercano de los dedos, solo después del cambio): entre −0.03 y +0.11 del video, por ejemplo 0.43 / 0.46 a 1.3 s y 0.50 / 0.39 a 1.5 s.

**Detalle:** las yemas se agregaron como candidatas después de medir Hola, donde el pulgar toca la punta del meñique y no un nudillo.

## A23. Detecciones de mano implausibles se descartan
**Qué:** se calcula la mediana, en todo el clip, del ancho entre los nudillos del índice y del meñique (landmarks 5 y 17). Si en un frame ese ancho baja del 80% de la mediana, esa mano (y el giro del antebrazo, que sale de ella) cuenta como no detectada, y la limpieza la interpola con los vecinos.
**Por qué:** el ancho de la mano de una persona no cambia. En Por favor, MediaPipe "encogió" el puño de 6.5 a 4.6 cm en un frame, con un giro falso de 24° que se veía como un latigazo de la muñeca.
**Resultado:**

| Hueso | Aceleración máx. antes | Después |
|---|---|---|
| Muñeca | 315 rad/s² | 237 rad/s² |
| Antebrazo | 54 rad/s² | 42 rad/s² |

El giro que queda es continuo (≤ 6° por frame) y el video también muestra rotación del puño en ese tramo.

## A24. La física del pelo se asienta antes del primer render
**Qué:** al cargar se simula ~2.1 s sin mostrar nada: brazos en reposo con el pelo reiniciado (1 s), entrada gradual a la pose inicial de la seña (0.6 s) y asentamiento (0.5 s). Para eso, `SignPlayer.update` acepta un peso de mezcla con el reposo.
**Por qué:** el brazo saltaba en un frame de la T-pose a la seña y atravesaba los mechones, que quedaban atrapados del lado equivocado de los colliders del antebrazo. En Por favor el mechón quedaba flotando por fuera del brazo, y distinto en cada carga, porque dependía de por dónde se atrapara. Con la pose congelada el pelo no oscilaba (0.00 cm por frame), lo que descartó la inestabilidad. Tras el cambio, tres cargas seguidas dan la misma imagen.

## A25. Más gravedad en los mechones largos, no en el flequillo
**Qué:** `gravityPower` mínimo de 0.3 en `J_Sec_Hair*_05..12`. Medido en este modelo: `_01..04` son el flequillo corto, `_05..10` el pelo de atrás y `_11/_12` los dos mechones largos del frente. Ese pelo trae 0.1 (atrás) y 0 (frente), con rigidez 0.5.
**Por qué:** con tan poca gravedad el mechón conserva su forma respecto a la cabeza. Al inclinarla (Por favor) giraba entero y quedaba en diagonal. Se compararon 0.1, 0.3, 0.6 y 1.0 en Hola y en Por favor: 0.3 hace caer el pelo sin aplastarlo, y aplicarlo también al flequillo lo tiraba sobre los ojos.
**Tropiezo:** la primera versión escribió el regex sin barras invertidas y no afectaba a ningún mechón. Se detectó midiendo la gravedad efectiva de cada mechón en la página, no mirando capturas.

![Pelo en Por favor: antes (izquierda) y después (derecha)](img/avatar-por-favor-pelo-antes-despues.png)

## A26. Revisión con vista lateral y selector de seña
**Qué:** `/avatar-poc?sena=<signId>&t=<s>&angulo=<grados>` elige la seña, la congela y gira la cámara (`AvatarScene.setCameraYaw`).
**Por qué:** de frente no se distingue si una mano toca el cuerpo o flota delante. Con `angulo=70` se confirmó que el puño de Por favor toca la camisa sin atravesarla. Queda para revisar cualquier seña con contacto.

## Verificación de la tercera iteración
- **Pruebas:** web 25/25 (nuevas: descarte de manos implausibles). cv-model 35/35. `tsc -b` y `vite build` sin errores.
- **Suavidad** (`measure-smoothness`): Por favor tiene un ciclo de 2.08 s; brazo 70, antebrazo 42 y dedos ≤ 142 rad/s². Hola no cambió respecto a A18.
- **e2e:** no se pudo correr porque el puerto 3001 ya estaba ocupado. Esta iteración no toca el flujo que cubre.
- **Pendiente nuevo:** la limitación del reconocimiento que expone Por favor, en D35 de DECISIONES-TECNICAS.md.
