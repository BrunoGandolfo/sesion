# Forense 2 · Panel 4: componentes y librerías compartidas

**Commit leído:** `main` = `8f2047b` (Merge origin/consentimiento-2-7), en `~/proyectos/sesion-arreglos`. Al terminar, `git status` está vacío: no se tocó nada.
**Zona:** `src/components/**`, `src/hooks/**`, `src/lib/**` (salvo `src/lib/sesion-clinica/`, que es del panel 1), `src/types/**`, `src/app/globals.css` y `src/app/_marca.tsx`. Son 121 archivos fuente y 48.303 líneas contando los tests.
**Fecha:** 28 de septiembre de 2026.

**Cómo se hizo:**
- Un script propio con el parser de TypeScript del repo (`node_modules/typescript`, sin instalar nada). Arma el grafo de imports de `src/`, `processor/`, `scripts/`, `pruebas/` y los `.ts` de la raíz, contando imports estáticos, `import()` dinámicos, `vi.mock`, `require` y re-exports. Resuelve `@/*` como lo hace el tsconfig y **sigue los barriles**: `ui/index.ts`, `esqueletos/index.ts` y los `textos.ts` de pantalla que re-exportan el glosario. El resultado son consumidores por módulo y por export, separando producción de tests.
- Un segundo script sobre `glosario.ts`, que mide las claves vivas de cada objeto y agrupa los exports por la pantalla que los consume.
- Un tercer script que mide largo y complejidad ciclomática aproximada por función.
- Tres agentes de solo lectura: calidad de tests, duplicación, y CSS/variantes/hooks. Sus hallazgos principales los volví a verificar con `grep` o `sed -n` antes de pasarlos acá (se marca cuáles).

**VERIFICADO** = leí las líneas en 8f2047b o corrí el script o el grep. **HIPÓTESIS** = deducido y no comprobado.

---

## Resumen

- **No hay módulos con cero consumidores.** Los 120 módulos TS de la zona tienen al menos un importador de producción. La limpieza del 24-sep hizo su trabajo: se fueron `NotaClinicaView`, `SesionHuerfanaBanner`, el cifrado de `crypto.ts` y las acciones muertas de `useGrabacionSesion`.
- **25 módulos tienen un solo consumidor.** Casi todos se justifican porque son lógica pura extraída para testearla (ver §(a)). Hay que cuestionar cuatro: `components/forms/index.ts`, `ui/select.tsx`, `ui/guardado-campo.tsx` y `login-intentos.ts` (este último se conserva).
- **Hay 239 exports sin consumidor de producción:**
  - 9 no tienen ningún uso, ni en tests ni dentro del módulo.
  - 10 los usan solo los tests.
  - 86 se usan dentro de su módulo y además los usan los tests.
  - **134 se usan solo dentro de su módulo**, así que se les puede sacar el `export` en bloque sin borrar código.
- **El glosario está vivo.** Tiene 472 exports, de los cuales **468 están vivos y 4 muertos**, más 9 claves muertas dentro de objetos. El problema no es el código muerto sino las copias a mano de textos que ya existen (ver H3 y H4) y el tamaño.
- **La duplicación que más pesa está en cómo se le dice un error a ella:** hay 22 `instanceof Error ? err.message` contra 8 `ApiClientError ? mensaje : ALGO_FALLO`. Después vienen 12 `fetch` crudos que reimplementan `api-client`, el estado del toast copiado 9 veces y los nombres clínicos en 4 diccionarios.
- **Tests de lib/:** de 123 archivos, 69 protegen comportamiento, 33 son de integración, 8 son guardianes y 4 prueban scripts de CI. Hay **5 archivos mixtos que concentran ~72 aserciones sobre el texto del código fuente** y 35 `expect(hechos.X).toBe(...)` que comparan una constante consigo misma.

---

## (a) Inventario

Columnas: consumidores **de producción** (archivos no-test que lo importan, directo o por barril) y de test. La última columna cuenta sus exports que ningún archivo de producción importa (incluye los que solo se usan adentro).

