# Enlaza

**Aprende Lengua de Señas Colombiana (LSC) practicando de verdad — no solo mirando.**

Enlaza es una plataforma de microaprendizaje que enseña LSC a personas oyentes mediante lecciones cortas evaluadas por visión computacional: el usuario ve/practica una seña, la cámara valida si la ejecutó correctamente, y solo entonces avanza. Nace de un proyecto de investigación de impacto social (nombre de trabajo original: *ATLAS*, Módulo 2 — Formación para el Liderazgo Global, Tec de Monterrey, 2026) que incluyó entrevistas de campo con el ICAL (Fundación Colombiana para el Niño Sordo), profesoras sordas de LSC/LSM, y la organización México sin Sordera.

Este documento es el brief de arquitectura para arrancar el desarrollo. Está pensado para que un agente de desarrollo (Claude / Fable 5) lo use como punto de partida, no como especificación cerrada — hay secciones marcadas explícitamente como decisiones abiertas.

---

## 1. Visión y por qué existe

El proyecto no traduce señas a texto — **enseña señas al mundo oyente**. Ese pivote ocurrió después de la investigación de campo: el problema más urgente no es que el mundo no entienda a las personas sordas, sino que el mundo oyente no tiene ninguna herramienta ni incentivo para aprender a comunicarse con ellas. Enlaza le da esa herramienta al oyente, con el mismo mecanismo de hábito y retroalimentación inmediata que hizo funcionar a Duolingo, pero evaluando movimiento real en vez de texto.

**Fuentes de este resumen:** `Documentación general proyecto ATLAS.docx`, `Avance 1.pdf`, `Avance 2.pdf`, entrevistas en `Módulo 2/Entrevistas/` (ver sección 11 sobre uso ético de estas fuentes antes de citarlas en un repo público).

### El problema (cifras de referencia)
- OMS 2025: 430M de personas en el mundo con discapacidad auditiva discapacitante; proyección a 2,500M para 2050.
- México: ~500,000 personas sordas (7.6% de la población), solo ~1% con acceso real a educación inclusiva.
- Colombia: 455,718 personas con discapacidad auditiva registradas (DANE, 2020).
- Patrón cualitativo repetido en las 4 entrevistas: aislamiento por falta de pertenencia, el español escrito como "lengua extranjera" para muchos sordos, reacciones poco empáticas del entorno oyente, dependencia de familiares/intérpretes para trámites cotidianos (salud, banco).

---

## 2. A quién le habla Enlaza

Dos poblaciones, dos horizontes de impacto (no hay que resolver ambas en el MVP, pero el diseño de contenido debe poder servir a las dos):

| | Población 1 — Fuerza laboral activa | Población 2 — Impacto generacional |
|---|---|---|
| Edad | 25–55 | 17–24 |
| Quiénes | Personal de salud, banca, comercio, trámites | Universitarios, nuevos profesionistas |
| Impacto | Inmediato: cambia una interacción real mañana | A largo plazo: efecto multiplicador en 40 años de vida laboral |
| Contenido relevante | Señas de contexto de servicio (cédula, firma, clave, dolor, cita, etc.) | LSC más general + alfabeto como base |

**MVP:** arrancar con Población 2 (más fácil de reclutar para el piloto vía estudiantes universitarios) usando lecciones de alfabeto + vocabulario general, dejando el set de señas de "servicios" (Población 1) como expansión de contenido reutilizando la misma arquitectura de lecciones.

---

## 3. Alcance del MVP

**Sí incluye (v1):**
- Web app (mobile queda para v2 — misma lógica de producto, otra capa de UI).
- Lecciones tipo Duolingo: introducción de una seña → práctica con validación por visión computacional → solo avanza si la ejecución es correcta.
- 7 lecciones confirmadas (ver sección 6): alfabeto LSC + 5 lecciones de vocabulario general.
- Sistema de progresión simple: nivel, racha o puntos (no hace falta que sea elaborado en v1, pero el modelo de datos debe dejar espacio para esto desde el inicio).
- Idioma objetivo: **LSC únicamente en v1.** LSM queda en el roadmap (ver sección 9) — la arquitectura de datos/lecciones debe estar desacoplada del idioma desde el día uno para no rehacer trabajo después.

