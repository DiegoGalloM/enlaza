---
name: avatar-sena
description: Receta y lista de control para llevar una seña nueva al avatar 3D de Enlaza (o pulir una existente) sin repetir errores ya resueltos. Usar cuando se pida hacer, revisar, mejorar o corregir la animación del avatar de cualquier seña (Gracias, Buenos días, Permiso, etc.), o cuando el avatar se vea triste, rígido, con la mano abierta, o atravesándose (brazo en la camiseta, pelo a través de la mano).
---

# Seña nueva en el avatar 3D

El avatar ya resuelve en el pipeline los problemas de Hola y Por favor. Una seña
nueva casi siempre se hace **registrando datos** en `apps/web/src/avatar/animations.ts`
(tramo, cara y configuración manual), no cambiando el retargeting. El porqué de
cada decisión está en `docs/AVATAR-DECISIONES.md` (A1–A34). Léelo antes de tocar
`retarget.ts`, `rig.ts`, `cleanup.ts` o `face.ts`.

## Señas pendientes (lección `cortesia`)

| signId | Glosa | Video | Estado |
|---|---|---|---|
| lsc-cortesia-0 | Buenos días | buenos-dias.mp4 | pendiente |
| lsc-cortesia-1 | Buenas tardes | buenas-tardes.mp4 | pendiente |
| lsc-cortesia-2 | Buenas noches | buenas-noches.mp4 | pendiente |
| lsc-cortesia-3 | Gracias | gracias.mp4 | pendiente |
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
- Rama `feature/avatar-poc`. No hagas commit sin que lo pidan.

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
   - `handshape: { right: 'puño' }` cuando los dedos no se ven en el video
     (puño, dedos contra el cuerpo). MediaPipe los da a medio doblar y el
     avatar muestra un gancho abierto (A32). Para una configuración nueva
     (plana, índice, C…), agrégala a `HANDSHAPE_FLEX` en `retarget.ts`, con su
     pulgar en `handshapeThumbTarget`.
4. **Revisar en `/avatar-poc?sena=<signId>`.** Ver la lista de control abajo.
5. **Plantilla de reconocimiento y verificación.** Son los pasos 5–6 de la
   "Receta para una seña nueva" en `docs/AVATAR-DECISIONES.md`:
   `build-templates --only <todas las revisadas>`, `verify-template`,
   `diagnose-practice` y `tune-motion`.
6. **Documentar** en `docs/AVATAR-DECISIONES.md` solo lo que la seña haya
   enseñado de nuevo (numeración A35 en adelante), y actualizar la tabla de arriba.

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
| Torso de maniquí | respiración (A34) |

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
- Cuando algo se vea mal, mídelo antes de ajustar a ojo. Cada corrección
  documentada salió de medir: posiciones con el gancho, `check-contacts` y
  `measure-smoothness`.