| módulo | líneas | exports | consumidores prod | consumidores test | exports sin consumidor prod |
|---|---:|---:|---:|---:|---:|
| `components/ayuda/panel-ayuda.tsx` | 361 | 5 | **1** (components/layout/ayuda-del-panel.tsx) | 4 | 4 |
| `components/clinico/brief-corto.tsx` | 365 | 8 | 3 | 7 | 4 |
| `components/clinico/HiloContenido.tsx` | 68 | 2 | 2 | 1 | 0 |
| `components/clinico/HiloEditor.tsx` | 67 | 1 | **1** (components/clinico/HiloView.tsx) | 1 | 0 |
| `components/clinico/HiloView.tsx` | 151 | 1 | **1** (app/(dashboard)/pacientes/[id]/_components/recorrido-tab.tsx) | 1 | 0 |
| `components/clinico/MencionesNota.tsx` | 31 | 3 | 2 | 0 | 0 |
| `components/esqueletos/base.tsx` | 115 | 5 | 6 | 0 | 1 |
| `components/esqueletos/cobros.tsx` | 96 | 2 | 2 | 1 | 0 |
| `components/esqueletos/finanzas.tsx` | 78 | 2 | 2 | 1 | 0 |
| `components/esqueletos/hoy.tsx` | 168 | 1 | 2 | 1 | 0 |
| `components/esqueletos/index.ts` | 11 | 0 | 10 | 1 | 0 |
| `components/esqueletos/nota.tsx` | 91 | 2 | 2 | 1 | 0 |
| `components/esqueletos/pacientes.tsx` | 68 | 2 | 2 | 1 | 0 |
| `components/esqueletos/pantalla.tsx` | 47 | 1 | **1** (app/(dashboard)/loading.tsx) | 1 | 0 |
| `components/forms/index.ts` | 2 | 0 | **1** (app/(dashboard)/_components/sheet-nuevo-turno.tsx) | 0 | 0 |
| `components/forms/nuevo-turno-form.tsx` | 662 | 4 | 4 | 6 | 2 |
| `components/forms/resultado-serie.tsx` | 37 | 1 | 2 | 1 | 0 |
| `components/forms/turno-editar-campos.tsx` | 205 | 4 | 2 | 1 | 0 |
| `components/grabacion/ConsentimientoBadge.tsx` | 249 | 1 | 2 | 2 | 0 |
| `components/grabacion/ConsentimientoForm.tsx` | 133 | 1 | **1** (components/grabacion/ConsentimientoBadge.tsx) | 0 | 0 |
| `components/grabacion/FeedbackTerapeutaView.tsx` | 816 | 5 | 4 | 1 | 2 |
| `components/grabacion/FirmaCanvas.tsx` | 210 | 1 | **1** (components/grabacion/ConsentimientoForm.tsx) | 0 | 0 |
| `components/grabacion/GrabadorSesion.tsx` | 638 | 11 | 2 | 5 | 6 |
| `components/grabacion/HotWordsManager.tsx` | 669 | 1 | 2 | 3 | 0 |
| `components/grabacion/RiesgoDetectadoBanner.tsx` | 252 | 3 | 3 | 0 | 0 |
| `components/layout/aviso-prueba.tsx` | 22 | 1 | 2 | 0 | 0 |
| `components/layout/aviso-version.tsx` | 81 | 2 | **1** (app/(dashboard)/layout.tsx) | 1 | 1 |
| `components/layout/avisos-de-notas.tsx` | 337 | 3 | 3 | 1 | 0 |
| `components/layout/ayuda-del-panel.tsx` | 35 | 2 | 3 | 2 | 0 |
| `components/layout/bottom-nav.tsx` | 106 | 1 | **1** (app/(dashboard)/layout.tsx) | 2 | 0 |
| `components/layout/cabecera-usuario.tsx` | 86 | 2 | 6 | 12 | 0 |
| `components/layout/globito-hoy.tsx` | 34 | 2 | 2 | 0 | 0 |
| `components/layout/proteccion-trabajo.tsx` | 155 | 3 | 8 | 5 | 0 |
| `components/layout/providers.tsx` | 32 | 3 | 3 | 2 | 1 |
| `components/layout/sidebar.tsx` | 244 | 1 | **1** (app/(dashboard)/layout.tsx) | 1 | 0 |
| `components/layout/textos.ts` | 41 | 6 | 2 | 0 | 0 |
| `components/ui/avatar.tsx` | 37 | 1 | 6 | 0 | 0 |
| `components/ui/button.tsx` | 78 | 1 | 44 | 1 | 0 |
| `components/ui/card.tsx` | 31 | 1 | 15 | 0 | 0 |
| `components/ui/chip.tsx` | 76 | 1 | 13 | 1 | 0 |
| `components/ui/confirmar.tsx` | 157 | 2 | 11 | 2 | 1 |
| `components/ui/editorial-rule.tsx` | 14 | 1 | 7 | 0 | 0 |
| `components/ui/fab.tsx` | 22 | 1 | 2 | 0 | 0 |
| `components/ui/guardado-campo.tsx` | 10 | 2 | **1** (app/(dashboard)/config/_components/config-view.tsx) | 0 | 0 |
| `components/ui/index.ts` | 16 | 0 | 64 | 5 | 0 |
| `components/ui/input.tsx` | 69 | 1 | 12 | 0 | 0 |
| `components/ui/lupita.tsx` | 220 | 10 | 9 | 3 | 4 |
| `components/ui/movimiento.tsx` | 399 | 24 | 21 | 4 | 12 |
| `components/ui/plegable.tsx` | 96 | 1 | 6 | 0 | 0 |
| `components/ui/procesando.tsx` | 41 | 1 | 3 | 1 | 0 |
| `components/ui/segmented.tsx` | 78 | 1 | 9 | 1 | 0 |
| `components/ui/select.tsx` | 14 | 1 | **1** (components/clinico/HiloEditor.tsx) | 0 | 0 |
| `components/ui/session-row.tsx` | 318 | 3 | 4 | 5 | 1 |
| `components/ui/sheet.tsx` | 316 | 3 | 12 | 11 | 2 |
| `components/ui/textarea.tsx` | 62 | 1 | 5 | 0 | 0 |
| `components/ui/toast.tsx` | 107 | 2 | 10 | 1 | 0 |
| `hooks/useGrabacionSesion.ts` | 279 | 6 | 2 | 7 | 2 |
| `hooks/useHoy.ts` | 79 | 1 | 2 | 3 | 0 |
| `hooks/useMovimientoReducido.ts` | 18 | 1 | 9 | 0 | 0 |
| `hooks/usePantallaEncendida.ts` | 71 | 2 | **1** (app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx) | 1 | 1 |
| `hooks/useSesionClinicaPolling.ts` | 289 | 7 | 3 | 6 | 1 |
| `lib/agendar-turno.ts` | 60 | 3 | 2 | 1 | 1 |
| `lib/alertas.ts` | 134 | 7 | 3 | 2 | 6 |
| `lib/anthropic-mensajes.ts` | 208 | 13 | 3 | 4 | 6 |
| `lib/api-client.ts` | 137 | 7 | 37 | 40 | 1 |
| `lib/ayuda-corpus.ts` | 228 | 10 | **1** (app/api/_lib/casos-uso/responder-ayuda.ts) | 5 | 9 |
| `lib/ayuda-texto.ts` | 58 | 4 | **1** (app/api/ayuda/route.ts) | 1 | 0 |
| `lib/consentimiento-hechos.ts` | 225 | 51 | 2 | 4 | 11 |
| `lib/consentimiento.ts` | 228 | 8 | 5 | 3 | 1 |
| `lib/constantes-turno.ts` | 78 | 23 | 23 | 5 | 5 |
| `lib/correo-plantillas.ts` | 24 | 1 | **1** (app/api/_lib/casos-uso/recuperar-cuenta.ts) | 1 | 0 |
| `lib/correo.ts` | 50 | 5 | 4 | 2 | 3 |
| `lib/crypto.ts` | 28 | 1 | 4 | 1 | 0 |
| `lib/csp-reportes.ts` | 208 | 7 | **1** (app/api/csp-report/route.ts) | 1 | 3 |
| `lib/csp.ts` | 229 | 12 | **1** (proxy.ts) | 2 | 9 |
| `lib/cuenta-recuperacion-db.ts` | 81 | 1 | 2 | 2 | 0 |
| `lib/cuenta-registro-db.ts` | 105 | 1 | 3 | 1 | 0 |
| `lib/cuenta-tokens.ts` | 29 | 7 | 5 | 3 | 0 |
| `lib/db.ts` | 33 | 1 | 108 | 12 | 0 |
| `lib/deudas.ts` | 79 | 5 | 3 | 2 | 1 |
| `lib/encryption.ts` | 142 | 8 | 2 | 4 | 4 |
| `lib/env-operacion.ts` | 47 | 4 | 2 | 1 | 3 |
| `lib/etiquetas.ts` | 231 | 2 | 8 | 1 | 0 |
| `lib/fechas-montevideo.ts` | 296 | 27 | 39 | 12 | 1 |
| `lib/fonts.ts` | 31 | 2 | **1** (app/layout.tsx) | 0 | 0 |
| `lib/format.ts` | 189 | 12 | 37 | 3 | 0 |
| `lib/glosario.ts` | 1757 | 472 | 121 | 60 | 4 |
| `lib/grabacion-captura.ts` | 132 | 15 | 3 | 6 | 2 |
| `lib/grabacion-cronometro.ts` | 39 | 3 | **1** (components/grabacion/GrabadorSesion.tsx) | 1 | 0 |
| `lib/grabacion-microfono.ts` | 77 | 2 | **1** (components/grabacion/GrabadorSesion.tsx) | 1 | 0 |
| `lib/grabacion-storage.ts` | 347 | 7 | 3 | 6 | 0 |
| `lib/hilo/contenido.ts` | 76 | 10 | 14 | 9 | 0 |
| `lib/hot-words.ts` | 59 | 6 | 3 | 3 | 2 |
| `lib/intentos-acceso.ts` | 280 | 20 | 3 | 3 | 13 |
| `lib/intentos-serializados.ts` | 114 | 6 | 5 | 1 | 3 |
| `lib/limites-prueba.ts` | 53 | 10 | 7 | 5 | 1 |
| `lib/llavero.ts` | 160 | 13 | 3 | 32 | 9 |
| `lib/login-intentos.ts` | 138 | 8 | **1** (lib/intentos-acceso.ts) | 5 | 4 |
| `lib/movimiento.ts` | 13 | 3 | 9 | 4 | 0 |
| `lib/notas-en-proceso.ts` | 292 | 24 | 7 | 3 | 6 |
| `lib/orden-deuda.ts` | 13 | 1 | 2 | 0 | 0 |
| `lib/password.ts` | 75 | 6 | 9 | 5 | 3 |
| `lib/phone.ts` | 31 | 2 | **1** (app/api/_lib/schemas.ts) | 1 | 1 |
| `lib/prisma-encryption.ts` | 684 | 27 | 17 | 13 | 17 |
| `lib/r2.ts` | 172 | 6 | 5 | 6 | 2 |
| `lib/recordatorios-programacion.ts` | 116 | 10 | 4 | 4 | 5 |
| `lib/request-huella.ts` | 47 | 5 | 4 | 1 | 4 |
| `lib/salud-metricas.ts` | 149 | 12 | 8 | 2 | 1 |
| `lib/sesion-acceso.ts` | 199 | 19 | 9 | 5 | 10 |
| `lib/sesion-cliente.ts` | 20 | 1 | 2 | 1 | 0 |
| `lib/sesion-cookie.ts` | 121 | 13 | 11 | 7 | 5 |
| `lib/sms/backoff.ts` | 86 | 9 | **1** (app/api/_lib/casos-uso/despachar-sms.ts) | 1 | 7 |
| `lib/sms/clasificar.ts` | 176 | 5 | 2 | 1 | 1 |
| `lib/sms/firma.ts` | 69 | 8 | 3 | 3 | 4 |
| `lib/sms/metricas.ts` | 109 | 5 | **1** (app/api/_lib/casos-uso/salud.ts) | 1 | 4 |
| `lib/sms/texto.ts` | 169 | 7 | 3 | 4 | 3 |
| `lib/sms/twilio.ts` | 178 | 8 | 2 | 2 | 4 |
| `lib/telemetria-saneo.ts` | 161 | 5 | 2 | 1 | 3 |
| `lib/version-app.ts` | 4 | 1 | 2 | 1 | 0 |
| `types/domain.ts` | 559 | 48 | 47 | 28 | 12 |