**No incluye (v1) — explícitamente fuera de alcance:**
- Traducción en tiempo real (ese era el enfoque original, descartado tras las entrevistas).
- App móvil nativa.
- Multi-idioma simultáneo (LSM, ASL, etc.).
- Sistema de pagos / certificación B2B (existe como hipótesis de sostenibilidad a futuro, no como feature de producto ahora).
- Cuentas sociales / multiusuario avanzado — autenticación básica es suficiente.

---

## 4. Arquitectura técnica — DECISIÓN ABIERTA

Diego no tiene preferencia de stack; esto se decide durante el desarrollo con Fable 5. Lo que sigue es una **propuesta de referencia**, no un mandato, para darle un punto de partida razonable al agente que lo construya.

### 4.1 Forma general
```
[Frontend web]  <-->  [API backend]  <-->  [Servicio de inferencia CV]
                              |
                        [Base de datos: usuarios, progreso, catálogo de lecciones]
```

- **Frontend:** cualquier framework moderno (React/Next.js es razonable por ecosistema y por si luego se porta a React Native para la versión móvil). Necesita acceso a cámara vía navegador (`getUserMedia`).
- **Backend/API:** a discreción — Node o Python son ambos razonables; Python tiene ventaja si el modelo de CV también se sirve en el mismo lenguaje.
- **Servicio de inferencia (visión computacional):** este es el componente crítico del proyecto. Debe poder correr en el navegador (vía algo como MediaPipe Hands + TensorFlow.js, procesamiento local, sin costo de servidor por inferencia) **o** en un servicio en la nube (más flexible para modelos custom, pero con costo y latencia). Recomendación: **empezar con procesamiento en cliente** (MediaPipe Hands para extraer landmarks de la mano + un clasificador ligero encima) para el MVP — es gratis, no depende de AWS, y valida el concepto más rápido. La arquitectura en la nube mencionada en la documentación original (AWS) puede quedar como plan de escala, no como requisito del MVP.

### 4.2 El problema técnico central: señas estáticas vs. dinámicas
Diego mencionó que un compañero está construyendo un traductor en tiempo real (repo open source) y tuvo que resolver la distinción entre **señas estáticas** (una postura fija de la mano — la mayoría del alfabeto LSC cae aquí) y **señas dinámicas** (la seña incluye movimiento — muchas palabras y frases). Esto es directamente relevante:

- El **alfabeto** (primera lección confirmada) es mayormente estático → más fácil de clasificar con landmarks de un solo frame.
- Cualquier lección más allá del alfabeto probablemente incluye señas dinámicas → requiere clasificar sobre una secuencia de frames (ventana temporal), no un frame aislado.
- El repo de referencia del compañero de Diego ya no existe (fue eliminado), así que no hay implementación externa de la cual partir para esta distinción — hay que resolverla desde cero durante el desarrollo.

### 4.3 Datos y contenido
- Única fuente de datos confirmada hoy: un video de YouTube con el abecedario completo en LSC. Esto **no es un dataset de entrenamiento** todavía — hay que extraer frames/landmarks, etiquetarlos por letra, y probablemente grabar variaciones adicionales (distintas manos, iluminación, ángulos) para que el modelo generalice. La documentación original ya identificó este riesgo: el modelo debe funcionar con luz variable y cámaras de distinta calidad, no solo en condiciones de laboratorio.
- Para lecciones más allá del alfabeto: no hay fuente de datos todavía. Es un bloqueante real para expandir el currículo — probablemente requiere grabación propia (con o sin ICAL) o un dataset público de LSC si existe.
- **ICAL** sigue siendo el aliado de validación lingüística — no para dataset masivo necesariamente, pero sí para confirmar que las señas enseñadas son correctas y culturalmente apropiadas antes de publicarlas.

