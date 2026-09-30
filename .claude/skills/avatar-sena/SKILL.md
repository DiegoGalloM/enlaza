---
name: avatar-sena
description: Receta y lista de control para llevar una seña nueva al avatar 3D de Enlaza (o pulir una existente) y a su reconocimiento con cámara, sin repetir errores ya resueltos. Usar cuando se pida hacer, revisar, mejorar o corregir la animación del avatar de cualquier seña (Gracias, Buenos días, Permiso, etc.), cuando el avatar se vea triste, rígido, con la mano abierta, o atravesándose (brazo en la camiseta, pelo a través de la mano), o cuando la práctica no reconozca una seña.
---

# Seña nueva en el avatar 3D

El avatar ya resuelve en el pipeline los problemas de Hola, Por favor, Gracias y Buenos días.
Una seña nueva casi siempre se hace **registrando datos** en
`apps/web/src/avatar/animations.ts` (tramo, cara, configuración manual, mano), no
cambiando el retargeting ni el reconocimiento. El porqué de cada decisión está en
`docs/AVATAR-DECISIONES.md` (A1–A38) para el avatar y en
`docs/DECISIONES-TECNICAS.md` (D35–D41) para el reconocimiento. Léelos antes de
tocar `retarget.ts`, `rig.ts`, `cleanup.ts`, `face.ts` o `packages/cv-model`.

## Señas pendientes (lección `cortesia`)

| signId | Glosa | Video | Estado |
|---|---|---|---|
| lsc-cortesia-0 | Buenos días | buenos-dias.mp4 | hecha (A38, D41) |
| lsc-cortesia-1 | Buenas tardes | buenas-tardes.mp4 | pendiente |
| lsc-cortesia-2 | Buenas noches | buenas-noches.mp4 | pendiente |
| lsc-cortesia-3 | Gracias | gracias.mp4 | hecha (A35–A37, D38–D40) |
| lsc-cortesia-4 | Por favor | por-favor.mp4 | hecha (A20–A34) |
| lsc-cortesia-5 | Hola | hola.mp4 | hecha (A1–A28) |
| lsc-cortesia-6 | Con mucho gusto | con-mucho-gusto.mp4 | pendiente |
| lsc-cortesia-7 | Lo siento | lo-siento.mp4 | pendiente |
| lsc-cortesia-8 | ¿Cómo está? | como-estas.mp4 | pendiente |
| lsc-cortesia-9 | Permiso | permiso.mp4 | pendiente |

Los videos están en `content/ical-2026-09/`. El orden sale de `apps/api/src/catalog.ts`.
Al terminar una seña, actualiza esta tabla.

## Antes de empezar