**Los de un solo consumidor**, uno por uno:

| módulo | consumidor | veredicto |
|---|---|---|
| `components/forms/index.ts` | `sheet-nuevo-turno.tsx` | **BORRAR el barril**. Tiene 1 consumidor y los otros 10 imports de `nuevo-turno-form` van directo. |
| `components/ui/select.tsx` (14 l.) | `HiloEditor.tsx` | CONSERVAR. Es primitiva del sistema de diseño (igual que Input y Textarea); no está en `ui/index.ts`, así que conviene agregarla. |
| `components/ui/guardado-campo.tsx` (10 l.) | `config-view.tsx` | CABLEAR: tiene 4 textos a mano (":7", "Guardando…" ya existe como `GUARDANDO`). La cabecera dice "Textos para integrar al glosario". |
| `components/clinico/HiloEditor.tsx`, `HiloView.tsx`, `ConsentimientoForm.tsx`, `FirmaCanvas.tsx`, `layout/{sidebar,bottom-nav,aviso-version}.tsx`, `ayuda/panel-ayuda.tsx`, `esqueletos/pantalla.tsx` | una pantalla | CONSERVAR. Son componentes de pantalla, no abstracciones: tener un consumidor es lo esperado. |
| `lib/login-intentos.ts` | `intentos-acceso.ts` | CONSERVAR. La parte pura (umbrales, bloqueo) va aparte de la de Prisma y tiene 5 tests. |
| `lib/grabacion-cronometro.ts`, `grabacion-microfono.ts` | `GrabadorSesion.tsx` | CONSERVAR. Se extrajeron del grabador para testearlas (1 test cada una). |
| `lib/sms/backoff.ts`, `sms/metricas.ts`, `csp-reportes.ts`, `ayuda-texto.ts`, `ayuda-corpus.ts`, `correo-plantillas.ts`, `phone.ts`, `fonts.ts` | su caso de uso o ruta | CONSERVAR. Son lógica pura con test propio. `csp.ts` tiene 1 consumidor **por diseño** (regla 9 de AGENTS.md). |
| `hooks/usePantallaEncendida.ts` | `grabar-view.tsx` | CONSERVAR. |

---

## (b) Hallazgos

Formato: **riesgo** (alto/medio/bajo) · **propuesta mínima** · **esfuerzo** S/M/L · V/H.

### Glosario (punto 2)

**H1. El glosario tiene 4 exports y 9 claves sin lector de producción.**
- `src/lib/glosario.ts:142` `SOAP_SECCIONES` (solo lo usa `glosario.test.ts`).
- `:190` `SENALES_ANTERIORES`, que tiene cero usos **y** dos copias a mano: `src/components/clinico/HiloEditor.tsx:52` y `HiloContenido.tsx:47`.
- `:305` `RECORDATORIO_ESTADO` (8 claves), que tiene una copia literal en `src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx:395`. El único test que la cubre (`textos-integrados.test.ts:5-9`) protege la copia que nadie usa.
- `:1016` `CARGANDO`, con 9 "Cargando…" a mano. En la zona está `src/components/clinico/brief-corto.tsx:292`; el resto está en `config-view.tsx:397`, `agenda-view.tsx:109`, `sesiones-tab.tsx:363,403,533`, `pacientes-view.tsx:308` y `turno-detail-sheet.tsx:212`.
- Clave muerta `CTSR.ayuda`.

Riesgo: medio. Cambiar el rótulo en el glosario no cambia la pantalla. Propuesta: CABLEAR `SENALES_ANTERIORES`, `RECORDATORIO_ESTADO` y `CARGANDO` donde están las copias; BORRAR `SOAP_SECCIONES` y su test. S. VERIFICADO.

**H2. El glosario, que se presenta como "solo strings", tiene 24 funciones, y una formatea la hora con la zona del dispositivo.** `glosario.ts:371-372` `horaCorta` usa `toLocaleTimeString("es-UY", …)` **sin `timeZone`**, y es la única hora de pantalla que no sale en hora de Montevideo. La usan los avisos de grabación de `:376` y `:380`. Riesgo: bajo en la práctica (el teléfono está en UY) y visible en tests con `TZ=UTC`. Propuesta: usar `hora()` de `format.ts`. S. VERIFICADO (ya estaba el 24-sep y sigue vivo).

**H3. Hay texto fuera del glosario dentro de la zona.**
- `src/components/layout/textos.ts` (6 exports, con plurales a mano en `:11,21,23,39`).
- `ui/guardado-campo.tsx:7`.
- `forms/nuevo-turno-form.tsx:77` ("Texto de pantalla que todavía no se mudó").
- `lib/agendar-turno.ts:42` (ídem).
- `forms/resultado-serie.tsx:31` ("Entendido", que ya existe como `ENTENDIDO`).
- `grabacion/HotWordsManager.tsx:452` ("Reintentar", que ya existe como `REINTENTAR`).
- `clinico/HiloEditor.tsx:40` y `HiloContenido.tsx:43` ("Intervenciones", que ya existe como `INTERVENCIONES`).
- `clinico/HiloView.tsx:16,97,98,127,132`.
- `lib/deudas.ts:20-24` `textoAtraso`: dice "hace 95 días" donde `fechaRelativa` (`format.ts:117`) diría "Hace 3 meses".

Riesgo: medio, porque viola la regla del repo y hace que la misma cosa se diga distinto. Propuesta: mudar al glosario, usando `pluralizar`. S por archivo. VERIFICADO.

**H4. Partir el glosario por pantalla: se puede, pero no es urgente.** Mediciones (VERIFICADO con el script, siguiendo barriles):
- De 472 exports, **370 tienen un solo archivo consumidor** y 84 tienen entre 2 y 3.
- Agrupados por la pantalla que los consume: sesiones 68, finanzas 43, pacientes 42, cobros 32, `api/` 27, config 23, grabar 23, Hoy 22, lib 17, login 17, ayuda 15, clínico 14, agenda 10 y otras con menos. Hay 79 compartidos entre 2 o más zonas.
- Ya existe el patrón de barril por pantalla: `sesiones/[id]/_components/textos.ts` (64 re-exports) y `graficos/textos.ts` (23).

