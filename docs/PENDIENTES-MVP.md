# Pendientes para un MVP funcional — Enlaza

**Fecha:** 2026-07-31 · **Estado del código:** todo lo descrito en el README raíz existe y pasa tests (63 unit/integración + 1 E2E). Este documento lista **lo que falta** para que una persona real, sin contexto del proyecto, pueda aprender señas de verdad con la app.

La regla para priorizar: *el MVP funciona cuando una persona oyente sin conocimiento de LSC puede completar la lección del alfabeto con validación real por cámara y recordar las señas al día siguiente* (objetivo SMART, brief §5).

**Prioridades:** 🔴 P0 = sin esto no hay MVP · 🟡 P1 = sin esto el MVP es frágil o poco creíble · 🟢 P2 = mejora importante pero posterior al piloto.

---

## 1. 🔴 Datos de señas reales (EL bloqueante)

Hoy el pipeline de CV funciona pero está vacío: no hay ni una sola plantilla real de LSC. Todo lo demás depende de esto.

### 1.1 Grabar el set de plantillas del alfabeto
- Usar la página **/plantillas** con el video de YouTube del abecedario LSC como referencia (única fuente confirmada, brief §4.3).
- Empezar solo con **Alfabeto I (A–M)**: 12 estáticas + J dinámica. Es la primera lección y la más fácil (posturas fijas).
- Grabar cada letra con **3+ muestras variando ángulo** (la herramienta ya lo pide).
- Exportar el JSON y guardarlo en el repo (`data/templates/` — crear carpeta) para que cualquier dispositivo pueda importarlo. *Las plantillas son landmarks normalizados, no video: no son dato biométrico identificable, pero documentar igual de quién es la mano.*
- **Criterio de éxito:** en un dispositivo limpio, importar el JSON y validar las 13 señas de Alfabeto I frente a la cámara.

### 1.2 Probar generalización entre personas
- Las plantillas grabadas con TU mano deben validar la mano de OTRA persona. Probar con mínimo 3 personas distintas (tamaños de mano, tono de piel, luz distinta).
- Si la tasa de falsos rechazos es alta: ajustar `STATIC_THRESHOLD` (hoy 0.92, en `packages/cv-model/src/staticClassifier.ts`) y/o promediar plantillas de varias personas.
- **Criterio:** ≥90% de aceptación de señas bien hechas por una persona distinta a quien grabó la plantilla (la meta del brief §5).

### 1.3 Sustituir los fixtures sintéticos de la regresión de modelo
- `packages/cv-model/test/regression.test.ts` hoy corre sobre poses generadas con PRNG. El propio archivo documenta el plan: guardar muestras reales etiquetadas (capturas de landmarks por letra, de varias personas) en `data/processed/`, cargarlas en el test y **mantener las mismas aserciones** (accuracy ≥ 90%, falsos aceptados ≤ 10%).
- Sin esto, el "90%" que reporta la suite no significa nada sobre el mundo real.

### 1.4 Calibrar los umbrales dinámicos
- `DYNAMIC_THRESHOLD = 0.6` (DTW) es una suposición razonable sin datos. Grabar 2-3 señas dinámicas reales (J, Hola, Gracias) y encontrar el umbral que separa bien ejecutado de mal ejecutado.

---

## 2. 🔴 Videos de referencia por seña

La pantalla de lección muestra un placeholder rayado que dice "pendiente de grabación". Sin video de referencia, el usuario **no tiene de dónde aprender** la seña — la app solo evalúa, no enseña.

- **Mínimo viable:** para Alfabeto I, clips cortos (2-4 s, loop) de cada letra. Pueden ser: (a) grabaciones propias verificadas contra el video de YouTube, o (b) idealmente, grabaciones con una persona sorda señante o profesora de LSC (contacto ICAL, brief §4.3) — esto también resuelve la validación lingüística.
- **Técnica:** archivos MP4/WebM estáticos servidos desde `apps/web/public/videos/<signId>.mp4`; agregar columna `video_url` a la tabla `signs` (o convención por id). Los controles "cámara lenta" y "espejo" ya existen deshabilitados en la UI — habilitarlos es `playbackRate=0.5` y `transform: scaleX(-1)`.
- **Criterio:** en la lección, cada seña de Alfabeto I muestra su video en loop.