- El servidor de desarrollo corre en `http://localhost:5173`. Compruébalo con
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/avatar-poc`. Si no
  responde, levántalo con `npm run dev -w @enlaza/web` en segundo plano.
- Todas las herramientas de `tools/avatar/` se corren desde la raíz del repo.
  Necesitan `@playwright/test`, que está en `node_modules`. Si un script
  temporal vive fuera del repo, falla al resolver `@playwright/test`.
- Trabaja en la rama que tenga el usuario (él crea ramas y hace los commits).
  No hagas commit sin que lo pida.

## Pasos

1. **Ver el video.** Primero una hoja general:
   `node tools/avatar/video-sheet.mjs content/ical-2026-09/<slug>.mp4 <scratch>/hoja.png --cada=0.1`.
   Luego la mano de cerca:
   `... --recorte=0.28,0.35,0.5,0.65 --desde=<a> --hasta=<b> --cada=0.2 --columnas=5 --ancho=300`
   (el recorte va en fracciones del cuadro). Anota:
   - el **tramo** que es la seña, sin la subida desde el reposo ni la bajada;
   - la mano dominante;
   - la **configuración manual** (puño, plana, índice…) y dónde va el pulgar;
   - contacto con el cuerpo y movimiento;
   - la cara.
2. **Extraer landmarks** (~2 min):
   `node tools/avatar/extract-landmarks.mjs content/ical-2026-09/<slug>.mp4 apps/web/public/avatar/<slug>.landmarks.json`.
3. **Registrar la seña en `animations.ts`**, con un comentario de qué se ve en el
   video y por qué:
   - `window: [inicio, fin]`: solo la seña (A17). Si hay contacto sostenido,
     usa solo el tramo del contacto (A20).
   - `face`: por defecto, **la misma sonrisa de Hola**
     `{ Fcl_MTH_Joy: 0.5, Fcl_EYE_Joy: 0.35, Fcl_BRW_Joy: 0.5 }`. El usuario
     pidió caras amables y consistentes. Una cara de súplica o tristeza se leyó
     como "triste" en el avatar (A29). Usa otra cara solo si la seña lo exige y
     compárala lado a lado con Hola antes de dejarla.
   - `handshape: { right: 'puño' | 'plana' }` cuando los dedos no se ven o la
     detección los tuerce (dedos contra el cuerpo, mano de canto). MediaPipe los
     da a medio doblar y el avatar muestra un gancho abierto (A32). Para una
     configuración nueva (índice, C…), agrégala a `HANDSHAPE_FLEX` en
     `retarget.ts`, con su pulgar en `handshapeThumbTarget`.
   - `handshapeSpan: { right: [a, b] }` si la mano cambia de configuración a
     mitad de la seña (Buenos días: plana en la boca, abierta en el "día").
     La configuración registrada vale solo en ese tramo; fuera de él, los dedos
     siguen la detección (A38).
   - `faceContact: { right: [a, b] }` si la yema toca la cara (labios, mentón,
     frente): MediaPipe pone la mano hasta 17 cm por delante y el avatar la deja
     flotando, lo que solo se ve de lado (A35). Si la mano se va rápido de la
     cara, termina el tramo ~0.15 s antes de que se mueva: la rampa de salida
     con la mano bajando da un tirón en la muñeca (A38).
   - `palmUp: { left: [a, b], right: [a, b] }` si la mano va con la palma hacia
     arriba y la detección no es confiable (dos manos encimadas: anchos de
     nudillos de 1–4 cm en vez de 6.5). La orientación sale del antebrazo (A36).
   - `holdUntil: { left: t }` para que la mano de apoyo empiece ya en su lugar,
     en vez de subir desde el regazo, que es preparación (A37).
   - `hand: 'right' | 'left'`: la mano que hace la seña. **Obligatoria en señas
     de dos manos.** Sirve dos veces: la plantilla se construye con esa mano
     (A37), y `build-templates` la escribe en la plantilla (`hand: 'Right'`)
     para que la práctica siga a esa mano y no a la de apoyo (D38). Sin ella,
     la plantilla elige por cuánto se mueve cada mano y la práctica sigue a la
     primera que aparece.
4. **Revisar en `/avatar-poc?sena=<signId>`.** Ver la lista de control abajo.
5. **Plantilla de reconocimiento.** Todo con `npx vite-node` desde la raíz:
   - Agrega el video al mapa `VIDEOS` de `tools/content/diagnose-practice.mjs`
     y al mapa `SLUGS` de `tools/content/stress-sign.mjs` (hoy solo tienen
     Gracias, Por favor, Hola y Buenos días).
   - `tools/content/build-templates.mjs courtesy --only <TODAS las señas revisadas>`.
     `--only` **reemplaza el bundle entero**: si listas solo la nueva, borras
     las plantillas de las demás. Confirma que el log diga la mano correcta.
     **No es reproducible** (D41): cada corrida da cuadros algo distintos. Deja
     las plantillas ya aceptadas como están en git y copia solo la nueva al
     bundle; compara con `git show HEAD:apps/web/public/templates/lsc-bundled.json`.
   - `tools/content/diagnose-practice.mjs <signId>`: extrae los frames con el
     detector de la app (dos manos, ~1 min por cámara, se guardan en caché
     `*.hands2*.json`) y dice si valida siguiendo la mano.
   - `tools/content/stress-sign.mjs <signId>`: es el criterio de aceptación (ver la
     lista de control). Con `--antes` compara contra la forma sin D39.
6. **Probar en la app:** `/leccion/lsc-cortesia/practica?sign=<signId>&detalle=1`.
   La práctica dice qué falta (D40), y `detalle=1` muestra el desglose:
   forma, rotación, lugar y movimiento. Si alguien reporta que no le valida,
   pide esa línea antes de tocar nada.
7. **Documentar** en `docs/AVATAR-DECISIONES.md` (A39 en adelante) o en
   `docs/DECISIONES-TECNICAS.md` (D42 en adelante) solo lo que la seña haya
   enseñado de nuevo, y actualizar la tabla de arriba.

## Lista de control de calidad (no des la seña por terminada sin esto)

Captura en `<scratch>` (el scratchpad de la sesión), nunca en el repo:

- [ ] **Frente, varios instantes:** `node tools/avatar/capture-frames.mjs "http://localhost:5173/avatar-poc?sena=<id>" <scratch>/frente --tiempos=0.3,0.9,1.5 --alto=500 --escala=2`
- [ ] **Tres cuartos y de lado:** lo mismo con `&angulo=-45`, `&angulo=45` y
      `&angulo=±70`. Así se ven las manos dentro del cuerpo y el pelo que
      atraviesa la mano, que de frente no se notan.
- [ ] **La mano de cerca:** `--escala=3 --recorte=0.3,0.5,0.5,0.45` (ajusta el
      recorte a donde esté la mano). La configuración debe coincidir con el
      recorte del video: puño cerrado, pulgar en su lugar, dedos sin cruzarse.
- [ ] **En movimiento** (el pelo cambia con la física): `--n=10 --cadaMs=450 --escala=1`,
      y arma una hoja con las diez capturas.
- [ ] **Brazo fuera del cuerpo, con números:** `node tools/avatar/check-contacts.mjs "<url>" [--lado=left]`.
      El máximo debe ser ≤ 0.011 m (roce de la manga).
- [ ] **Sin tirones:** `node tools/avatar/measure-smoothness.mjs "<url>"`. Nada
      de maxAcc aislados muy por encima del resto. Referencia: brazo ≤ ~150,
      muñeca ≤ ~250 y dedos ≤ ~150 rad/s².
- [ ] **Hola no cambió:** si tocaste código del pipeline, captura Hola a
      0.3, 0.8 y 1.3 s antes y después (`git stash` para el "antes").
- [ ] **Pruebas:** `cd apps/web && npx vitest run test/avatar-*.test.ts && npx tsc -b && npx oxlint src/avatar`.

### Reconocimiento (no la des por terminada sin esto)

Con `stress-sign.mjs <signId>`, en las dos cámaras (16:9 y 4:3):

- [ ] **Valida:** solo la seña de 0.5× a 1.25×, sosteniendo el final, contacto
      breve, más abajo, centrada, mano inclinada ±15°/±30°, palma girada ±30°,
      dedos relajados, pulgar abierto, 12 cuadros por segundo y temblor alto.
- [ ] **No valida:** la mano quieta 3 s, y ninguna otra seña con esta como objetivo
      ni esta con otra como objetivo. Anota el máximo: hoy es 0.58 (Buenos días
      a 0.6× con Hola como objetivo), contra el umbral de 0.60. Excepción
      aceptada: Buenos días con Gracias como objetivo valida, porque contiene su
      movimiento (D41).
- [ ] **Las demás señas siguen igual:** corre `stress-sign` también en Hola, Por
      favor y Gracias.
- [ ] Si algo falla, **mira el desglose** (forma × lugar × movimiento, rotación,
      desplazamiento) antes de cambiar nada. **No bajes el umbral** (0.60):
      busca qué mide mal.
- [ ] Pruebas: `cd packages/cv-model && npx vitest run && npx tsc --noEmit`.

## Lo que ya está resuelto en el pipeline (no lo rehagas)

| Problema visto | Dónde se resolvió |
|---|---|
| Animación trabada, bucle con golpe, jitter | cleanup.ts (A3–A8, A18) |
| Mano dentro de la cara o el vientre por proporciones | IK por posición de muñeca (A13) |
| Brazo o antebrazo dentro de la camiseta | `solveArmClearance`: gira el codo y luego adelanta la mano (A30) |
| Dedos o puño dentro del pecho | se prueban los dedos reales, holgura de 1.2 cm (A31) |
| Codo alto y antebrazo horizontal al cruzar el cuerpo | `shoulderGirdle`: adelanta el hombro (A33) |
| Mano abierta en vez de puño | `handshape` registrado (A32) |
| Pulgar levantado en el puño | `handshapeThumbTarget` (A32) |
| Pelo a través de la mano o el antebrazo | esferas de mano, cápsula de antebrazo ×1.4, holgura de 4 cm (A31, A33) |
| Pelo atrapado o distinto en cada carga | `settlePhysics` (A24) |
| Mechones rígidos al inclinar la cabeza | gravedad de mechones largos (A25) |
| Cara triste o congelada | sonrisa de Hola y parpadeo (A28, A29) |
| Mano flotando frente a la cara (se ve de lado) | `faceContact`: la yema se apoya en la piel medida (A35) |
| Codo alto y antebrazo horizontal con la mano en la cara | la mano gira sobre la yema, elegido junto con el brazo (A35) |
| Mano que se va al costado con dos manos encimadas | `palmUp`: orientación registrada, sin usar la detección (A36) |
| Latigazo al girar la palma hacia arriba | giro del antebrazo en rango anatómico (A36) |
| La mano cambia de configuración a mitad de la seña | `handshapeSpan` (A38) |
| Tirón en la muñeca al soltar la cara | `faceContact` que termina con la mano quieta (A38) |
| Manos cortadas en el borde de abajo | encuadre desde cadera + 0.1 torsos (A37) |
| Plantilla que sale de la mano de apoyo | `hand` registrada en la seña (A37) |
| Torso de maniquí | respiración (A34) |
| Reconocimiento: la práctica toma la mano de apoyo al encimar las manos | dos manos y `HandTracker` con la mano registrada (D38) |
| Reconocimiento: la etiqueta Left/Right se voltea al tocarse las manos | el seguimiento mantiene la etiqueta del inicio (D38) |
| Reconocimiento: inclinar la mano 15° tumba la seña | forma sin rotación y orientación con zona muerta de 25° (D39) |
| Reconocimiento: "no me reconoce" sin saber por qué | indicación de qué falta y `?detalle=1` (D40) |
| Reconocimiento: la seña pide los movimientos de preparación del video | plantilla recortada al `window` de la animación |
| Reconocimiento: la mano quieta valida | compuerta de movimiento (D36) |
| Reconocimiento: la seña valida hecha en cualquier lugar | compuerta de lugar respecto a la cara (D37) |

## Trampas conocidas

- `rig.position(bone)` devuelve el vector guardado, no una copia: haz `.clone()`
  antes de `lerp`/`add`. Mutarlo rompió todo el retargeting una vez (A31).
- Los colliders de springbone agregados después de cargar **no se actualizan**
  si no se reordenan las articulaciones: se quedan en la T-pose. `addHairColliders`
  ya llama a `manager.addJoint(first)`. Cualquier collider nuevo va antes de esa línea (A34).
- En `page.evaluate` se pueden importar módulos de la app con
  `await import('/src/avatar/rig.ts')`, pero no paquetes (`import('three')` falla).
  Para crear un `Vector3`, usa `rig.position('hips').constructor`. El gancho
  `window.__enlazaAvatar` expone `{ player, vrm, rig }`.
- La silueta del cuerpo mide la camisa holgada. Cerca del hombro el brazo
  siempre está "dentro": por eso solo se prueba el último cuarto del brazo (A30).
- La cara no se extrae del video: MediaPipe marca sonrisa durante un puchero (A27).
- No cortes el tramo antes de suavizar: deforma el arranque (A17).
- Reconocimiento: velocidad, sostener la posición, apoyar más abajo o centrar
  la seña **no** fueron causa de fallos (medido con `stress-sign`). Antes de
  culpar al tiempo o al lugar, mira la rotación y la forma en el desglose.
- Reconocimiento: la palma abajo donde la seña va palma arriba (o al revés)
  debe seguir fallando; es un error real. Si la animación del avatar no deja
  clara la palma, arréglalo en el avatar (`palmUp`), no en el reconocimiento.
- `tune-motion.mjs` todavía lee los cachés viejos de una mano
  (`*.handlandmarker*.json`); los de dos manos son `*.hands2*.json`.
- Cuando algo se vea mal, mídelo antes de ajustar a ojo. Cada corrección
  documentada salió de medir: posiciones con el gancho, `check-contacts` y
  `measure-smoothness`.