Propuesta, sin romper la regla "todo texto vive en el glosario": convertir `src/lib/glosario.ts` en `src/lib/glosario/index.ts` con `export * from "./comun"`, `"./clinico"`, `"./hoy"`, `"./agenda"`, `"./cobros"`, `"./finanzas"`, `"./grabacion"`, `"./sesion"`, `"./config"`, `"./cuenta"` (login, registro, recuperar, términos), `"./ayuda"` y `"./sms"`. Todo import `@/lib/glosario` y el `import * as glosario` de los tests siguen funcionando.

Lo que se rompe y hay que tocar:
- `ayuda-vigente.test.ts:75,184,442` y `ayuda-corpus-codigo.test.ts:101`, que leen `src/lib/glosario.ts` como texto (otra razón para arreglar T3).
- `proxy-liviano.test.ts:135`, que tiene la ruta en la lista de prohibidos (hay que prohibir la carpeta).
- Las citas en `docs/ayuda/*.md` y `docs/diseno/04-personaje.md`.

Riesgo de no hacerlo: bajo. El archivo está vivo y ordenado por secciones. Esfuerzo M. **Recomendación:** hacer antes H1, H2 y H3, y partirlo después solo si molesta al editar. HIPÓTESIS de que conviene.

### Código muerto (punto 2)

**H5. Hay 9 exports sin ningún uso, ni en tests ni dentro de su módulo.** Todos VERIFICADO con grep en `src`, `processor`, `scripts` y `pruebas`.

| archivo:línea | símbolo | propuesta |
|---|---|---|
| `src/lib/consentimiento-hechos.ts:168` | `ACCION_VER_SESION` | CABLEAR (ver H9) |
| `src/lib/consentimiento-hechos.ts:86` | `ASR_CONFIRMACION_HTTP` | BORRAR, o atarlo al worker en un test de `processor/` |
| `src/lib/consentimiento-hechos.ts:51` | `CLAVE_POR_SESION` | Solo lo lee `consentimiento.test.ts:74` con `toBe(false)` (ver T1). BORRAR |
| `src/lib/consentimiento-hechos.ts:96` | `VOCABULARIO_SOLO_A_ASR` | Ídem (`consentimiento.test.ts:128`). BORRAR |
| `src/lib/constantes-turno.ts:76` | `frecuenciaSerieSchema` | BORRAR (quedan `frecuenciaTurnoSchema` y el resto) |
| `src/lib/glosario.ts:142,190` | `SOAP_SECCIONES`, `SENALES_ANTERIORES` | ver H1 |
| `src/types/domain.ts:119` | `interface Recordatorio` | BORRAR. Es el modelo viejo; el SMS vive en `EnvioSms` |
| `src/types/domain.ts:389` | `type SpeechAnalytics` | BORRAR. Duplica `src/lib/sesion-clinica/schema.ts:136` con el mismo nombre |

**H6. Hay exports que solo usan los tests.**
- `src/lib/phone.ts:25` `formatPhoneDisplay`: cero usos en producción, lo cubre `phone.test.ts:47-58`. BORRAR la función y el test, o CABLEARLA donde se muestra el teléfono. La decisión es de producto: el 24-sep se dejó abierta y sigue igual.
- `glosario.ts:305` `RECORDATORIO_ESTADO`: ver H1.
- `llavero.ts:157` `__resetLlaveroForTests` (32 tests) y `ayuda-corpus.ts:224` `olvidarCorpus` (3 tests): CONSERVAR, son enganches de test explícitos.

S. VERIFICADO.

**H7. Hay 134 exports que solo se usan dentro de su módulo.** Los que más concentran:

| módulo | cantidad |
|---|---|
| `prisma-encryption.ts` | 20 (tipos `Campos*` y `ColumnasCifradas*`, `ModeloCifrado`, `normalizarNotaSoap`) |
| `movimiento.tsx` | 12 |
| `sesion-acceso.ts` | 8 |
| `sms/*` | 14 en total |
| `intentos-acceso.ts` | 7 |
| `_marca.tsx` | 6 (`LIENZO`, `SALVIA`, `CREMA`, `SAGE_300`, `MEDIDAS_CHICAS`, `MedidasMarca`) |

Riesgo: nulo; es superficie de API. Propuesta: sacar el `export` en bloque. No borra código. S (mecánico). VERIFICADO el conteo. La lista completa sale de correr `analisis.cjs` (en el scratchpad de esta sesión) sobre la categoría "interno sin test".

**H8. Hay variantes y props que nadie pasa.** El agente las verificó recorriendo con el parser los elementos JSX de `src/**` y `pruebas/**`. Todo VERIFICADO.
- `src/components/ui/card.tsx:4-5,17-20` `clickable` y `elevated`: 0 de 28 usos las pasan (reverificado con grep). BORRAR las dos ramas. S.
- `src/components/ui/movimiento.tsx:220-233` `Contador`: 0 usos en pantallas; ya no anima e ignora `duracion`. Solo lo usa `limites-movimiento.test.tsx:25`. BORRAR el componente y el test. S.
- `movimiento.tsx:24,93-147` `ListaEnCascada`: `PASO_CASCADA_MS = 0` y nadie pasa `pasoMs` ni `maximo`, así que ya no escalona. `ElementoMovimiento.section` (`:40`) y `MS_RESPIRO = 0` (`:302`) son vestigios. BORRAR las props y las constantes. S.
- `src/components/ui/lupita.tsx:100-118,127-200`:
  - `respira` y `habla` dibujan lo mismo que `quieta`, y la prop `pulso` se declara pero nunca se lee.
  - Aun así `panel-ayuda.tsx:77,86,125,156,230` mantiene un contador `fragmentosRecibidos` solo para pasarle `pulso`.
  - Propuesta: reducir `MovimientoLupita` y borrar `pulso` y el contador. M (hay que tocar 2 tests cosméticos).
- Props opcionales que nadie pasa: `Toast.duration` (`toast.tsx:50`), `Latido.etiqueta` (`movimiento.tsx:245`), `AnilloProgreso.etiqueta` (`:355`), `SessionRow.onClick` y `SessionRow.className` (`session-row.tsx:40,67`). BORRAR. S.
- `sheet.tsx:21` `ALTURA_NAV_MOBILE`: exportada y nunca importada. Sacar el export. S.

**H9. CSS sin uso.**
- Tokens `--color-sage-400`, `--color-sage-900`, `--color-success`, `--color-warning` y `--color-info` (`src/app/globals.css:15,20,62,63,65`).
- `--border-focus` (`:94`).
- No hay clases armadas por interpolación (`bg-${x}`), así que los ceros son seguros.
- El bloque "Motion tokens" (`:82-95`) solo tiene bordes.
- `.text-sage-500`, `.text-terracotta-500` y `.text-gold-500` (`:123-133`) pintan otro color que el que dice su nombre (el ajuste AA). Hay que documentarlo junto al `@theme`; migrarlos sería M, 140 call sites (HIPÓTESIS de que conviene).
- Los 4 keyframes y todas las clases propias están vivos.

Propuesta: BORRAR las 6 líneas y corregir el título. S. VERIFICADO.

### Duplicación (punto 3)

**H10. El error se le muestra a ella con dos criterios opuestos.**
- 8 sitios usan `err instanceof ApiClientError ? err.mensaje : ALGO_FALLO`. Por ejemplo `nuevo-turno-form.tsx:412`, `config-view.tsx:301` y `cobros-view.tsx:474`.
- 22 sitios usan `instanceof Error ? e.message` (grep reverificado). En la zona: `ConsentimientoForm.tsx:67`, `HiloView.tsx:16` y `useSesionClinicaPolling.ts:215`. Ese criterio muestra en pantalla "Failed to fetch", "Load failed" o `HTTP 500`: lo arma `useSesionClinicaPolling.ts:196` y lo repite `parseError` en `useGrabacionSesion.ts:25-30`.

