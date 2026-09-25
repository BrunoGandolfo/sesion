# Sesión clínica: lo que sigue abierto

La revisión de la nota, la confirmación de menciones, la transcripción visible,
"Para vos", el grabador de un solo archivo y el Recorrido ya están hechos. Queda:

- **Pantalla de la nota durante "Volver a escribirla":** el servidor conserva
  la nota anterior mientras reprocesa, pero la pantalla muestra sólo el
  indicador de procesando
  (`src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx`,
  rama `procesando`/`subiendo`). Falta mostrar la nota anterior mientras tanto.
- **Id del transcript de AssemblyAI:** el worker lo registra después de que
  termina `transcribir` (`processor/processor.py`, `registrar_asr`). Si el
  worker cae en el medio, el transcript queda en AssemblyAI sin trabajo de
  borrado. El consentimiento ya informa esa ventana.
- **Consumo de tokens:** sólo va al log del worker
  (`processor/clinical_analyzer.py`); no se guarda en la base.
- **Hash duplicado:** `src/app/api/_lib/tickets.ts` usa `node:crypto` y
  `src/lib/sesion-acceso.ts` usa `sha256Hex` de `src/lib/crypto.ts`. Hacen lo
  mismo; unificarlos es opcional.
