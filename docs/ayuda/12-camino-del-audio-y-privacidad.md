# El camino del audio y la privacidad

**Para qué sirve.** Distinguir qué hace la app de lo que todavía necesita
verificación sobre las copias y los proveedores.

## El camino, paso a paso

1. Durante la grabación, la app intenta guardar fragmentos en el navegador.
   **La copia local previa no está cifrada.** Puede faltar si el almacenamiento
   no estuvo disponible; no es una garantía de recuperación.
2. **Al terminar**, el navegador cifra el audio antes de subirlo a R2.
3. El proceso de transcripción baja ese audio y lo descifra. **AssemblyAI**
   recibe el audio descifrado; **Anthropic** recibe la transcripción para
   redactar la nota y el análisis para vos.
4. Al terminar la transcripción, la app **pide eliminar** ese material del
   proveedor. Una solicitud de borrado no confirma que se hayan eliminado
   todas las copias.
5. Al aprobar la nota, la app **intenta borrar el audio remoto** y quita la
   clave del registro activo. La limpieza puede fallar; los respaldos previos
   y las copias de proveedores requieren verificación aparte.

## Qué información reciben los proveedores

El audio y su transcripción pueden contener nombres y otros datos que se
digan durante la sesión. El vocabulario que cargás también se envía al servicio
de transcripción y puede contener nombres propios. No se envía automáticamente
la ficha de contacto completa por ese camino.

La retención, los accesos humanos y el uso para entrenamiento dependen de las
condiciones y de la configuración vigente de los proveedores. Esta ayuda no
puede certificar que nunca acceda una persona ni que todas las copias se borren.
Si necesitás confirmar esas condiciones, pedí que se verifiquen antes de usarlas
como garantía frente a una paciente.

## Qué queda guardado

La nota clínica, el borrador original, la transcripción y los datos estructurados
de la sesión se cifran en la base. En el contexto longitudinal se cifran la
hipótesis, el resumen acumulado y los riesgos históricos.

**No todo dato clínico tiene ese cifrado:** las notas privadas de la ficha,
las notas del turno, los objetivos, las intervenciones y los temas del contexto
quedan fuera de ese cifrado de la aplicación. No los describas como si tuvieran
la misma protección que la nota clínica.

Hay un registro de auditoría y un proceso de respaldo diario cifrado. La
existencia de esos mecanismos no confirma que cada evento o respaldo se haya
completado: su funcionamiento y recuperación requieren comprobación.

## Después de aprobar

La transcripción y la nota se conservan. Aprobar no permite volver a grabar el
audio original ni garantiza recuperar una copia perdida. Tampoco hay que
confundir quitar una clave del registro activo con eliminar todas las copias
previas que pudieran conservarla.

<!-- fuentes:
src/components/grabacion/GrabadorSesion.tsx
src/lib/crypto.ts
src/lib/grabacion-storage.ts
src/hooks/useGrabacionSesion.ts
src/app/api/_lib/casos-uso/aprobar-sesion.ts
src/lib/consentimiento.ts
docs/pipeline.md
docs/encryption.md
README.md
processor/processor.py
processor/asr_assemblyai.py
processor/crypto.py
-->