Resultado: la misma caída de red se lee en inglés en una pantalla y en castellano en otra. Riesgo: medio (UX y confianza). Propuesta: `mensajeParaElla(err, porDefecto = ALGO_FALLO)` en `src/lib/api-client.ts` y reemplazo mecánico. S. VERIFICADO. Que "HTTP 500" llegue a verse en la pantalla de la nota es HIPÓTESIS del agente.

**H11. Hay 12 `fetch` a mano que reimplementan `api-client`.**
- `src/components/grabacion/HotWordsManager.tsx:124,234,268,288,310` (5): tira el `error` del servidor y en `:273` y `:289` lanza `throw new Error()` vacío.
- `src/hooks/useGrabacionSesion.ts:114,139,174,182,203,247` (6), con su propio `parseError`.
- `useSesionClinicaPolling.ts:189` (1), que equivale exactamente a `apiGet(path, {signal})`.
- Justificados, no se tocan: el stream de `panel-ayuda.tsx:133`, `aviso-version.tsx:31` (timeout propio), `sesion-cliente.ts:14` (logout) y el PUT a R2.

Además, `useGrabacionSesion.ts` es en realidad el **cliente de la subida** (`subirAudio`, `volverAGrabando` y `marcarTurnoRealizado` exportadas, líneas 106-220) más un hook de 55 líneas: el nombre del archivo esconde lo que tiene.

Propuesta:
1. Migrar HotWordsManager y el polling (S).
2. Después `useGrabacionSesion` (M, porque es el camino de grabación; lo cubre `grabacion-subida.test.ts`).
3. Opcional: mover las funciones de subida a `src/lib/grabacion-subida.ts`.

VERIFICADO.

**H12. Los nombres clínicos están en 4 diccionarios.**
- `src/lib/etiquetas.ts:63-96`, que en `:11-12` dice ser "la única fuente".
- `src/components/grabacion/RiesgoDetectadoBanner.tsx:57-63` `NOMBRE_FLAG`.
- `(d)/sesiones/[id]/_components/mas-de-esta-sesion.tsx:33-49`.
- `(d)/pacientes/[id]/_components/graficos/base.tsx:106-111`.

Hoy coinciden letra por letra. Riesgo: medio, porque incluye la **señal de riesgo**: corregir un nombre en una pantalla y no en otra es un error clínico visible. Propuesta: que `etiquetas.ts` exporte mapas tipados derivados del `DICCIONARIO` y que los tres los importen. S. VERIFICADO.

**H13. El estado del toast está copiado 9 veces.**
- `useState<{open,message,variante}>` en 8 pantallas, y con otra forma en `sesion-detail-view.tsx:159`.
- `type ToastState` redeclarado 4 veces.
- 45 llamadas a `setToast(`.
- Componente hay uno solo (`ui/toast.tsx`); lo que se repite es el estado.

Propuesta: `useToast()` en `ui/toast.tsx`. S-M. VERIFICADO.

**H14. Hay otras duplicaciones chicas.** Todas VERIFICADO, esfuerzo S, riesgo bajo.
- "¿Es escritorio?" está escrito 3 veces con `matchMedia` y `useSyncExternalStore`, y la misma medida en tres notaciones: `ui/sheet.tsx:64-80`, `layout/sidebar.tsx:226-242` y `agenda-view.tsx:45-58`. Propuesta: `src/hooks/useEsEscritorio.ts`.
- `format.ts:38-50,98,153` es una capa de alias de una línea sobre `formatear*Mvd`, y 13 archivos usan una capa u otra. Propuesta: elegir una.
- "AAAA-MM" se arma a mano en 5 lugares, y `claveDeCobro` (`envios-del-turno.ts:66`) es igual a `fechaInputMvd`. Propuesta: `mesIsoMvd()` en `fechas-montevideo.ts`.
- `cerrarSesion` tiene dos significados en módulos vecinos: `sesion-cliente.ts:10` (navegador) y `sesion-acceso.ts:160` (Prisma). Un auto-import equivocado arrastra Prisma al cliente. Propuesta: renombrar la del cliente a `salir()`.
- `panel-ayuda.tsx:71` usa `useReducedMotion` de framer sin la guarda de `useMovimientoReducido`.
- `cuenta-tokens.ts:9-12` reimplementa `bytesAHex` de `crypto.ts:3-9`.
- `MS_POR_DIA` está en 3 constantes y aparece 4 veces inline.
- El patrón `AbortController` + `useEffect` + fetch se repite unas 30 veces en componentes cliente. Es candidato a un `useCargar()`, pero es M y conviene hacerlo **después** de H10 y H11 (HIPÓTESIS de que valga la pena).

**H15. No son duplicación** (VERIFICADO): se revisaron y son capas distintas. Se dejan como están.
- El dinero pasa todo por `money` (`format.ts:20`, 16 importadores).
- date-fns solo aparece en `fechas-montevideo.ts`.
- Hay un solo Sheet, un solo Confirmar y un solo Toast.
- `crypto` / `encryption` / `llavero`: hash web, AES node y claves.
- `password` / `cuenta-tokens`.
- `login-intentos` / `intentos-acceso` / `intentos-serializados`: puro, Prisma y locks.
- `sesion-cookie` / `sesion-cliente` / `sesion-acceso`: la separación la exige la regla 9.
- `consentimiento` / `consentimiento-hechos`.
- `deudas` / `orden-deuda`: la fusión es opcional.

### Constantes declaradas y literales usados

**H16. Los códigos de auditoría de lectura están declarados en un lugar y escritos a mano en otros.**
- `src/lib/consentimiento-hechos.ts:168-169` declara `ACCION_VER_SESION` y `ACCION_VER_TRANSCRIPCION` sin ningún importador.
- Las rutas que escriben usan el literal: `src/app/api/sesion-clinica/[id]/route.ts:31` (`"sesion.ver"`) y `src/app/api/_lib/casos-uso/sesion/ver-transcripcion.ts:49`.
- Quien lee define una tercera copia: `avisos-notas.ts:92` `ACCION_VER`.
- El texto del consentimiento (2.7, firmado) afirma que "cada vez que abre tu nota o tu transcripción queda registrado".

Riesgo: **medio-alto**. Renombrar la acción en la ruta rompe en silencio los avisos de "nota vista" y deja al consentimiento sin respaldo, y ningún test lo detecta. Propuesta: las tres importan de `consentimiento-hechos`. S. VERIFICADO.

**H17. El tope de 20 reintentos está escrito dos veces.** Una en `consentimiento-hechos.ts:140` (`LIMPIEZA_AUDIO_MAX_INTENTOS`) y otra en `POLITICA_POR_TIPO`. Tres aserciones existen solo para tapar esa copia: `consentimiento.test.ts:169` y `ayuda-vigente.test.ts:395,454`. `ASR_BORRADO_MAX_INTENTOS` (`:82`) repite el mismo patrón. Propuesta: que la política importe el hecho (o al revés) y borrar esas aserciones. S. VERIFICADO según el agente; no reabrí `politica`.

### Funciones largas (punto 4)

Medido con el parser. Se listan las funciones de 60 líneas o más, o con complejidad 15 o más. Todo VERIFICADO.

