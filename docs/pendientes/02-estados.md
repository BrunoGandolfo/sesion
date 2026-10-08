# Sesión clínica: lo que sigue abierto

La revisión de la nota, la confirmación de menciones, la transcripción visible,
"Para vos", el grabador de un solo archivo, el Recorrido y la nota anterior a la
vista durante "Volver a escribirla" ya están hechos. Queda:

- **Hash duplicado:** `src/app/api/_lib/tickets.ts` usa `node:crypto` y
  `src/lib/sesion-acceso.ts` usa `sha256Hex` de `src/lib/crypto.ts`. Hacen lo
  mismo; unificarlos es opcional.
