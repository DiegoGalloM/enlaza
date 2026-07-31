# Brief de diseño — Enlaza

Este documento es para pegar en **Claude Design** (claude.ai/design) — no lo genero yo aquí, esa herramienta la abres tú directamente. Está escrito para usarse casi tal cual como prompt inicial, y luego ir refinando pantalla por pantalla dentro de la herramienta.

---

## Contexto rápido (para ti, no hace falta pegarlo)

Enlaza es una web app que enseña Lengua de Señas Colombiana (LSC) a personas oyentes con lecciones cortas evaluadas por visión computacional — el usuario practica una seña frente a la cámara y solo avanza si la ejecuta bien. Le habla a dos públicos: universitarios (17-24) y personal de servicios como salud/banca (25-55). Por eso el diseño no puede ser tan infantil como para alejar al segundo grupo, ni tan corporativo como para intimidar al primero.

La dirección visual que elegiste es **"geométrico enlazado"**: círculos que se superponen/entrelazan como motivo recurrente — representa literalmente la acción de "enlazar" dos mundos (el oyente y el sordo). Paleta: azul, verde claro y rosa, todos en tonos claros y pastel, para que se sienta amigable y no intimide a nadie.

---

## Prompt para Claude Design

> Diseña la identidad visual e interfaz de **Enlaza**, una app web que enseña Lengua de Señas Colombiana (LSC) a personas oyentes mediante lecciones cortas con retroalimentación por cámara (visión computacional): el usuario practica una seña y la app valida si la hizo bien antes de dejarlo avanzar.
>
> **Dirección visual:** geométrica, basada en círculos que se superponen y entrelazan entre sí — el motivo debe evocar literalmente la idea de "enlazar" dos mundos distintos que se conectan. Nada de esquinas puntiagudas ni de un estilo frío/corporativo.
>
> **Paleta:** azul, verde claro y rosa, en tonos pastel/claros. La sensación general debe ser amigable y cálida, pero **no infantil** — la app la usan tanto universitarios de 17-24 años como profesionales de servicios de 25-55 años (personal de salud, banca, atención al público). Evita que se vea como una app solo para niños.
>
> **Qué evitar explícitamente:** no repliques la identidad visual de Duolingo (nada de mascota tipo búho, nada del verde saturado característico, nada de esa estética exacta). Enlaza necesita personalidad propia dentro del mismo género de app (microaprendizaje gamificado).
>
> **Tono de marca:** cercano, alentador, respetuoso — nunca condescendiente. La app le está enseñando algo nuevo a alguien, no "salvando" a nadie. Evitar cualquier imaginería que infantilice a las personas sordas o presente el aprendizaje de LSC como caridad.
>
> Genera:
> 1. Un concepto de logo/ícono de marca usando el motivo de círculos entrelazados.
> 2. Pantalla de inicio / ruta de aprendizaje — muestra las 7 lecciones del MVP como un camino o mapa de nodos (parte 1 y 2 del alfabeto, saludos, números, preguntas esenciales, vocabulario de salud, emociones), con indicación clara de cuáles están completadas, en progreso o bloqueadas.
> 3. Pantalla de lección — introduce una seña específica con una referencia visual clara de cómo se hace.
> 4. Pantalla de práctica con cámara — el usuario ve su propio video en vivo con retroalimentación de si la seña está correcta o no (diseña ambos estados: correcto e incorrecto/reintentar).
> 5. Pantalla de progreso — resume avance general, racha y logros de forma simple, sin saturar de elementos de gamificación.

---

## Notas para cuando estés dentro de Claude Design

- Pide primero el logo/ícono y la paleta exacta (con códigos hex) antes de pasar a las pantallas — así todo lo demás hereda esos mismos colores y no tienes que corregir cada pantalla por separado después.
- Si alguna pantalla se siente "demasiado Duolingo", dile explícitamente qué elemento te lo recuerda (el tipo de letra, la forma de los botones, el mascotismo) para que lo ajuste puntual, en vez de regenerar todo de nuevo.
- Guarda/exporta los assets finales (logo, paleta, capturas de pantallas) en esta misma carpeta del proyecto (`Enlaza/`) cuando termines, para que Fable 5 los tenga disponibles como referencia visual al construir el frontend real.
