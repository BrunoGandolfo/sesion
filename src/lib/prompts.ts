// BORRAR ESTE ARCHIVO.
//
// Leía los prompts clínicos desde `prompts/` en la raíz del repo. Nadie lo
// importa: `cargarPromptClinico` y `versionPromptClinico` no tenían un solo
// consumidor en todo el repo, ni en tests.
//
// Los prompts que se usan de verdad viven en `processor/prompts/` y los
// carga el worker en Python (processor/config.py, PROMPTS_DIR). La carpeta
// `prompts/` de la raíz quedó congelada en clinical_note_v2.1 mientras el
// pipeline ya va por v3.1.1: mantener este módulo era ofrecer una versión
// del prompt clínico que no es la que escribe ninguna nota.
//
// Queda vacío en vez de borrado porque borrar archivos está fuera del
// alcance de este cambio. Junto con él corresponde borrar `prompts/` de la
// raíz (README.md, clinical_note_v1.0/v2.0/v2.1.md), que es la misma copia
// huérfana.

export {};
