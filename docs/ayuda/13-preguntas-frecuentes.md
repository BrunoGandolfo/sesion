# Preguntas frecuentes

Respuestas cortas, con el documento donde está el detalle.

---

**1. ¿Puedo grabar sin que la paciente firme nada?**
No. Sin autorización vigente la app no deja empezar la grabación. Se firma en la
ficha, en el momento. → `04-pacientes-y-ficha.md`

**2. ¿La paciente escucha su sesión o ve la nota?**
No. La paciente no entra a la app. Firma la autorización en tu dispositivo y nada
más. → `04-pacientes-y-ficha.md`

**3. ¿Alguien escucha mis sesiones?**
Ninguna persona. El audio pasa automáticamente por AssemblyAI (lo convierte en
texto y borra su copia) y el texto por Anthropic (redacta el borrador y no lo
conserva). → `12-camino-del-audio-y-privacidad.md`

**4. ¿Cuándo se borra el audio?**
Cuando aprobás la nota. Se borra el archivo y se destruye su clave. En general,
el mismo día. → `12-camino-del-audio-y-privacidad.md`

**5. ¿La transcripción también se borra?**
No. La transcripción queda guardada, cifrada, junto con la nota. Está dicho en la
autorización que firma la paciente. → `12-camino-del-audio-y-privacidad.md`

**6. ¿Puedo bloquear la pantalla mientras grabo?**
Sí. La app te lo dice en pantalla: *"Se guarda cifrado en el teléfono. Podés
bloquear la pantalla."* La grabación sigue. → `07-grabar-una-sesion.md`

**7. Pausé y me olvidé de reanudar. ¿Perdí la sesión?**
No. El cronómetro se detiene en pausa, pero nada se pierde: **Reanudar** sigue en
el mismo archivo. → `07-grabar-una-sesion.md`

**8. Entró una llamada y se cortó el micrófono.**
La pantalla pasa a **Cortado** y avisa *"Lo grabado está a salvo."* Podés
**Reanudar** o **Terminar la sesión** con lo que hay. → `14-cuando-algo-falla.md`

**9. ¿Cuánto tarda la nota?**
No hay un tiempo fijo. Mientras se escribe ves **"Escribiendo la nota…"**; cuando
está lista, el chip pasa a **Para revisar** y aparece en los pendientes de
**Hoy**. → `08-la-nota-clinica.md`

**10. ¿La app me avisa al teléfono cuando la nota está lista?**
No. Hay que entrar a la app. Aparece arriba en **Hoy**, en el bloque de
pendientes. → `02-pantalla-hoy.md`

**11. Edité la nota y me fui sin aprobar. ¿Se guardó?**
No. La nota se guarda una sola vez, al aprobar. → `08-la-nota-clinica.md`

**12. ¿Puedo desaprobar una nota?**
No. Al aprobar se borra el audio y no se puede deshacer. → `08-la-nota-clinica.md`

**13. El botón "Aprobar nota" está apagado.**
Hay una señal de riesgo sin marcar. Marcá todas las casillas **"Revisé esta
señal"**. → `08-la-nota-clinica.md`

**14. La app marcó riesgo y yo no veo riesgo.**
Es una señal, no un diagnóstico: *"evaluá con tu criterio clínico"*. Marcás la
casilla, editás el Análisis como corresponde y aprobás. La señal está calibrada
para preferir el falso positivo. → `08-la-nota-clinica.md`

**15. ¿Puedo cambiar el texto de la nota?**
Sí, sección por sección, mientras esté **Para revisar**. El borrador original
queda guardado abajo, en **Ver el borrador original**. → `08-la-nota-clinica.md`

**16. ¿Por qué muchos ítems del GTFS dicen "No determinable"?**
Porque solo se acredita lo que dejó huella verbal en la transcripción. Una
observación corporal que no dijiste en voz alta no se puede acreditar. No es un
déficit tuyo. → `09-para-vos-feedback.md`

**17. Cambié de enfoque teórico. ¿Se rehacen las notas viejas?**
No. Las sesiones ya analizadas conservan el instrumento con el que se generaron.
→ `11-tu-consultorio.md`

**18. ¿A qué hora sale el recordatorio?**
A las 20:00 del día anterior, a las 20:00 de dos días antes, o a las 8:00 del día
del turno, según lo que elijas. Si el turno es antes de las 8:00, sale igual la
tarde anterior. → `06-recordatorios-sms.md`

**19. Mi paciente contestó el SMS y no me llegó nada.**
El SMS sale de un número de servicio: las respuestas no llegan a ningún lado. Por
eso todo mensaje termina diciendo a quién y a qué número escribir.
→ `06-recordatorios-sms.md`

**20. Cancelé un turno. ¿Le llega el recordatorio igual?**
No. Cancelar, reprogramar, cobrar o marcar "No vino" apaga el recordatorio.
→ `03-agenda-y-turnos.md`

**21. Cobré un turno por error. ¿Cómo lo deshago?**
Abrí el turno cobrado en Agenda o en **Ficha → Turnos y pagos** y tocá
**Deshacer cobro**. Al confirmar, el monto vuelve a la deuda y el turno queda
sin cobrar; no vuelve a Agendado. → `05-cobros.md`

**22. Quiero cobrar un turno de hoy y no me deja.**
Si la hora del turno todavía no llegó, la app dice *"La sesión todavía no
empezó"*. Cuando llegue la hora vas a poder. → `05-cobros.md`

**23. Cambié la tarifa en Tu consultorio. ¿Cambian los turnos ya agendados?**
No. La tarifa nueva se propone al crear pacientes nuevos; los pacientes y turnos
ya cargados quedan con la suya. → `11-tu-consultorio.md`

**24. Una paciente dejó de venir. ¿La borro?**
Se archiva, no se borra: *"Deja de aparecer en la lista. Las sesiones, las notas
y los pagos se conservan; podés reactivarlo cuando quieras."*
→ `04-pacientes-y-ficha.md`

**25. ¿Por qué el Recorrido no me muestra gráficos?**
Aparecen **a partir de la tercera sesión grabada y aprobada**. Antes dice
*"Todavía no hay suficiente recorrido."* → `10-el-hilo-y-el-recorrido.md`

**26. Me olvidé la contraseña.**
No hay recuperación por mail: la contraseña se cambia desde adentro, sabiendo la
actual. → `01-entrar-y-cuenta.md`

**27. Me equivoqué cinco veces y no me deja entrar.**
Es el bloqueo por intentos: 15 minutos la primera vez, y más si se repite. Se
destraba solo. Acertar después no borra el contador del día.
→ `01-entrar-y-cuenta.md`

<!-- fuentes:
src/lib/glosario.ts
src/lib/login-intentos.ts
src/lib/consentimiento.ts
src/lib/recordatorios-programacion.ts
src/lib/sms-texto.ts
src/app/api/sesion-clinica/route.ts
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/app/api/_lib/casos-uso/aprobar-sesion.ts
src/app/api/_lib/casos-uso/recordatorios-del-turno.ts
src/app/api/turnos/[id]/cobrar/route.ts
src/app/api/config/route.ts
src/app/api/turnos/route.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/pacientes/[id]/_components/ficha-tab.tsx
src/app/(dashboard)/pacientes/[id]/_components/graficos/contenedor.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/components/grabacion/GrabadorSesion.tsx
src/components/grabacion/RiesgoDetectadoBanner.tsx
src/components/grabacion/FeedbackTerapeutaView.tsx
processor/prompts/clinical_note_v3.1.1.md
processor/prompts/therapist_feedback_gestalt_v1.1.md
docs/pipeline.md
-->
