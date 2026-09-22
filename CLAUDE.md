# Enlaza

Microaprendizaje de lengua de señas con validación por visión computacional. Monorepo npm: `apps/web` (React + three-vrm), `apps/api`, `packages/cv-model`, herramientas en `tools/`.

## Avatar 3D de señas

- Para hacer, revisar o pulir la animación del avatar de cualquier seña, usa la skill **`avatar-sena`** (`.claude/skills/avatar-sena/SKILL.md`). Tiene la receta paso a paso, la lista de control de calidad y la tabla de problemas ya resueltos, para no rehacerlos.
- El porqué de cada decisión está en `docs/AVATAR-DECISIONES.md` (A1–A34).
- Preferencias del equipo: la cara del avatar es amable y consistente (por defecto, la sonrisa de Hola). Se busca realismo sin errores (nada que se atraviese, manos con la configuración correcta). El pixelado no es un problema.
- Todo lo visual se verifica con capturas y medidas (`tools/avatar/`), no a ojo, en varios ángulos (`/avatar-poc?sena=<id>&t=<s>&angulo=<grados>`).

## Convenciones

- Código, comentarios y documentos en español.
- Decisiones técnicas en `docs/DECISIONES-TECNICAS.md` (D#) y `docs/AVATAR-DECISIONES.md` (A#), con el formato qué / por qué / descartado.
- Servidor de desarrollo: `npm run dev` (web en `http://localhost:5173`).