| función | archivo:línea | líneas | complejidad | lectura |
|---|---|---:|---:|---|
| `generarTextoConsentimiento` | `src/lib/consentimiento.ts:82` | 94 | 44 | La complejidad es **nominal**: son ternarios sobre constantes booleanas de `consentimiento-hechos`, a propósito (el texto se genera desde los hechos). No partir. Sí sobra lo que ninguna rama lee (H5), y la frase de Lupita (`:128`) escribe los campos a mano en vez de derivarlos de `LUPITA_CAMPOS_AGENDA` (HIPÓTESIS menor: hoy coinciden). |
| `enviarSmsTwilio` | `src/lib/sms/twilio.ts:90` | 88 | 22 | Clara y lineal. Detalle: `clearTimeout(timer)` (`:151`) corre **antes** de `response.json()` (`:154,163`), así que la lectura del cuerpo queda sin timeout y un cuerpo lento puede colgar el cron. Riesgo bajo, HIPÓTESIS. Propuesta: pasar el `clearTimeout` después del `json()`, o usar `AbortSignal.timeout` como `correo.ts:38`. S. |
| `sanearEvento` | `src/lib/telemetria-saneo.ts:80` | 41 | 22 | Lista blanca explícita; la ramificación es el requisito. CONSERVAR. |
| `limpiarMarkdown` | `src/lib/ayuda-texto.ts:15` | 43 | 20 | CONSERVAR (tiene test). |
| `validarAnidadas` | `src/lib/prisma-encryption.ts:561` | 27 | 17, anidamiento 7 | Es la más difícil de leer de lib/. Candidata a extraer el caso por relación. M, beneficio medio. |
| `useSesionClinicaPolling` | `src/hooks/useSesionClinicaPolling.ts:134` | 155 | 8 | Largo por comentarios y efectos; se achica con H11. |
| `repositorioRegistro` / `repositorioRecuperacion` | `cuenta-registro-db.ts:10`, `cuenta-recuperacion-db.ts:8` | 95 / 73 | 1 | Son objetos literales de métodos; el largo no es complejidad. CONSERVAR. |

Fuera de lib/ (componentes de la zona): `HiloView` (130 l., cc 34), `NuevoTurnoForm` (533 l., cc 25), `HotWordsManager` (469 l.), `useGrabador` (488 l. dentro de `GrabadorSesion.tsx:150`), `PanelAyuda` (293 l.) y `Sheet` (222 l.). Los tres primeros mezclan carga, reglas y render. `NuevoTurnoForm` además crea pacientes, como ya se vio el 24-sep y sigue igual. No se proponen particiones hasta cerrar H10 y H11, que les sacan una parte.

### Tests de lib/ (punto 5)

Detalle archivo por archivo en el anexo del agente (tabla de 123 filas). Solo se leyeron a mano los guardianes y los mixtos; los 69 de "comportamiento" se clasificaron por heurística.

**T1. `consentimiento.test.ts` tiene 35 `expect(hechos.X).toBe(true|false)`** (p. ej. `:74-77`, `:96`, `:128`, `:162`). Afirman que una constante es igual a sí misma. Lo que protege de verdad es la aserción sobre el texto generado (`:91`, `:174`) y la de la política real (`:169`). Propuesta: BORRAR las 35. S. VERIFICADO.

**T2. Hay ~72 aserciones sobre el texto del código fuente en 5 archivos.**

| archivo | lecturas del código | archivos leídos |
|---|---:|---:|
| `consentimiento.test.ts` | 32 | 26 (TS, Python, SQL y YAML) |
| `ayuda-vigente.test.ts` | 23 | 17 |
| `ayuda-corpus-codigo.test.ts` | 7 | 6 |
| `limites-prueba-integracion.test.ts` | 4 | 4 |
| `rutas-area2.test.ts` | 6 regex | — |

Ejemplos:
- `consentimiento.test.ts:89` `xhr.open("PUT", url, true)` y `:102` `tx.objectStore(STORE_CHUNKS).delete(...)`.
- `ayuda-vigente.test.ts:442` `'EDITAR_DATOS = "Editar datos"'`.
- `ayuda-corpus-codigo.test.ts:82` `"tarifaCobrada: paciente.tarifa"`.

Un prettier o un renombre las rompe, y un cambio de comportamiento con el mismo texto las deja pasar. Propuesta:
- Donde ya hay test de comportamiento (`grabacion-storage`, `r2`, `crear-serie-turno`, `envios-del-turno`), borrar la aserción textual.
- Donde es texto de pantalla, comparar contra la constante del glosario (el test ya hace `import * as glosario`).
- Lo que es de Python, llevarlo a los tests de `processor/`.

M. VERIFICADO.

**T3. `limites-prueba-integracion.test.ts:51-56`** afirma cómo llama `grabar-view` (`apiPost<SesionApi>(...)`), no el límite. BORRAR esas líneas; el límite ya se prueba contra la base en el mismo archivo. S. VERIFICADO.

**T4. `rutas-area2.test.ts:100` puede dar verde en falso.** El guardián "solo el cron borra de R2" busca el import con una regex y solo en `src/app/api`. Un re-export o un import desde `src/lib` pasan sin que lo vea. Propuesta: reusar el caminante de imports de `proxy-liviano` o `rutas-sin-prisma` y preguntar quién alcanza `borrarAudio`. M. VERIFICADO.

**T5. `glosario.test.ts:7-17,50-52` copia el texto de los rótulos.** Son `toBe("Pagado")`, `NAV toEqual {...}` y similares: cambiar un rótulo obliga a tocarlo dos veces. Lo que sí protege es `pluralizar` (`:83-120`), la paridad entre métodos y etiquetas (`:33-42`) y que ningún texto quede vacío. Propuesta: BORRAR los `toBe` de literal, salvo `REVISE_ESTA_SENAL` si se lo considera texto con peso clínico (decisión del dueño). S. VERIFICADO.

**T6. Hay tests que protegen código muerto:** `phone.test.ts:47-58`, `textos-integrados.test.ts:5-9` y el bloque SOAP de `glosario.test.ts`. Se van con H1 y H6. S. VERIFICADO.

**T7. Guardianes robustos, el modelo a copiar:** `proxy-liviano`, `csp-destinos`, `rutas-sin-prisma` y `calendario-unico` usan el parser de TS o un grafo de imports. Los tests con muchos mocks (`despachar-sms`, `recuperar-cuenta`, `ayuda-stream`) afirman orden y propiedades de seguridad, que es comportamiento real; se conservan (HIPÓTESIS de que ninguno esté de más).

### Otros

**H18. Hay barriles con dos formas de importar.**
- `@/components/ui` tiene 64 importadores por el barril y 54 imports directos a `ui/movimiento`, `lupita`, `toast`, `session-row`, `procesando`, `sheet`, `confirmar`, `select`, `plegable`, `guardado-campo` y `chip`. Algunos de esos (Sheet, Chip, Plegable, Confirmar, Lupita, Toast, SessionRow) también están en el barril.
- `@/components/forms` tiene 1 importador por el barril y 14 directos.

Riesgo: nulo en ejecución, pero da dos formas de escribir lo mismo. Propuesta: BORRAR `forms/index.ts`. Para `ui/`, decidir una sola forma; la más barata es que todo vaya directo y borrar el barril (M, 64 archivos), o dejarlo como está. VERIFICADO el conteo.

**H19. Hay un re-export deprecado con un solo consumidor.** `src/types/domain.ts:557-558` re-exporta `normalizarRiesgo` con `@deprecated`, y lo usa solo `src/components/grabacion/RiesgoDetectadoBanner.tsx:12`. Propuesta: cambiar ese import y borrar el re-export. S. VERIFICADO.

**H20. Quedan comentarios viejos.**
- `src/lib/r2.ts:89-90` dice "PUT directo a R2 con el audio cifrado"; el audio no se cifra desde el 18/9.
- `src/components/ui/session-row.tsx:84-85` mantiene `"transcribiendo"` como "alias viejo que todavía llega en filas antiguas", y ese estado no existe en `schema.ts`. Si llega o no es HIPÓTESIS: se ve con una consulta de solo lectura a prod.

