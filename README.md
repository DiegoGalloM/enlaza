# Enlaza

**Aprende Lengua de Señas Colombiana (LSC) practicando de verdad — no solo mirando.**

Enlaza es una web app de microaprendizaje que enseña LSC a personas oyentes con lecciones cortas
evaluadas por visión computacional: ves cómo se hace una seña, la practicas frente a tu cámara,
y solo avanzas cuando la ejecutas bien. Todo el procesamiento de video ocurre en tu navegador —
las imágenes de tu cámara nunca salen de tu dispositivo.

> 📄 El contexto completo del proyecto (investigación, alcance, roadmap, consideraciones éticas)
> está en [`Enlaza/README.md`](Enlaza/README.md).

## Estructura

```
apps/
  web/        # Frontend: React + Vite + TypeScript (react-router 8)
  api/        # Backend: Fastify + SQLite (node:sqlite, sin deps nativas)
packages/
  cv-model/   # Pipeline de validación de señas: features de landmarks,
              # clasificador estático, DTW para señas dinámicas
tests/
  e2e/        # Smoke E2E con Playwright
```

## Requisitos

- Node.js ≥ 22.13 (usa el módulo nativo `node:sqlite`)

## Arranque rápido

```bash
npm install
npm run seed   # crea la BD local + usuario demo (demo@enlaza.app / enlaza-demo)
npm run dev    # levanta API (:3001) y web (:5173) juntos
```

Abre http://localhost:5173, entra con la cuenta demo o crea la tuya.

## Cómo funciona la validación de señas

1. **MediaPipe HandLandmarker** (en el navegador) extrae 21 landmarks de la mano por frame.
2. `@enlaza/cv-model` normaliza cada frame a un vector invariante a posición, distancia a la
   cámara y mano dominante (izquierda/derecha).
3. **Señas estáticas** (mayoría del alfabeto): similitud coseno contra una plantilla; hay que
   *mantener* la seña varios frames para validarla.
   **Señas dinámicas** (palabras con movimiento): Dynamic Time Warping sobre una ventana
   deslizante de ~2 s.
4. Al validar, la API registra solo el resultado y el puntaje — nunca video ni landmarks.

Como todavía no existe un dataset etiquetado de LSC, las plantillas de referencia se graban por
dispositivo en la página **/plantillas** (p. ej., siguiendo el video del alfabeto LSC) y se
pueden exportar/importar como JSON. Es el paso intermedio hasta entrenar un modelo real
(ver roadmap en el brief).

## Tests

```bash
npm test       # unit/integración: cv-model (28), api (27), web (8)
npm run e2e    # Playwright: registro → lección → práctica → progreso
```

La suite de `cv-model` incluye la **regresión de modelo** exigida por el brief: un set fijo de
validación con umbral de 90% de precisión que falla si un cambio degrada el pipeline. Hoy usa
fixtures sintéticos (verifican discriminación del pipeline, no precisión en el mundo real);
cuando exista el dataset real de LSC, se sustituyen manteniendo las mismas aserciones.

## Aviso sobre el contenido

Las descripciones de señas incluidas son **provisionales** (marcadas `validated = 0` en la BD y
señalizadas en la UI): aún no han sido revisadas por ICAL ni por personas sordas señantes de
LSC, y no deben tomarse como referencia lingüística definitiva.

## Licencia

[MIT](LICENSE)