---

## 3. 🔴 Despliegue (que exista una URL)

Todo corre solo en localhost. Para el piloto (15 personas, brief §5) necesita estar en línea.

- **Web:** build estático (`npm run build -w @enlaza/web`) — cualquier host estático sirve (Vercel/Netlify/GitHub Pages con SPA fallback).
- **API:** necesita un proceso Node persistente. Opciones simples y baratas: Railway, Render, Fly.io. SQLite necesita **disco persistente** (volumen) — o migrar a Turso/Postgres si el host no da volumen (el código usa `node:sqlite` directo; migrar implica cambiar `db.ts` y los `prepare()`, está razonablemente aislado).
- **HTTPS obligatorio:** `getUserMedia` (cámara) solo funciona en HTTPS fuera de localhost. Cualquier host moderno lo da gratis.
- **Config pendiente de producción:**
  - `ENLAZA_JWT_SECRET` real (hoy default de dev, hardcodeado como fallback en `apps/api/src/auth.ts`).
  - CORS restringido al dominio real (hoy `origin: true` = cualquiera).
  - El frontend asume proxy `/api` de Vite — en producción hay que servir API y web bajo el mismo dominio (reverse proxy) o configurar la URL base del API.
- **Criterio:** abrir la URL pública en un celular, registrarse, y validar una seña con la cámara.

---

## 4. 🔴 Consentimiento y privacidad mínimos

La app enciende la cámara de la gente. Antes de ponerla frente a usuarios reales (brief §11):

- Pantalla/modal de **consentimiento antes de encender la cámara por primera vez**: qué se procesa (landmarks de la mano), dónde (solo en el dispositivo), qué se envía al servidor (solo resultado y puntaje del intento — ya es así en el código, hay que *decirlo*).
- Página corta de **política de privacidad** enlazada desde login y práctica.
- Si el piloto incluye menores (contexto ICAL): consentimiento de tutores — resolver con ICAL antes, no improvisar.

---

## 5. 🟡 Robustez del reconocimiento

Cosas que el pipeline actual **no** cubre y que aparecerán en el piloto:

- **Señas bimanuales:** el detector corre con `numHands: 1`. Varias señas de LSC usan las dos manos. Para el alfabeto casi todo es una mano, así que no bloquea el MVP-alfabeto, pero bloquea Saludos/Salud/etc. Requiere: `numHands: 2` + extender la normalización/plantillas a pares de manos (`packages/cv-model`).
- **Ubicación respecto al cuerpo:** muchas señas se distinguen por dónde se hacen (frente, pecho, mentón). Solo con landmarks de mano esa información se pierde (la normalización centra en la muñeca). Solución futura: MediaPipe Pose/Holistic para tener referencia del torso/cara. Para el alfabeto no es crítico.
- **Condiciones reales:** probar con luz baja, contraluz, cámaras 480p, fondos con gente. El brief §4.3 ya identifica este riesgo. Documentar qué falla y decidir si se mitiga con UX ("busca luz de frente") o con más muestras por plantilla.
- **Rendimiento en equipos modestos:** el delegate es `GPU` con fallback silencioso; medir FPS en una laptop vieja. Si va lento: bajar resolución de captura (ya está en 960×540) o procesar 1 de cada N frames.

---

## 6. 🟡 Contenido lingüístico validado

- Las **73 descripciones de señas son placeholders** ("Descripción pendiente de validación con ICAL") y todas tienen `validated = 0`. La UI ya lo advierte, pero un MVP creíble necesita al menos Alfabeto I con descripciones reales (forma/ubicación/movimiento) revisadas por alguien competente en LSC.
- Definir el **flujo de validación**: quién revisa (ICAL / profesora de LSC), cómo se marca (`UPDATE signs SET validated = 1` — considerar un mini-admin o script), y qué pasa con las señas que estén mal (corregir gloss/descripción/plantilla).
- La sección "Cómo se construye" (3 pasos del mockup) se quitó por no tener datos reales. Si se quiere de vuelta: agregar columnas `step_forma`, `step_ubicacion`, `step_movimiento` a `signs` y llenarlas durante la validación con ICAL.

---

## 7. 🟡 Flujo de aprendizaje completo (enseñar → practicar → repasar)

