# Brief de contenido — insumos de ICAL/FENASCOL para Enlaza (septiembre 2026)

Fuente: reunión de Diego con Victoria Olmos, rectora de ICAL, más los libros de FENASCOL que ella referenció. Léase junto con `README.md` del repo (arquitectura de reconocimiento: MediaPipe HandLandmarker + `@enlaza/cv-model`).

## Requisitos pedagógicos (orden dado por Victoria Olmos / FENASCOL)

1. **Bautizo** — nombre-seña para cada persona oyente que entra a la plataforma, y una seña asignada al avatar de Enlaza (el nombre-seña del avatar queda pendiente de definir con ICAL, no inventarlo).
2. **Normas de cortesía** — vocabulario básico para iniciar una comunicación superficial. Ya hay 10 GIFs listos (ver abajo).
3. Vocabulario específico por usuario y vocabulario de casa — **fuera de alcance de este MVP**, es contenido de currículo completo.
4. Campos semánticos (organización del vocabulario por categorías) — **fuera de alcance de este MVP**.
5. Construir desde palabras sueltas hacia la formación de frases — meta de largo plazo, no de este MVP.
6. La enseñanza no debe reducirse a solo vocabulario o señas sueltas — cada seña se enmarca en un contexto de uso, no en una lista aislada.

## Nota lingüística crítica

La configuración manual (forma/orientación de la mano) cambia el significado de una seña por completo. Referencia académica: Alejandro Oviedo, *Apuntes para una gramática de la lengua de señas colombiana* (2001) — reseña disponible en [cultura-sorda.org](https://cultura-sorda.org/resena-de-oviedo-2001-apuntes-para-una-gramatica-de-la-lsc/). Cualquier plantilla de reconocimiento debe capturar orientación explícitamente, no solo la forma general de la mano.

## Señas de cortesía disponibles como video (10)

Son archivos `.mp4` (no GIF, corregido), ubicados directamente en `content/ical-2026-09/`:

| Glosa | Archivo |
|---|---|
| Buenos días | `buenos-dias.mp4` |
| Buenas tardes | `buenas-tardes.mp4` |
| Buenas noches | `buenas-noches.mp4` |
| Gracias | `gracias.mp4` |
| Por favor | `por-favor.mp4` |
| Hola | `hola.mp4` |
| Con mucho gusto | `con-mucho-gusto.mp4` |
| Lo siento | `lo-siento.mp4` |
| ¿Cómo está? | `como-estas.mp4` |
| Permiso | `permiso.mp4` |

## Fuente del abecedario

Video de YouTube: https://youtu.be/JMraBJsA9oI — fuente provisional, sin verificar. Cruzar contra el Tomo 1 de FENASCOL (público en [fenascol.org.co](https://fenascol.org.co/wp-content/uploads/2022/01/Tomo%202%20LSC%20Fenascol.pdf)) antes de dar el contenido por definitivo.

**Archivo real:** `content/ical-2026-09/raw-content/abecedarioLSC.mp4` (carpeta gitignorada, ver abajo). El link de arriba es solo la cita de dónde salió; el archivo local es el insumo real que Fable necesita para leer los frames sin depender de que el video siga disponible en YouTube ni de que el entorno de Fable tenga acceso a internet.

## Referencia de configuración manual (Oviedo)

El libro completo — Alejandro Oviedo, *Apuntes para una gramática de la lengua de señas colombiana* (2001) — está en `content/ical-2026-09/raw-content/460631745-gramatica-oviedo-pdf.pdf` (PDF escaneado sin capa de texto; localizado leyendo las páginas como imagen).

Fragmentos relevantes (solo la cita corta, nunca el libro completo en el repo):

Sobre la configuración manual como componente diferenciador — capítulo 3, «La matriz articulatoria (I): el componente CM», pág. 65:

> «**Componente CM** abrevia "componente configuración manual". Del análisis de las posturas adoptadas por las manos se encargará este capítulo. Esas posturas son, con seguridad, el componente más complejo, y con mayor capacidad diferenciadora, de todos los que intervienen en la conformación de las señas.»

Sobre la orientación como parámetro propio (lo que exige que las plantillas de reconocimiento capturen orientación explícitamente, no solo la forma general) — capítulo 4, «El componente orientación (OR)», pág. 109:

> «El tercer y último componente de la matriz articulatoria es la orientación (OR), que da cuenta de la posición relativa de la mano articuladora en el espacio. […] la mano es concebida como un sólido dotado de seis lados: palma, dorso, puntas, base, cúbito y radio. Si especificamos hacia dónde se orientan por lo menos dos de esos seis lados, podremos conocer la forma en que se dispone el articulador.»

Esto respalda la decisión del cv-model de **no** eliminar la rotación en plano al normalizar (ver `packages/cv-model/src/normalize.ts`): señas como Q/R o C/O se distinguen principalmente por orientación.

## Carpeta gitignorada — qué va y qué no

- `content/ical-2026-09/` (nivel raíz): los 10 GIFs + este `content-brief.md` → **sí se commitea**, es contenido real del producto.
- `content/ical-2026-09/raw-content/`: el mp4 del abecedario + el libro de Oviedo → **no se commitea** (agregar `content/ical-2026-09/raw-content/` a `.gitignore`). Son materiales de terceros con derechos de autor; solo sirven como insumo de lectura local. Lo único que sale de ahí hacia el repo son las plantillas JSON (del video) y la cita textual corta de la sección relevante (del libro), ambas ya integradas en archivos que sí se commitean.

## Convención de validación (ya existe en el proyecto — mantenerla)

Todo el contenido de este brief se marca `validated = 0` en la BD y se señaliza en la UI, igual que el resto del contenido de Enlaza. Nada de esto ha sido revisado todavía por ICAL ni por personas sordas señantes — no presentar ninguna seña de esta lista como verificada.

## Sobre el avatar (ver objetivo separado para Fable)

Debe mostrarse desde el tren superior, igual que el encuadre de los GIFs de referencia. No debe parecerse a la persona de los GIFs ni, en la medida de lo posible, a Diego. El movimiento de referencia se extrae de los GIFs ya existentes — no hace falta grabar de nuevo. Prioridad: que funcione para una sola seña antes que verse bien para varias.
