# Entrar y tu cuenta

**Para qué sirve.** Cómo se entra a Sesión, qué pasa si te equivocás varias
veces con la contraseña y cómo cambiarla.

## Crear tu cuenta con una invitación

Necesitás un enlace de una colega que ya use Sesión. Completá nombre, email,
contraseña dos veces y aceptá los términos y la política de privacidad.
Al tocar **Crear mi cuenta**, se abre tu propio consultorio y entrás a **Hoy**.
Los datos de quien te invitó permanecen separados. Si el enlace venció o ya
se usó, pedile otro. Más detalles en `11-tu-consultorio.md`.

## Entrar

1. Abrí la app. Vas a ver el título **Sesión** y abajo *Tu consulta, organizada.*
2. Escribí tu **Email** y tu **Contraseña**.
3. Tocá **Entrar** (mientras carga dice *Entrando…*).

Si algo no coincide, aparece un solo mensaje: **"Email o contraseña
incorrectos"**, y debajo: *"Después de varios intentos seguidos el acceso queda
bloqueado unos minutos."* Ese mensaje es el mismo para los tres casos posibles
(contraseña equivocada, email que no existe, acceso bloqueado) a propósito.

La sesión abierta dura **30 días** sin que tengas que volver a entrar.

## Si el acceso queda bloqueado

- Se bloquea con **5 intentos fallidos dentro de 15 minutos**.
- El bloqueo dura **15 minutos** la primera vez, **30** la segunda, **60** la
  tercera y **4 horas** de ahí en adelante.
- El tiempo se cuenta **desde el último intento**: seguir probando alarga la
  espera, no la acorta.
- Cinco errores repartidos a lo largo del día no bloquean nada: tienen que caer
  juntos en esos 15 minutos.
- **Acertar la contraseña no borra el contador.** Si te equivocaste cinco veces
  hoy, esperás igual aunque después te acuerdes.
- No hay nada que tocar: se destraba solo cuando pasa el tiempo.

## Si olvidaste la contraseña

1. En la pantalla de entrada, tocá **¿Olvidaste tu contraseña?**.
2. Escribí tu email y tocá **Mandame un enlace**. Siempre aparece
   *Si ese correo existe, te mandamos un enlace*: no confirma si hay una cuenta.
3. Revisá tu correo y la carpeta de spam. El enlace vence en **una hora**,
   se usa una sola vez y pedir uno nuevo invalida el anterior.
4. Abrí el enlace, escribí una contraseña nueva dos veces y tocá **Cambiar contraseña**.
   Volvés a la entrada con el aviso *Contraseña cambiada*.

Se pueden pedir hasta **tres enlaces por hora** para una cuenta. Si no llega,
esperá antes de pedir otro y avisale a quien administra Sesión si el problema sigue.
La contraseña necesita al menos 10 caracteres, hasta 72 bytes (las letras con
tilde pueden ocupar más de uno), no puede ser sólo espacios ni igual a la anterior.
Los accesos ya abiertos y el bloqueo por intentos de login conservan su duración.

## Cambiar la contraseña

1. Andá a **Tu consultorio** (en la computadora, en el menú de la izquierda;
   en el teléfono, tocando tu nombre arriba en **Hoy** o en **Cobros**).
2. Bajá hasta **Cuenta** y tocá **Cambiar contraseña**.
3. Completá **Contraseña actual**, **Contraseña nueva** y **Repetila**.
4. Tocá **Cambiar contraseña** (mientras trabaja dice *Cambiando…*).

La contraseña nueva necesita **al menos 10 caracteres**, tiene que ser distinta
de la actual y no puede ser solo espacios. Al terminar aparece: *"Contraseña
cambiada. Seguís con la sesión abierta acá."*

## Cerrar sesión

En **Tu consultorio** → **Cuenta** → **Cerrar sesión**. En la computadora
también está al pie del menú lateral.

## Qué hace la app por detrás

La contraseña nunca se guarda tal cual: se guarda transformada, y al entrar se
compara esa transformación. El contador de intentos fallidos vive en el registro
de auditoría, no en la memoria del servidor, así que cuenta bien aunque los
intentos caigan en máquinas distintas. Para cambiar la contraseña se exige la
actual, y ese pedido también tiene límite de intentos: una sesión robada no sirve
para adivinarla a fuerza de probar.

## Lo que NO hace

- **No te dice cuál de los dos datos está mal**, ni si ese email existe.
- **No te cierra la sesión** cuando cambiás la contraseña, ni en este dispositivo
  ni en otros: los accesos ya abiertos siguen abiertos hasta que venzan.
- **No hay segundo factor** ni código por SMS para entrar.

<!-- fuentes:
src/app/(auth)/login/page.tsx
src/lib/login-intentos.ts
src/lib/auth.ts
src/lib/password.ts
src/app/api/cuenta/password/route.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/components/layout/sidebar.tsx
src/components/layout/cabecera-usuario.tsx
src/middleware.ts
-->