S. VERIFICADO (el texto).

---

## (c) VERIFICADO contra HIPÓTESIS

| hallazgo | estado |
|---|---|
| H1, H2, H3, H5, H6, H7, H8, H9, H12, H13, H14, H16, H18, H19 | VERIFICADO |
| H4 | Las mediciones están VERIFICADAS; que convenga partir el glosario es HIPÓTESIS |
| H10 | VERIFICADO el conteo y el código. Que "HTTP 500" o "Failed to fetch" lleguen a verse en cada una de las 22 pantallas es HIPÓTESIS, porque no lo reproduje |
| H11 | VERIFICADO. Que no haya una razón para el fetch crudo en la subida es HIPÓTESIS |
| H17 | VERIFICADO por el agente; no reabrí `politica` |
| H20 | VERIFICADO el texto; si `"transcribiendo"` todavía llega es HIPÓTESIS |
| Tabla de funciones largas | VERIFICADO. El timeout de `enviarSmsTwilio` es HIPÓTESIS |
| T1-T6 | VERIFICADO |
| T7 | VERIFICADOS los guardianes; que ningún test con muchos mocks esté de más es HIPÓTESIS |
| Clasificación "COMPORTAMIENTO" de 69 archivos | Por heurística, no leídos uno por uno |

---

## (d) Top 10

Ordenado por riesgo sobre esfuerzo.

1. **H16. Las acciones de auditoría `sesion.ver` y `sesion.ver_transcripcion` están escritas a mano en las rutas y la constante no tiene lector.** De eso dependen el aviso de "nota vista" y una frase del consentimiento firmado. S.
2. **H10. Un solo criterio para el mensaje de error** (`mensajeParaElla` en `api-client`): hoy 22 sitios pueden mostrarle "Failed to fetch" o "HTTP 500". S.
3. **H12. Los nombres clínicos, incluida la señal de riesgo, están en 4 diccionarios**; `etiquetas.ts` tiene que ser la fuente única de verdad. S.
4. **H1. Cablear `RECORDATORIO_ESTADO`, `SENALES_ANTERIORES` y `CARGANDO`**, que tienen copias a mano en la hoja del turno, Hilo* y 9 pantallas; y borrar `SOAP_SECCIONES`. S.
5. **H11. 12 `fetch` crudos**: HotWordsManager (5, con `throw new Error()` vacío), el polling (1) y la subida (6). Primero los dos primeros; la subida después. S, luego M.
6. **T1 + T2 + T3. Sacar ~110 aserciones cosméticas**: 35 constantes comparadas consigo mismas y ~72 lecturas del código como texto, reemplazadas por constantes o por los tests de comportamiento que ya existen. S-M.
7. **H17. El tope de 20 reintentos está escrito dos veces**, con tres tests que tapan la copia. S.
8. **H2 + H3. Texto y lógica fuera de lugar**: `horaCorta` sin zona de Montevideo, `layout/textos.ts`, `guardado-campo`, `deudas.textoAtraso` ("hace 95 días") y los rótulos a mano en HotWordsManager, resultado-serie e Hilo*. S por archivo.
9. **H8 + H9. Código muerto visual**: las props de `Card`, `Contador`, `ListaEnCascada` sin cascada, los estados vacíos de Lupita más su contador, las props sin uso y los 6 tokens CSS. S (Lupita M).
10. **H5 + H6 + H19 + H7. Barrido de exports**: 9 sin uso, `formatPhoneDisplay`, el re-export deprecado y 134 `export` que sobran. S mecánico.

Fuera del top, en orden: T4 (el guardián de R2 puede dar verde en falso, M), H13 (`useToast`), H14 (`useEsEscritorio`, `mesIsoMvd`, `salir()`), H18 (barriles) y H4 (partir el glosario, solo si molesta).

---

## (e) Cruce con `~/forense-sesion/01-app.md` (24-sep, commit 7f016ec)

Ese es el informe que corresponde: cubría `src/**`, glosario, reglas duplicadas y tests. Los ítems que tocan esta zona, contrastados con 8f2047b:

| ítem del 24-sep | estado hoy | dónde |
|---|---|---|
| §1.2 `crypto.ts`: cifrado de audio muerto | **RESUELTO**: solo queda `sha256Hex` y el comentario da el motivo real | `src/lib/crypto.ts` |
| §1.2 `NotaClinicaView.tsx`, `SesionHuerfanaBanner.tsx` | **RESUELTO** (borrados) | — |
| §1.1 `estadoPagoSchema`, `REFERENCIAS_CALLBACK`, `NotaSOAP`, `IntervencionTerapeuta` | **RESUELTO** | — |
| §1.1 `ACCION_VER_SESION` sin lector | **SIGUE VIVO**, y ahora se ve el riesgo (H16) | `consentimiento-hechos.ts:168` |
| §1.3 barril de esqueletos con internos | **RESUELTO** | `esqueletos/index.ts` |
| §1.3 re-export de `normalizar` en domain | **SIGUE VIVO** (1 consumidor) → H19 | `types/domain.ts:558` |
| §1.4 exports solo internos (245) | **SIGUE VIVO**: 134 en esta zona → H7 | — |
| §2 `RECORDATORIO_ESTADO` con copia literal | **SIGUE VIVO** → H1 | `turno-detail-sheet.tsx:395` |
| §2 `horaCorta` sin zona | **SIGUE VIVO** → H2 | `glosario.ts:371` |
| §2 `METODOS_PAGO` con el mismo nombre en el glosario y en constantes | **SIGUE VIVO** (`glosario.ts:495` y `constantes-turno.ts`); hoy lo cubre el test de paridad | — |
| §2 reglas de cobrar y grabar en la fila | **RESUELTO**: `accionesDe` usa `sePuedeCobrar` y `sePuedeGrabar` de `domain.ts` | `session-row.tsx:150-156` |
| §2 `ESTADOS_ACTIVOS` a mano en el polling | **RESUELTO** (usa `ESTADOS_EN_PIPELINE`) | `useSesionClinicaPolling.ts:5` |
| §2 estado fantasma "transcribiendo" | **SIGUE VIVO**, ahora documentado como alias legado → H20 | `session-row.tsx:85` |
| §3 comentarios de "middleware" y "edge" en lib/ | **RESUELTO** (grep vacío en csp, anthropic, firma, correo, alertas y crypto) | — |
| §3 "audio cifrado" en `csp.ts` | **RESUELTO** en `csp.ts`; **SIGUE VIVO** en `r2.ts:90` → H20 | — |
| §3 `useGrabacionSesion` IV/clave | **RESUELTO** | — |
| §3 `ConsentimientoBadge` "pestaña Ficha" y `domain.ts:53` "enviar-recordatorios" | **RESUELTO** | — |
| §3 `APROBAR_MENSAJE` falso ("se destruye la clave") | **RESUELTO** (`glosario.ts:546-547` dice la verdad) | — |
| §4.1 26 constantes muertas del glosario | **Casi resuelto**: quedan 4 (H1). `SESION_FALLO_LABEL` ya está cableado (`sesion-detail-view.tsx:149`) | — |
| §4.2 textos a mano con constante (zona: `HiloContenido`, `HiloEditor`, `brief-corto`, `guardado-campo`, `resultado-serie`, `HotWordsManager`) | **SIGUE VIVO** en los 6 → H1 y H3 | — |
| §5.2 `glosario.test.ts` `CONSTANTES_REQUERIDAS` y aserciones sobre el código fuente en consentimiento y ayuda | **SIGUE VIVO**, ahora medido: ~72 aserciones → T2 | — |
| §5.4 `consentimiento.test.ts` constante igual a su literal | **SIGUE VIVO y creció**: 35 → T1 | — |
| §6 `exigirEnvOperacion`, `crearMensaje`, `moneyShort`, `tokenDeCookieHeader`, `idClaveDe` | **RESUELTO** (borrados) | — |
| §6 `formatPhoneDisplay` | **SIGUE VIVO** (decisión pendiente) → H6 | `phone.ts:25` |
| §6 `esHuerfana` sin llamador | **RESUELTO** (cableado en `mantenimiento.ts:36`) | — |
| §6 `ASR_BORRADO_MAX_INTENTOS` y `LIMPIEZA_AUDIO_MAX_INTENTOS` contra `politica` | **SIGUE VIVO** → H17 | — |
| §7 acciones muertas de `useGrabacionSesion` | **RESUELTO** (devuelve `{sesionClinica, loading}`) | — |
| §7 `hayRiesgo` copiado en los dos briefs | **SIGUE VIVO**: `brief-corto.tsx:74` exporta `hayRiesgo` y `brief-pre-sesion.tsx:133` recalcula su propia versión. No verifiqué si divergen (HIPÓTESIS) | — |
| §7 `NuevoTurnoForm` y `HotWordsManager` de más de 450 líneas | **SIGUE VIVO** (533 y 469 l. de función) | — |

