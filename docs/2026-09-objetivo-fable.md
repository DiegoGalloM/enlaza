# Objetivo para Claude Fable — avatar 3D y pipeline de contenido ICAL

Septiembre 2026. Este es el encargo que se le dio a Fable a partir de la reunión de Diego con Victoria Olmos (rectora de ICAL). El brief de contenido de referencia está en `content/ical-2026-09/content-brief.md`.

## Contexto

Enlaza (antes ATLAS) es una web app de microaprendizaje de LSC. Ya existe una base técnica funcional: React+Vite (`apps/web`), Fastify+SQLite (`apps/api`), y un paquete `cv-model` que usa MediaPipe HandLandmarker para extraer 21 landmarks de mano por frame, los normaliza, y valida señas estáticas por similitud coseno contra plantillas (grabadas en `/plantillas`) y señas dinámicas por DTW. Todo el contenido de señas actual está marcado `validated=0` porque no ha sido revisado por ICAL ni por la comunidad sorda — mantén esa convención.

El proyecto está en GitHub y ya está clonado localmente en esta carpeta.

Acabamos de tener una reunión con Victoria Olmos, rectora de ICAL (aliado institucional ancla). Dio requisitos pedagógicos de FENASCOL: el contenido debe empezar por un "bautizo" (nombre-seña para cada persona oyente) y por normas de cortesía básicas — ya hay 10 videos mp4 de esas señas de cortesía. El abecedario sale de un video de YouTube como fuente provisional. La configuración manual (forma/orientación de la mano) cambia el significado de una seña por completo, y el contenido debe validarse con la comunidad sorda antes de escalarlo.

Todo el brief de contenido (lista de videos, requisitos pedagógicos, nota lingüística) está en `content/ical-2026-09/content-brief.md` dentro del repo.

## Objetivo

Hay dos fases, en este orden de prioridad:

**Fase 1 (prioridad ahora) — prueba de concepto de avatar 3D.** Extraer el movimiento de una seña ya grabada en video (elige la más simple para empezar) usando MediaPipe Holistic Landmarker, y retargetear ese movimiento a un modelo humanoide 3D genérico y riggeado (glTF o VRM) que NO se parezca a la persona del video de referencia ni, en lo posible, a Diego. Reproduce esa animación en la web app existente (three.js es la opción natural). Es una prueba de concepto, no un asset de producción: no tiene que verse pulida ni ser lingüísticamente perfecta. Que funcione para una sola seña ya es un resultado exitoso de esta fase.

Nota de herramientas: Ready Player Me cerró permanentemente en enero de 2026 — no asumas que existe ni lo uses. Investiga qué herramienta gratuita de mallas humanoides riggeadas está vigente HOY (Mixamo, VRoid, un modelo CC0 de un repositorio de assets, u otra) y documenta en el commit correspondiente cuál elegiste y por qué.

**Fase 2 (siguiente, después de tener un resultado o un timeout claro en la fase 1) — pipeline de ingestión de contenido.** Convierte las fuentes de `content/ical-2026-09/` (10 videos mp4 de cortesía + video de abecedario en `raw-content/abecedarioLSC.mp4`, gitignorado — no lo commitees, solo las plantillas que salgan de procesarlo) en plantillas de `/plantillas` de forma reproducible, no carga manual seña por seña. Agrega la lección de "bautizo" en el onboarding (nombre-seña para el usuario), antes de la lección de cortesía.

## Criterios de éxito

**Fase 1:**
- Al menos una seña se ve reproducida por un modelo 3D en la UI (aunque sea en una pantalla de prueba, no integrada aún al flujo de lección).
- El modelo no es reconocible como la persona del video de referencia ni (idealmente) como Diego.
- Si el retargeting completo no se logra en un tiempo razonable, documenta qué sí funcionó (extracción de landmarks, modelo cargado en la escena, etc.) en vez de dejarlo a medias sin reporte.

**Fase 2:**
- Un usuario nuevo puede pasar por bautizo → lección de cortesía (plantillas derivadas de los videos de cortesía) → lección de abecedario (plantillas derivadas del video) → feedback en tiempo real del cv-model existente.
- Todo contenido nuevo queda marcado `validated=0`, igual que el resto.
- Los tests existentes (unit, e2e) siguen pasando.

## Restricciones y límites

- No expandas el modelo de reconocimiento a cara/cuerpo en esta iteración — sigue siendo solo manos. Extender a Holistic Landmarker para gramática no manual es un tema de post-MVP (cuando el proyecto llegue a frases), no de ahora.
- No inventes vocabulario, glosas ni reglas gramaticales de LSC que no vengan de FENASCOL/ICAL.
- Haz commits pequeños y frecuentes, uno por cada sub-paso identificable (ej.: "extracción de landmarks de la seña de referencia", "modelo humanoide cargado en la escena", "retargeting mapeado para una seña", "animación reproduciéndose en la UI"). Trabaja en una rama nueva (`feature/avatar-poc`) en vez de directo en `main`.
- CI/CD no es prioridad ahora. Si sobra tiempo y presupuesto después de las fases 1 y 2, un workflow simple de GitHub Actions que corra `npm test` en cada PR es un buen primer paso — no lo hagas si compite con las fases 1-2.
- En `content/ical-2026-09/raw-content/` (gitignorado) también está el libro completo de Oviedo sobre gramática de LSC. Si queda tiempo, localiza ahí la sección sobre configuración manual y cita el fragmento relevante en `content-brief.md` — no es bloqueante para las fases 1-2, y el libro completo nunca se commitea.
- Queda poco presupuesto de crédito — prioriza dejar un resultado demostrable en cada fase sobre pulir detalles no esenciales.

## Nivel de esfuerzo

Alto — especialmente la fase 1, que es exploratoria sobre un panorama de herramientas que cambia rápido.

Empieza por crear la rama `feature/avatar-poc`, revisar el estado actual del repo (README, estructura de `apps/web` y `packages/cv-model`), y confirmar qué landmarker y qué malla riggeada gratuita vigente vas a usar antes de escribir código.