---

## 5. Métricas de éxito (del objetivo SMART original)
- 80% de efectividad en test de retención **al día siguiente** (no inmediatamente post-lección) — este es el indicador que más le importa al proyecto: que el conocimiento se quede, no que se memorice por 5 minutos.
- Precisión del modelo de reconocimiento > 90% (no 100% — condiciones reales de cámara/luz varían, y el 90% es la meta honesta según la validación con el mentor técnico consultado en la investigación original).
- Piloto de validación: 15 personas oyentes sin conocimiento previo de LSC, con diagnóstico inicial (idealmente con ICAL), sesión de uso de ~1 hora, y test de retención al día siguiente.

---

## 6. Currículo confirmado para el MVP (7 lecciones)

1. Alfabeto LSC (parte 1)
2. Alfabeto LSC (parte 2)
3. Saludos y presentación personal (hola, gracias, mi nombre es, mucho gusto)
4. Números básicos
5. Preguntas esenciales (¿cómo estás?, ¿qué necesitas?, sí/no)
6. Vocabulario de salud básico (dolor, médico, ayuda, cita)
7. Emociones y estado de ánimo básico

Se descartó, por ahora, la lección de vocabulario de trámites/servicios (cédula, firma, dirección) que estaba en la propuesta inicial — queda como candidata natural para la fase de expansión de currículo (sección 9, punto 3), ya dirigida a Población 1.

---

## 7. Testing

Dado que se pidió que el desarrollo incluya pruebas desde el inicio:

- **Backend/API:** pruebas unitarias por endpoint (progreso de usuario, catálogo de lecciones, registro de intentos).
- **Frontend:** pruebas de flujo de lección (renderiza, captura intento, avanza/bloquea según resultado) — con mocks del clasificador de CV para no depender de cámara real en CI.
- **Modelo de visión computacional:** esto necesita una suite de *regresión de modelo*, no solo tests de software tradicional — un set de validación fijo (clips o imágenes etiquetadas) contra el cual se mide precisión en cada cambio del modelo, con el 90% como umbral de referencia. Sin esto, es fácil que el modelo "mejore" en unos casos y empeore silenciosamente en otros.
- **E2E:** un flujo completo de usuario (registro → lección → práctica → avance) automatizado con Playwright o similar.

---

## 8. Estructura de repositorio sugerida

```
enlaza/
├── README.md
├── apps/
│   ├── web/              # frontend
│   └── api/               # backend
├── packages/
│   └── cv-model/          # extracción de landmarks + clasificador
├── data/
│   ├── raw/                # material fuente (no versionar videos pesados directo — usar Git LFS o storage externo)
│   └── processed/          # landmarks/etiquetas listas para entrenar
└── tests/
```

---

## 9. Roadmap por fases

1. **MVP web (ahora):** 7 lecciones (alfabeto + 5 de vocabulario general), reconocimiento estático en cliente, piloto interno.
2. **Piloto con ICAL:** 15 personas, protocolo de medición de retención descrito en sección 5.
3. **Expansión de currículo:** señas de Población 1 (contexto de servicios).
4. **App móvil:** reusar lógica de producto, nueva capa de UI (probablemente React Native si el frontend web es React).
5. **LSM:** cuando el proyecto lo permita, adaptar el modelo/arquitectura de contenido a Lengua de Señas Mexicana — por eso el idioma no debe estar *hardcodeado* en la arquitectura de datos desde el MVP.
6. **Sostenibilidad:** capacitaciones B2B, certificación, alianzas — no es trabajo de ingeniería inmediato, pero vale la pena que el modelo de datos de "usuario" pueda eventualmente distinguir entre usuario individual y usuario dentro de una organización/empresa capacitada.

---

## 10. Repositorio en GitHub