No crucé `02-datos.md`, `03-infra.md` ni `04-worker.md`: sus ítems caen fuera de esta zona o en el panel 1.

---

## (f) Mapa de archivos por propuesta

| propuesta | archivos que toca |
|---|---|
| H16 acciones de auditoría | `src/lib/consentimiento-hechos.ts`, `src/app/api/sesion-clinica/[id]/route.ts`, `src/app/api/_lib/casos-uso/sesion/ver-transcripcion.ts`, `src/app/api/_lib/casos-uso/avisos-notas.ts`, `src/lib/__tests__/consentimiento.test.ts` |
| H10 `mensajeParaElla` | `src/lib/api-client.ts` (+ test), los 22 sitios con `instanceof Error ? …message` (en la zona: `ConsentimientoForm.tsx`, `HiloView.tsx`, `useSesionClinicaPolling.ts`, `useGrabacionSesion.ts`) |
| H11 fetch crudos | `src/components/grabacion/HotWordsManager.tsx`, `src/hooks/useSesionClinicaPolling.ts`, `src/hooks/useGrabacionSesion.ts` (opcional: `src/lib/grabacion-subida.ts` nuevo) |
| H12 nombres clínicos | `src/lib/etiquetas.ts`, `src/components/grabacion/RiesgoDetectadoBanner.tsx`, `(d)/sesiones/[id]/_components/mas-de-esta-sesion.tsx`, `(d)/pacientes/[id]/_components/graficos/base.tsx` |
| H1 glosario muerto y copias | `src/lib/glosario.ts`, `(d)/agenda/_components/turno-detail-sheet.tsx`, `src/components/clinico/HiloEditor.tsx`, `HiloContenido.tsx`, `brief-corto.tsx` + las 8 pantallas con "Cargando…", `src/lib/__tests__/glosario.test.ts`, `textos-integrados.test.ts` |
| H2 `horaCorta` | `src/lib/glosario.ts` |
| H3 textos fuera del glosario | `src/components/layout/textos.ts`, `avisos-de-notas.tsx`, `globito-hoy.tsx`, `src/components/ui/guardado-campo.tsx`, `src/components/forms/nuevo-turno-form.tsx`, `resultado-serie.tsx`, `src/lib/agendar-turno.ts`, `src/lib/deudas.ts`, `src/components/grabacion/HotWordsManager.tsx`, `src/components/clinico/HiloView.tsx`, `src/lib/glosario.ts` |
| H4 partir el glosario | `src/lib/glosario.ts` → `src/lib/glosario/*.ts`, `src/lib/__tests__/ayuda-vigente.test.ts`, `ayuda-corpus-codigo.test.ts`, `proxy-liviano.test.ts`, `docs/ayuda/{00,02,04,09,12}*.md`, `docs/diseno/04-personaje.md` |
| H5 exports sin uso | `src/lib/consentimiento-hechos.ts`, `src/lib/constantes-turno.ts`, `src/types/domain.ts`, `src/lib/__tests__/consentimiento.test.ts` |
| H6 test-only | `src/lib/phone.ts`, `src/lib/__tests__/phone.test.ts` |
| H7 sacar `export` | `src/lib/prisma-encryption.ts`, `src/components/ui/movimiento.tsx`, `src/lib/sesion-acceso.ts`, `src/lib/sms/*.ts`, `src/lib/intentos-acceso.ts`, `src/app/_marca.tsx` y el resto de la lista del script |
| H8 variantes muertas | `src/components/ui/card.tsx`, `movimiento.tsx`, `lupita.tsx`, `toast.tsx`, `session-row.tsx`, `sheet.tsx`, `src/components/ayuda/panel-ayuda.tsx`, `src/components/ui/__tests__/lupita.test.tsx`, `panel-ayuda-movimiento.test.tsx`, `limites-movimiento.test.tsx` |
| H9 CSS | `src/app/globals.css` |
| H13 `useToast` | `src/components/ui/toast.tsx` + 9 pantallas (`grabar-view`, `cobros-view`, `turnos-pagos-tab`, `paciente-detail-view`, `ficha-tab`, `pacientes-view`, `dashboard`, `agenda-view`, `sesion-detail-view`) |
| H14 menores | `src/hooks/useEsEscritorio.ts` (nuevo), `ui/sheet.tsx`, `layout/sidebar.tsx`, `agenda-view.tsx`; `src/lib/format.ts`; `src/lib/fechas-montevideo.ts` + los 5 sitios de "AAAA-MM"; `src/lib/sesion-cliente.ts` y sus 2 consumidores; `panel-ayuda.tsx`; `src/lib/cuenta-tokens.ts`, `crypto.ts` |
| H17 tope de reintentos | `src/lib/consentimiento-hechos.ts`, `src/app/api/_lib/trabajos/` (política), `consentimiento.test.ts`, `ayuda-vigente.test.ts` |
| H18 barriles | `src/components/forms/index.ts`, `sheet-nuevo-turno.tsx` (y, si se decide, `src/components/ui/index.ts` + 64 importadores) |
| H19 re-export deprecado | `src/types/domain.ts`, `src/components/grabacion/RiesgoDetectadoBanner.tsx` |
| H20 comentarios | `src/lib/r2.ts`, `src/components/ui/session-row.tsx` |
| `enviarSmsTwilio` timeout | `src/lib/sms/twilio.ts`, `src/lib/__tests__/twilio.test.ts` |
| T1-T3, T5, T6 tests cosméticos | `src/lib/__tests__/consentimiento.test.ts`, `ayuda-vigente.test.ts`, `ayuda-corpus-codigo.test.ts`, `limites-prueba-integracion.test.ts`, `glosario.test.ts`, `phone.test.ts`, `textos-integrados.test.ts` |
| T4 guardián de R2 | `src/lib/__tests__/rutas-area2.test.ts` (reusar el caminante de `proxy-liviano.test.ts`) |

---

## Anexo: cómo reproducir

Los scripts quedaron en el scratchpad de la sesión y no están en el repo:
- `grafo.cjs <repo> <salida.json>` arma el grafo.
- `analisis.cjs` genera el inventario y los exports sin consumidor.
- `glosario.cjs` mide exports y claves, siguiendo barriles.
- `funciones.cjs` mide largo y complejidad.

Los tres se basan en `node_modules/typescript` del repo y no escriben nada dentro de él.