Lo que existe: ver seña → practicar → avanzar. Lo que falta para que se *aprenda* de verdad:

- **Práctica libre** (ítem del sidebar, hoy deshabilitado): repaso de señas ya dominadas, priorizando las de menor puntaje. El texto de la UI ya lo promete ("Las señas con menor dominio vuelven a aparecer en la práctica libre"). Los datos ya están (attempts con score); falta la pantalla y un endpoint `GET /api/me/review-queue`.
- **Diccionario LSC** (ítem del sidebar, hoy deshabilitado): lista buscable de todas las señas con su video. Es la pieza más simple: es un listado de lo que ya está en la BD.
- **Test de retención al día siguiente** (brief §5 — el indicador que más importa): un modo "examen" que pide N señas dominadas ayer sin mostrar el video de referencia, y guarda el resultado separado de la práctica. Sin esto el piloto no puede medir su métrica principal. Requiere: endpoint de selección de señas + pantalla de quiz + marca `attempt.kind = 'practice' | 'retention-test'` (columna nueva).

---

## 8. 🟡 Calidad de app

- **Responsive:** el layout está hecho para desktop (~1288px). El piloto probablemente incluye celulares → revisar path map, lección y práctica en 390px de ancho. La práctica en móvil además implica cámara frontal vertical (el aspect-ratio 16/9 actual no es ideal).
- **Tema claro + marca:** los otros dos mockups de Claude Design (`Enlaza - App.dc.html`, `Enlaza - Marca.dc.html`) siguen sin implementar. Los tokens CSS ya son theme-agnostic a propósito (overrides en `:root[data-theme="light"]`). No bloquea el piloto (el oscuro es completo), pero la marca (favicon real, logo exportado, og-image) sí importa para credibilidad de la URL pública.
- **Accesibilidad:** pasar un barrido básico — foco visible, labels (los inputs ya los tienen), contraste (los tokens del mockup ya lo consideran), navegación con teclado en el path map (los nodos son links, bien). Ironía a evitar: una app de inclusión que no sea accesible.
- **Manejo de sesión expirada:** el token dura 7 días; cuando expira, las llamadas devuelven 401 y la UI muestra el error crudo. Interceptar 401 → logout + redirect a login.
- **CI:** un workflow de GitHub Actions que corra `npm test` + `npm run e2e` en cada push. Todo ya corre headless y con BD en memoria, así que es ~20 líneas de YAML.

---

## 9. 🟢 Post-piloto (no gastar tiempo aquí todavía)

- Clasificador entrenado (red pequeña sobre landmarks) cuando exista dataset — sustituye plantillas por dispositivo.
- Cuentas: recuperación de contraseña, verificación de email, rate limiting.
- Migración a Postgres/Turso si el piloto crece.
- Lecciones 2-7 con plantillas y videos (misma receta que el alfabeto).
- LSM (la arquitectura ya lo permite: `languages` es tabla, no constante).
- Analytics de producto (tiempo por seña, tasa de reintentos por seña — para detectar señas mal enseñadas).
- App móvil nativa (brief §9, fase 4).

---

## Orden de ataque sugerido

| # | Qué | Depende de | Resultado visible |
|---|-----|-----------|-------------------|
| 1 | Grabar plantillas Alfabeto I (§1.1) | nada | La cámara valida señas reales HOY |
| 2 | Probar con 2-3 personas + ajustar umbral (§1.2) | 1 | Confianza en el reconocimiento |
| 3 | Videos de referencia Alfabeto I (§2) | nada (paralelo) | La app *enseña*, no solo evalúa |
| 4 | Consentimiento + privacidad (§4) | nada | Listo para usuarios reales |
| 5 | Deploy con HTTPS (§3) | 1-4 | URL pública usable |
| 6 | Fixtures reales de regresión (§1.3) | 1 | El 90% significa algo |
| 7 | Test de retención (§7) | 5 | El piloto puede medir su métrica |
| 8 | Validación ICAL de contenido (§6) | contacto ICAL | Credibilidad lingüística |

Con los pasos 1–5 hechos, ya se puede sentar a una persona frente a la app y observar. Los pasos 6–8 convierten eso en un piloto medible (brief §5: 15 personas, diagnóstico inicial, test al día siguiente).
