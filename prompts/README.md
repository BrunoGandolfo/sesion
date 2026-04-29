# Prompts clínicos — Sesión

Cada versión del prompt del LLM clínico se guarda como archivo en esta carpeta.
El código carga la versión activa desde `src/lib/prompts.ts`.

## Versionado
- Cada iteración con Mariana genera una nueva versión
- Nunca se borra una versión anterior
- El archivo activo se indica en `src/lib/prompts.ts`

## Reglas del prompt
- El modelo NO diagnostica
- El modelo NO recomienda tratamientos
- El modelo NO inventa contenido que no esté en la transcripción
- Falsos positivos en flags de riesgo son preferibles a falsos negativos
- Español rioplatense profesional
