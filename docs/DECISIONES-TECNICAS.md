# Decisiones técnicas — Enlaza

**Fecha:** 2026-07-31. Registro de cada decisión relevante tomada durante la construcción del MVP, con su porqué y qué alternativa se descartó. Formato inspirado en ADRs (Architecture Decision Records), pensado para que puedas defender o revisar cualquiera de estas decisiones sin haber estado en la sesión donde se tomaron.

---

## Repositorio y organización

### D1. Monorepo con npm workspaces (no repos separados, no Turborepo/Nx)
**Qué:** un solo repo con `apps/web`, `apps/api` y `packages/cv-model`, gestionado con la función nativa de workspaces de npm (un solo `package-lock.json` en la raíz).
**Por qué:** el paquete de CV lo consume el frontend hoy y podría consumirlo un servicio de entrenamiento mañana — en repos separados eso implica publicar versiones a npm o usar submódulos, fricción enorme para una persona. Los workspaces de npm resuelven el enlace local sin herramientas extra. Turborepo/Nx agregan caché y orquestación que valen la pena con 10+ paquetes y un equipo, no con 3 paquetes y una persona.
**Descartado:** Yarn/pnpm (npm ya estaba instalado y sus workspaces bastan), monorepo con herramienta dedicada (complejidad sin beneficio a esta escala).

### D2. `Módulo 2/` excluido del repo vía .gitignore
**Qué:** la carpeta con las entregas académicas (entrevistas en video con nombres, datos de personas sordas y contexto de menores del ICAL) está en el working tree pero jamás se versiona.
**Por qué:** el repo es público y el brief §11 es explícito: ese material se recolectó para una entrega académica, sin consentimiento de publicación en GitHub. Ignorarlo en git (en vez de moverlo de carpeta) permite que conviva en tu disco sin riesgo de publicarlo por accidente.

### D3. Licencia MIT
**Qué:** archivo LICENSE con MIT a nombre de Diego Gallo.
**Por qué:** decisión ya tomada en el brief §10 — para un proyecto de impacto social, MIT maximiza la posibilidad de que otros retomen o construyan encima, pidiendo solo mantener el crédito.

### D4. Commits pequeños y descriptivos, push directo a `master`
**Qué:** cada pieza (diseño, monorepo, cv-model, api, wiring, práctica, tests, docs) es un commit independiente con mensaje que explica el porqué, no solo el qué.
**Por qué:** eres el único desarrollador — un flujo de PRs contra ti mismo es teatro. El valor está en poder hacer `git log` y entender la historia, y en poder revertir una pieza sin arrastrar las demás.

---

## Frontend

### D5. Vite + React + TypeScript (SPA), no Next.js
**Qué:** aplicación single-page clásica compilada con Vite.
**Por qué:** el brief sugería "React/Next.js razonable". Se eligió SPA porque: (1) toda la funcionalidad interesante (cámara, MediaPipe, clasificación) es **client-side por diseño** — el server-side rendering de Next no aporta nada ahí; (2) no hay SEO que ganar en una app con login; (3) Vite es más simple de razonar y más rápido en desarrollo; (4) la ruta a app móvil del brief (§9, React Native) depende de React, no de Next. Elegir Next habría agregado un runtime de servidor para servir... una SPA.
**Costo asumido:** si algún día se quiere landing page indexable, se hace aparte (estática) o se migra solo esa página.

### D6. `react-router` v8 directo (no `react-router-dom` v7)
**Qué:** el enrutador se importa del paquete `react-router` en su versión 8.3.
**Por qué:** `npm audit` marcó la gama 7.12–8.2 con una vulnerabilidad (CSRF en modo RSC). Aunque no usamos RSC, dejar un audit rojo en un repo público es mala señal y confunde después. Desde v7, `react-router-dom` es solo un alias de compatibilidad; el parche estaba en `react-router@8.3.0`. Migrar fue cambiar los imports — la API (BrowserRouter, Routes, NavLink…) es la misma.

