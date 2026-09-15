# Área 3 — Pendientes después de integrar los textos

15 de septiembre de 2026.

- **Consentimiento y captura:** comprobar en el grabador nuevo que
  RESPALDO_LOCAL_CIFRADO describe lo que realmente se guarda. Hoy la copia
  local previa no está cifrada y la ayuda informa esa diferencia con el texto 2.0.
  El criterio de coincidencia no puede cerrarse sin reconstruir el grabador.
- **Re-firma:** la API devuelve sugiereRefirmar para firmas anteriores; falta
  mostrar la sugerencia en la ficha. CONSENTIMIENTO_NUEVO_TEXTO está listo en
  el glosario. Las firmas anteriores siguen válidas; no se deben bloquear.
- **Despliegue:** verificar en Vercel el retiro de las variables anteriores y
  la configuración de retención de Anthropic. No se modificaron secretos ni
  configuración externa. La fecha informada sigue siendo 2026-09-04.
- **Proxy:** Origen no permitido queda como literal local. La regla 1 de
  AGENTS.md prohíbe importar el glosario desde el proxy; mover ese texto no
  justifica cambiar el grafo autorizado de imports.
- **Decisiones aceptadas:** la enumeración de emails con invitación válida y
  la confianza en x-forwarded-for no cambian. Cerrar la primera requiere otro
  diseño de registro. INVITACIONES_PERMITIDAS debe listar cuentas existentes.
