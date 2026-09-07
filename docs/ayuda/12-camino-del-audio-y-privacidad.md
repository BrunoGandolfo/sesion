# El camino del audio y la privacidad

**Para qué sirve.** Por dónde pasa el audio de una sesión, quién lo toca, cuándo
se borra y qué queda guardado. Es lo que le prometés a tu paciente cuando firma.

## El camino, paso a paso

1. **Se graba en tu dispositivo**, en pedacitos que quedan guardados ahí mientras
   grabás, por si el navegador muere.
2. **Se cifra ahí mismo.** Al terminar, el navegador genera una clave única para
   esa sesión y cifra el audio (AES-256-GCM). **El audio sin cifrar nunca sale de
   tu teléfono.**
3. **Se sube ya cifrado**, directo al depósito (Cloudflare R2), sin pasar por el
   servidor de la app.
4. **Un proceso aparte lo baja y lo descifra en memoria**, sin escribir a disco.
5. **AssemblyAI lo pasa a texto**, separando quién habla. Al terminar, la app
   **le pide que borre** el texto y su copia del audio.
6. **Anthropic redacta el borrador y el bloque "Para vos"**, bajo un acuerdo que
   no le permite conservar el contenido ni usarlo para entrenar.
7. **La nota vuelve a la app** y queda **Para revisar**.
8. **Al aprobar, el audio se borra** y **se destruye su clave**.

## Quién procesa qué

| Quién | Qué recibe | Después |
| --- | --- | --- |
| Tu dispositivo | El audio en claro | Se borra al confirmarse la subida |
| El depósito (R2) | El audio **cifrado** | Se borra al aprobar la nota |
| **AssemblyAI** (EE.UU.) | El audio, descifrado, automáticamente | Borra el texto y su copia del audio |
| **Anthropic** (EE.UU.) | La transcripción en texto | No lo conserva ni lo usa para entrenar |

A esos servicios **no se les manda el nombre, el teléfono ni el documento de la
paciente**: reciben el audio y el texto, nada más. Pero, y está dicho en la
autorización: **si en la sesión se dicen nombres en voz alta, esos nombres viajan
dentro del audio.**

**Ninguna persona escucha tus sesiones**: ni de tu consultorio, ni de esas
empresas.

## Cuándo se borra el audio

**Al aprobar la nota**, en general el mismo día. Se borran el archivo y su clave:
aunque quedara una copia en algún lado, **sin la clave no se puede abrir**.
También se borra si eliminás una sesión que quedó en error. Entre grabar y
aprobar, el audio existe cifrado en el depósito.

## Qué queda guardado, y cifrado

En la base de datos, cifrado y visible solo para vos: **la nota clínica**, **el
borrador original**, **la transcripción completa**, **los datos de la sesión**
(temas, emociones, intervenciones, riesgo, feedback), **el hilo del proceso**
(hipótesis, recorrido acumulado y señales históricas) y tus comentarios.

Hay además un **registro de auditoría** de qué se hizo y cuándo (crear una
sesión, aprobar una nota, cambiar la contraseña). **No guarda texto clínico**: de
la nota aprobada guarda solo una huella que permite probar después que lo
aprobado fue exactamente eso. Y hay copias de seguridad diarias de la base,
también cifradas.

## Lo que NO pasa

- **El audio no se guarda para siempre**: se borra al aprobar.
- **El audio no pasa por el servidor de la app.**
- **Nadie escucha las sesiones.**
- **No se usan tus sesiones para entrenar modelos.**
- **Los datos de contacto de tus pacientes no salen** hacia esos servicios.
- **La transcripción no se borra al aprobar**: queda, y la autorización que firma
  la paciente lo dice explícitamente.
- **Nada de esto es opcional por sesión**: si autorizó, este es el camino; si no,
  no se graba.

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