### D7. CSS Modules + design tokens en variables CSS (no Tailwind, no styled-components)
**Qué:** cada componente tiene su `.module.css`; la paleta/tipografías/radios viven como `--color-*`, `--font-*`, `--radius-*` en `index.css`, con nombres **agnósticos al tema** (`--color-surface-1`, no `--color-dark-gray`).
**Por qué:** (1) el mockup de Claude Design define tokens exactos (#0E1014, #93B6EF, Outfit/Figtree/IBM Plex Mono) — mapearlos 1:1 a variables CSS hace trivial verificar fidelidad al diseño; (2) los nombres agnósticos permiten implementar el tema claro (mockup pendiente) como un bloque de overrides en `:root[data-theme="light"]` **sin tocar ni un componente**; (3) CSS Modules da scoping sin dependencias ni runtime. Tailwind habría metido un vocabulario intermedio entre el mockup y el código; styled-components, un runtime JS para nada.

### D8. Estado global mínimo: Context para auth, hook `useApi` para datos (no Redux/TanStack Query)
**Qué:** un `AuthContext` (token + usuario en localStorage) y un hook de 40 líneas que hace fetch on-mount con loading/error/reload.
**Por qué:** hay exactamente un estado global real (la sesión). Los datos de servidor se leen por página y no se comparten entre vistas con requisitos de sincronización — el caso que justifica TanStack Query (caché, invalidación, refetch) aún no existe. Cuando Práctica libre y Diccionario compartan catálogo cacheado, ese será el momento de meterlo.

---

## Backend

### D9. Fastify (no Express, no Python)
**Qué:** API HTTP en Fastify 5.
**Por qué:** el brief dejaba Node vs Python abierto, con ventaja para Python "si el modelo de CV se sirve en el mismo lenguaje" — pero la decisión D13 (CV en el navegador) elimina esa ventaja: el backend no toca el modelo. En Node: Fastify sobre Express por validación de esquemas integrada (los bodies se validan declarativamente, sin middleware extra), mejor rendimiento y `app.inject()` para tests sin levantar un puerto real.

### D10. SQLite con `node:sqlite` nativo (no Postgres, no better-sqlite3, no ORM)
**Qué:** la base de datos es un archivo SQLite manejado con el módulo `node:sqlite` incluido en Node 22.13+; SQL escrito a mano con prepared statements.
**Por qué:** (1) escala del MVP: un piloto de 15 personas no necesita un servidor de BD; (2) `better-sqlite3` requiere compilación nativa — en Windows eso es una fuente clásica de fricción (node-gyp, Visual Studio Build Tools), y el módulo nativo de Node la elimina por completo; (3) `:memory:` hace los tests instantáneos y perfectamente aislados; (4) un ORM (Prisma/Drizzle) agrega una capa de generación de código para 6 tablas — el SQL directo es más corto y más claro aquí.
**Costo asumido:** migrar a Postgres si el proyecto crece implica reescribir `db.ts` y los statements. Está aislado a propósito (los routes reciben `db` inyectado).
**Nota:** `node:sqlite` emite un ExperimentalWarning en Node 24 — es funcional y estable en la práctica; si molesta, se silencia con `--no-warnings=ExperimentalWarning`.

### D11. Esquema desacoplado del idioma desde el día uno
**Qué:** `languages` es una tabla; `lessons` referencia `language_id`; ningún código dice "LSC" salvo los datos seed.
**Por qué:** requisito explícito del brief (§3, §9): LSM llega después y "la arquitectura de datos debe estar desacoplada del idioma desde el día uno para no rehacer trabajo". Agregar LSM será insertar filas, no migrar esquema.

### D12. Auth: JWT firmado + scrypt de `node:crypto` (no bcrypt, no sesiones en BD, no OAuth)
**Qué:** registro/login con email+contraseña; hash con `scryptSync` (sal aleatoria por usuario, comparación en tiempo constante); token JWT HS256 de 7 días vía `jsonwebtoken`.
**Por qué:** el brief pide "autenticación básica es suficiente" (§3). scrypt viene en la stdlib de Node y es memory-hard (mejor que sha/pbkdf2 contra GPUs, sin la dependencia nativa de bcrypt). JWT evita tabla de sesiones y middleware de estado — con 7 días de vida, el peor caso de un token robado es acotado. OAuth/social login es complejidad de v2.
**Deuda consciente:** el secreto JWT tiene un fallback de desarrollo hardcodeado (`dev-secret-change-me`) — está señalado como pendiente de producción en PENDIENTES-MVP §3.

### D13. La API nunca recibe video ni landmarks — solo resultado y puntaje
**Qué:** `POST /api/attempts` acepta `{signId, correct, score}`. No hay ningún endpoint que acepte frames, landmarks o video.
**Por qué:** brief §11 — los landmarks de mano son dato biométrico-adyacente. La decisión más robusta de privacidad no es "protegemos bien el dato" sino "el dato nunca llega al servidor". Esto además simplifica el consentimiento del piloto y elimina costo de almacenamiento/inferencia en servidor.

### D14. Regla de progresión: secuencial simple
**Qué:** la primera lección está desbloqueada; cada lección se desbloquea al completar la anterior. Una seña se "domina" con un intento correcto y eso es idempotente.
**Por qué:** el diseño de la ruta (mapa de nodos con candados) implica exactamente esta semántica y el brief pide progresión "simple, con espacio en el modelo de datos para más" (§3). La tabla `attempts` guarda cada intento con puntaje y fecha — repetición espaciada, decaimiento de dominio o niveles se pueden construir encima sin migrar datos.

---

## Visión computacional (el corazón del proyecto)

### D15. Procesamiento 100% en el cliente con MediaPipe HandLandmarker
**Qué:** la cámara se procesa en el navegador; MediaPipe (WASM/GPU) extrae 21 landmarks por frame; la clasificación corre en JS local.
**Por qué:** es la recomendación explícita del brief (§4.1) y por buenas razones: costo cero de inferencia en servidor, latencia de feedback inmediata (crítica para el loop "hazlo → te digo si está bien"), y privacidad estructural (D13). La "arquitectura AWS" de la documentación original queda como plan de escala, no requisito.
**Detalle:** MediaPipe se importa dinámicamente (`await import(...)`) solo al entrar a práctica/calibración — Vite lo separa en su propio chunk y el resto de la app no paga esos ~150 KB.

### D16. Clasificador por plantillas (nearest-template) en vez de un modelo entrenado
**Qué:** cada seña estática se representa por un vector-centroide ("plantilla") construido de 3+ muestras; clasificar = similitud coseno contra todas las plantillas; correcto = la mejor coincidencia es la seña objetivo y supera un umbral (0.92).
**Por qué:** **no existe dataset de LSC para entrenar** (brief §4.3 — la única fuente es un video de YouTube; el repo del compañero que resolvía esto ya no existe, §4.2/§13). Ante ese vacío había dos caminos: bloquear el desarrollo hasta tener dataset, o elegir un clasificador *few-shot* que funcione con 3 muestras por clase. El nearest-template es eso: sin entrenamiento, interpretable (el puntaje ES la similitud), depurable (puedes ver qué plantilla ganó), y con una ruta de mejora clara (cuando haya dataset: red pequeña sobre los mismos vectores normalizados — la interfaz `classify(vector) → ranked` no cambia).

### D17. Normalización invariante a posición, escala y mano — pero NO a rotación
**Qué:** cada frame se convierte a un vector de 63 dims: se refleja la mano izquierda a canónica derecha, se resta la muñeca (posición) y se divide por la distancia muñeca→nudillo medio (escala/distancia a cámara). La rotación en el plano NO se normaliza.
**Por qué:** posición en el encuadre y distancia a la cámara son ruido obvio (nadie se para igual dos veces). El reflejo permite señar con cualquier mano. Pero la **orientación** de la mano es información lingüística — hay señas que se distinguen principalmente por rotación; normalizarla las colapsaría en la misma clase. Esta asimetría está documentada en el código (`normalize.ts`).

### D18. Señas dinámicas con DTW sobre ventana deslizante (no LSTM/transformer, no "solo el frame final")
**Qué:** para señas con movimiento, se acumulan frames en una ventana de ~2 s; cada 400 ms se remuestrea a 16 frames y se compara por Dynamic Time Warping contra la plantilla-secuencia; la distancia se mapea a similitud.
**Por qué:** es la respuesta al problema central identificado en el brief (§4.2, estáticas vs dinámicas). DTW maneja el problema real de las señas dinámicas — cada persona la hace a distinta **velocidad** — alineando temporalmente las secuencias sin entrenar nada. Un modelo secuencial aprendido (LSTM/GRU/transformer) necesita justo el dataset que no existe. El remuestreo a 16 frames acota el costo de DTW (O(16×16) por plantilla) para correr en tiempo real.

### D19. Umbrales: 0.92 estático / 0.6 dinámico, mantener 8 frames, reintento a los 20
**Qué:** constantes en `cv-model` (`STATIC_THRESHOLD`, `DYNAMIC_THRESHOLD`, `holdFrames=8`, `retryFrames=20`).
**Por qué se eligieron así:** el 0.92 de coseno salió de los tests sintéticos como punto donde poses distintas no se cruzan pero el jitter de una misma pose sí pasa; el "mantener 8 frames" (~250 ms a 30 fps) evita validar por un frame de suerte al pasar la mano; el "reintento a 20 frames de una seña incorrecta estable" distingue "está intentando otra cosa" de "está en transición". **Son hipótesis razonables, no verdades:** están centralizadas y nombradas precisamente para calibrarlas con datos reales (PENDIENTES-MVP §1.2, §1.4).

### D20. `SessionValidator`: la lógica de práctica vive en el paquete de CV, no en React
**Qué:** una máquina de estados pura (waiting/tracking/correct/retry) que consume frames y decide; el hook de React (`usePracticeSession`) solo la conecta a la cámara y al estado de UI.
**Por qué:** la regla "mantén la seña N frames, si sostienes otra te sugiero reintentar, para dinámicas evalúo por ventana" es lógica de dominio, no de interfaz. En el paquete: se testea con arrays de frames sin navegador (7 tests directos), y el día que exista app móvil (brief §9) se reutiliza tal cual.

### D21. Detector inyectable: `window.__enlazaFakeDetector`
**Qué:** la práctica obtiene su fuente de landmarks vía `createDetector()`, que devuelve MediaPipe salvo que un test haya instalado un detector falso en `window`. El falso declara `needsCamera: false` y la página entonces ni siquiera pide `getUserMedia`.
**Por qué:** el brief §7 exige tests del flujo de lección "con mocks del clasificador para no depender de cámara real en CI". Ni jsdom ni Playwright headless tienen cámara. Con este seam de una línea, los tests unitarios y el E2E *ejecutan el pipeline completo de validación real* (normalización, clasificación, máquina de estados) — lo único falso es el origen de los frames. Es la diferencia entre probar la app de verdad y probar un mock de la app.

### D22. Plantillas en localStorage por dispositivo, con export/import JSON (+ página /plantillas)
**Qué:** las plantillas de referencia se graban en el navegador (página de calibración: 3 muestras para estáticas, 2 s de grabación para dinámicas), viven en localStorage y se comparten exportando/importando un JSON.
**Por qué:** (1) sin dataset, alguien tiene que **crear** las referencias — la página de calibración es la herramienta para hacerlo siguiendo el video del alfabeto (brief §4.3); (2) guardarlas server-side habría requerido endpoints, cuentas con roles y una decisión de privacidad extra — para el MVP, localStorage + JSON compartible da el 90% del valor con 10% del costo; (3) mantiene coherencia con D13: los datos derivados de tu mano se quedan contigo salvo que tú exportes el archivo.

### D23. Escape honesto: "Marcar practicada (sin validación)"
**Qué:** si una seña no tiene plantilla en el dispositivo, la práctica lo dice claramente y ofrece continuar sin validación (además de enlazar a calibración).
**Por qué:** la regla de producto es "solo avanzas si la haces bien", pero hoy 73 señas tienen 0 plantillas — aplicarla a rajatabla haría la app inutilizable e indemostrable. Elegimos degradar con honestidad (el botón dice explícitamente que no valida) en vez de fingir validación o bloquear todo. Cuando el set de plantillas esté completo, este camino puede eliminarse o dejarse solo para desarrollo.

### D24. Contenido de señas marcado como no validado (`validated = 0`) y avisado en la UI
**Qué:** las 73 señas del seed llevan descripciones placeholder y flag de no-validado; la lección muestra "Contenido provisional: aún no validado con ICAL ni personas sordas señantes".
**Por qué:** ética básica del dominio (brief §4.3, §11): yo no sé LSC, y presentar señas inventadas o mal descritas como enseñanza real a personas oyentes sería exactamente el daño que el proyecto quiere evitar. El flag existe en datos (no solo en UI) para que el flujo de validación con ICAL sea un update auditable, no un "confía en mí".

---

## Testing

### D25. Pirámide completa desde el día uno, con la regresión de modelo como suite especial
**Qué:** 28 tests de cv-model (incluyendo la suite de regresión con umbral 90%), 27 del API (por endpoint, BD en memoria), 8 del frontend (RTL con API y detector mockeados), 1 E2E Playwright (stack real completo).
**Por qué:** requisito del brief (§7) y del encargo ("pruebas desde el inicio"). Dos decisiones dentro de la decisión:
- **La regresión de modelo corre sobre fixtures sintéticos** (poses de un PRNG con semilla): sin datos reales no puede medir precisión del mundo real — y el archivo lo dice en un comentario grande para que nadie se engañe. Lo que SÍ garantiza: si un cambio en la normalización o el clasificador rompe la capacidad de discriminar 27 clases, o la invarianza a espejo/traslación/escala, la suite falla. El plan de sustitución por fixtures reales mantiene las mismas aserciones (PENDIENTES-MVP §1.3).
- **El E2E usa el API real con BD en memoria** (`ENLAZA_DB_PATH=:memory:`): cada corrida parte de cero sin limpiar nada, y aún así prueba registro/login/atempts contra el servidor de verdad, no contra mocks.

### D26. Los tests del frontend mockean el módulo API, no `fetch`
**Qué:** `vi.mock('../src/api/client')` con implementaciones controladas por test, en vez de interceptar fetch global (MSW o stubs de fetch).
**Por qué:** el contrato interesante para la UI es "qué devuelve `api.lessons()`", no la serialización HTTP — esa capa ya la cubren los 27 tests del API y el E2E. Mockear el módulo es más directo, sin dependencia extra (MSW) ni duplicación de rutas.

---

## Diseño (proceso, no solo resultado)

### D27. Los mockups de Claude Design se tradujeron a componentes con datos reales, no se copiaron como HTML
**Qué:** el HTML del mockup (todo estilos inline, datos quemados: "Mariana C.", "6 días", "48 señas") se descompuso en componentes (Logo, Sidebar, LessonNode, ProgressRing…) con CSS Modules y props, y cada número quemado se reemplazó por datos del API.
**Por qué:** copiar el HTML habría dado una maqueta bonita e inerte. El criterio fue: los **tokens** del mockup (colores, fuentes, radios, la regla "pasteles nunca de fondo grande") son ley; la **estructura** se reorganiza como lo pide React. La página interna `/design-tokens` reproduce la tabla de tokens del mockup para poder verificar fidelidad en cualquier momento.

### D28. Se implementó primero el modo oscuro (y solo ese)
**Qué:** de los tres archivos de diseño, se implementó `Enlaza - Modo oscuro.dc.html`; tema claro y marca quedan pendientes.
**Por qué:** fue el archivo señalado en el handoff. Salió gratis una ventaja: el propio mockup declara "la práctica con cámara es siempre oscura, en ambos temas" — implementar primero el oscuro significa que la pantalla más importante ya está en su forma final.

---

## Avatar 3D

Las decisiones del avatar (extracción, limpieza de la animación, retargeting, pelo, render) están en [AVATAR-DECISIONES.md](AVATAR-DECISIONES.md), numeradas A1, A2…

---

## Reconocimiento con plantillas de los videos de ICAL (sept 2026)

### D29. La etiqueta de mano de las plantillas se MIDE contra el detector de la app
**Qué:** `tools/content/common.mjs` etiqueta como `'Right'` la mano que Holistic reporta como `rightHand` (`appHandedness`), y la plantilla de Hola se regeneró.
**Por qué:** la plantilla se había construido suponiendo, por la documentación de MediaPipe, que HandLandmarker etiqueta al revés en video sin espejar. Al medirlo con el mismo modelo y versión que usa la app (`diagnose-practice.mjs`), la mano derecha de la señante llega como `'Right'` en 72/72 frames. Como `toFeatureVector` espeja las manos `'Left'`, la plantilla quedó espejada respecto a lo que ve la cámara, y **Hola nunca podía validarse: 0.25 contra su propio video, con umbral de 0.60**. Así se explica lo observado en la práctica: la app detectaba la mano y dibujaba los nodos, pero nunca reconocía la seña.
**Descartado:** confiar en la documentación sin medir. Queda escrito en el código de dónde sale la convención.

### D30. La plantilla usa el mismo tramo de seña que el avatar
**Qué:** `build-templates.mjs` recorta cada video con el `window` registrado en `apps/web/src/avatar/animations.ts` (Hola: 0.15–1.8 s) antes de construir la plantilla.
**Por qué:** DTW compara la ventana de captura completa contra la plantilla completa. La plantilla de Hola incluía el regreso a reposo con las manos entrelazadas (hasta 2.8 s), algo que nadie hace al copiar la seña. Aun con la etiqueta corregida, hacer solo la seña daba 0.42 y no validaba. Con el tramo: 0.69. Un solo registro de "qué es la seña" evita que el avatar enseñe una cosa y el validador espere otra.

### D31. Diagnóstico con el detector real de la app, no solo con los landmarks de la plantilla
**Qué:** `tools/content/diagnose-practice.mjs` pasa el video por el mismo HandLandmarker de la práctica (`hand-extract-page.html`) y lo repite por `SessionValidator` en escenarios de uso: solo la seña, más lento o más rápido, repeticiones seguidas y cámara 4:3.
**Por qué:** `verify-template.mjs` reutilizaba los landmarks de Holistic con la misma convención de etiqueta con que se construyó la plantilla, así que el error de D29 no podía aparecer ahí (daba "Todo en orden").
**Resultado tras D29 y D30** (misma señante del video):

| Cámara | Puntaje | ¿Valida? |
|---|---|---|
| 16:9 | 0.66–0.69 | sí, en todos los escenarios |
| 4:3 | 0.60–0.62 | sí, pero al filo del umbral |

Sin falsos positivos contra las otras 9 señas de cortesía (máximo 0.50, Buenos días).
**Riesgo de cámara 4:3:** resuelto en D33. **Sigue abierto:** no se ha medido con otra persona; el techo con la misma señante es el punto de referencia, y la precisión real solo se sabe probando con usuarios.

### D32. El puntaje se muestra como nivel en palabras, no como porcentaje
**Qué:** al validar, la práctica muestra "¡Correcta! · Bien / Muy bien / Excelente" en vez de "· 66%". `scoreLevel` (cv-model, `quality.ts`) divide en tercios el tramo entre el umbral de aceptación y el techo práctico de cada tipo de seña. Dinámica: 0.60–0.72, el techo medido con la señante de Hola (0.69 antes de D33). Estática: 0.92–0.99, un techo hipotético por calibrar. El puntaje crudo se sigue guardando en el intento.
**Por qué:** el puntaje de DTW es `1 / (1 + distancia)` y nunca llega a 1 con landmarks reales; ni la propia referencia pasa de 0.72. Mostrado como porcentaje, un 66% (cerca del máximo alcanzable) se leía como una nota baja o como "66% de certeza", que no es.
**Descartado:** reescalar a un porcentaje 0–100 (seguiría pareciendo certeza) y ocultar el nivel (se pierde retroalimentación útil para mejorar).

### D33. Features independientes de la proporción de la cámara (v2), con migración automática
**Qué:** `toFeatureVector` multiplica x y z por la proporción de la imagen (ancho/alto) antes de normalizar, y cada `HandFrame` trae esa proporción, que es obligatoria. Las plantillas pasan a formato versión 2 (`FEATURE_VERSION`):
- **Incluidas con la app:** se regeneran con la proporción del video fuente.
- **Grabadas en `/plantillas` (v1):** se migran solas al abrir la cámara en la práctica o en la calibración, con la proporción de esa cámara, y se borra la copia v1.
- **Archivos v1 importados de otro dispositivo:** se migran suponiendo 16:9, lo que la app pide a la cámara.

**Por qué:** MediaPipe normaliza x por el ancho y y por el alto (z va en la escala de x), así que la misma mano queda deformada de forma distinta en una cámara 16:9 que en una 4:3. Con la plantilla de Hola, una webcam 4:3 quedaba al filo del umbral (0.60–0.62).

**Resultado medido** (`diagnose-practice.mjs`, misma señante; sin falsos positivos, el máximo bajó de 0.50 a 0.45):

| Escenario | Antes (v1) | Ahora (v2) |
|---|---|---|
| Cámara 16:9 | 0.66–0.69 | 0.66–0.72 |
| Cámara 4:3 | 0.60–0.62 | 0.68–0.73 |

**Migración exacta, no aproximada:** un vector v1 guarda (punto − muñeca) / escala. Al escalar x y z y renormalizar por el nuevo largo muñeca→nudillo medio (que se lee del propio vector), la escala original se cancela y el resultado es idéntico a recalcular desde los landmarks, con error < 1e-9 en las pruebas. En promedios (estáticas) y secuencias remuestreadas (dinámicas) es una aproximación muy cercana. La proporción no se guarda por plantilla: con features v2 ya no hace falta, y la versión del archivo basta para saber si hay que migrar.

**Descartado:**
- Pedir que se regraben las plantillas: pierde trabajo del usuario sin necesidad.
- Suponer 16:9 también para las locales: la cámara que las grabó es casi seguro la del mismo dispositivo, y su proporción se puede leer.

---

## Un párrafo de síntesis

Casi todas las decisiones se derivan de tres restricciones que fija el brief: **(1) no existe dataset de LSC** → clasificador few-shot por plantillas + herramienta de calibración + regresión sintética con plan de sustitución; **(2) el video del usuario es dato sensible** → todo el CV en el cliente, el API solo ve resultados, plantillas en localStorage; **(3) esto lo mantiene una persona con presupuesto ~cero** → SPA estática, SQLite sin deps nativas, stdlib de Node para crypto, workspaces de npm sin herramientas extra. Donde hubo que inventar números (umbrales, frames de hold) están nombrados, centralizados y marcados para calibrarse con datos reales.