- Nombre sugerido: `enlaza` (bajo la cuenta personal de Diego, pública).
- Si `enlaza` ya está tomado como nombre de repo público de otra persona en GitHub (no hay problema de namespace dentro de su propia cuenta, pero vale la pena revisar disponibilidad de organización/paquetes si se publica en npm/PyPI más adelante).
- **Licencia:** el archivo `LICENSE` es lo que le dice legalmente a cualquiera que vea el repo qué puede y qué no puede hacer con el código (usarlo, copiarlo, modificarlo, venderlo). Sin uno, por defecto el código está bajo copyright total y técnicamente nadie más puede reutilizarlo aunque el repo sea público. Para un proyecto de impacto social como este, **MIT** (permite casi cualquier uso, incluso comercial, solo pide mantener el crédito) es la opción más común y la que más facilita que otros retomen o construyan sobre el proyecto. Fable 5 puede crear el archivo `LICENSE` (MIT por defecto, o el que Diego prefiera en el momento) al inicializar el repo — no es necesario decidirlo aquí.

---

## 11. Consideraciones éticas y de datos — importante antes de hacer público el repo

- El repo va a ser **público**. La documentación original de Módulo 2 (entrevistas con nombre, contexto de personas con discapacidad y menores atendidos por ICAL) **no se incluye ni se referencia en el repo por ahora** — es contenido de una entrega académica, hecho sin consentimiento explícito de publicación pública en GitHub. Esa decisión (si se resume, se anonimiza, o se pide permiso a los entrevistados) se resuelve más adelante, fuera del ciclo de desarrollo del MVP.
- La app captura **video/landmarks de manos de los usuarios** para evaluar señas — esto es dato biométrico. Aunque el procesamiento en cliente (sección 4.1) ayuda porque el video no necesariamente sale del dispositivo, cualquier dato que sí se envíe a un backend (landmarks, resultados, video de práctica si se llegara a grabar) debe tener consentimiento claro y política de retención definida, especialmente si en fases futuras hay usuarios menores de edad (contexto ICAL).

---

## 12. Del diseño (Claude Design) al código

Los mockups de la sección de identidad visual se hicieron en Claude Design (claude.ai/design). Dos formas de traerlos a este repo cuando Fable 5 empiece a construir:

- **Handoff directo (recomendado):** dentro del proyecto en Claude Design, botón "Export" (arriba a la derecha) → "Handoff to Claude Code" → "Send to local coding agent". Esto empuja el diseño directo a la sesión de Claude Code/Fable 5 en la terminal, y el agente continúa desde ahí en vez de partir de una captura de pantalla.
- **Assets sueltos:** "Export" → "Download as .zip" — trae el HTML/CSS/JS renderizado más las imágenes y fuentes usadas. Útil si solo se quiere el logo/paleta como referencia y no todo el flujo de handoff. Guardar en `assets/design/` dentro del repo.
- **Sync bidireccional (opcional, para iterar seguido):** en la terminal, `claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp`, luego `/design-login`. Con eso, `/design-sync` importa el sistema de diseño al repo, y también se puede empujar de vuelta lo que se construya en código hacia Claude Design para seguir puliendo visualmente.

## 13. Historial de decisiones

- Repo de referencia del compañero (señas estáticas/dinámicas): ya no existe — descartado como fuente, hay que resolver esa distinción desde cero (sección 4.2).
- Currículo del MVP: cerrado en 7 lecciones (sección 6).
- Licencia: se crea al inicializar el repo con Fable 5, MIT como default sugerido (sección 10).
- Investigación de Módulo 2 (entrevistas): no se menciona ni se resume dentro del repo por ahora — se resuelve en otro momento, fuera de este ciclo de desarrollo (sección 11).

---

*Este documento resume la investigación de campo, entrevistas y objetivo SMART desarrollados en el Módulo 2 (GLF, Tec de Monterrey, mayo 2026) bajo el nombre de trabajo original "ATLAS". El producto continúa bajo el nombre **Enlaza**.*
