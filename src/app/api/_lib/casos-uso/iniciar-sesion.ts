// Caso de uso: entrar. Orquesta el intento serializado (intentos-acceso),
// la verificación de la contraseña con hash señuelo, la creación de la
// sesión en la misma transacción y el evento cuenta.entrada. Sin Request.

import {
  claveUsuario,
  procesarIntentoLogin,
  type Huella,
  type ResultadoLogin,
} from "@/lib/intentos-acceso";
import { tomarLocks } from "@/lib/intentos-serializados";
import { BCRYPT_RONDAS } from "@/lib/password";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { crearSesion } from "@/lib/sesion-acceso";

import { detalleSeguro } from "../auditoria-pura";

export const ACCION_ENTRADA = "cuenta.entrada";

export interface SesionIniciada {
  token: string;
  sesionId: string;
  userId: string;
  organizationId: string;
}

export interface IniciarSesionParams {
  prisma: ClienteCifrado;
  email: string;
  password: string;
  huella: Huella;
  ahora?: Date;
  comparar: (password: string, hash: string) => Promise<boolean>;
  hashear: (password: string, rondas: number) => Promise<string>;
}

/**
 * Hash señuelo contra el que comparar cuando el email no existe, para que un
 * email desconocido tarde lo mismo que uno real. No es un secreto y se
 * calcula una sola vez por instancia, recién cuando hace falta.
 */
let senueloPendiente: Promise<string> | null = null;
function hashSenuelo(hashear: IniciarSesionParams["hashear"]): Promise<string> {
  senueloPendiente ??= hashear("señuelo-de-tiempo-constante", BCRYPT_RONDAS);
  return senueloPendiente;
}

export async function iniciarSesion({
  prisma,
  email,
  password,
  huella,
  ahora = new Date(),
  comparar,
  hashear,
}: IniciarSesionParams): Promise<ResultadoLogin<SesionIniciada>> {
  const emailNormalizado = email.trim().toLowerCase();
  if (!emailNormalizado || !password) return { estado: "rechazado" };

  const resultado = await procesarIntentoLogin<SesionIniciada>({
    prisma,
    intento: { email: emailNormalizado, huella, ahora },
    verificar: async (tx) => {
      const user = await tx.user.findUnique({
        where: { email: emailNormalizado },
        select: { id: true, organizationId: true },
      });
      // Lock por usuaria, tomado DESPUÉS de los de email e IP (siempre en ese
      // orden; el cambio y el restablecimiento de contraseña toman usuario y
      // recuperar, nunca email ni IP: no hay ciclo). Con el lock tomado se
      // lee el hash: si un cambio de contraseña se commiteó mientras
      // esperábamos, acá ya se ve (READ COMMITTED) y la contraseña vieja no
      // entra; si el cambio espera detrás nuestro, su cerrarTodas cierra la
      // sesión que creamos acá. Sin esto, un login en vuelo con la contraseña
      // comprometida sobrevivía al cambio.
      let hash: string | null = null;
      if (user) {
        await tomarLocks(tx, [claveUsuario(user.id)]);
        const fila = await tx.user.findUnique({ where: { id: user.id }, select: { hashedPassword: true } });
        hash = fila?.hashedPassword ?? null;
      }
      // El compare se hace exista o no la usuaria: un `return` temprano
      // contestaría en un milisegundo y el reloj diría qué emails existen.
      const contra = hash ?? (await hashSenuelo(hashear));
      const passwordOk = await comparar(password, contra);
      if (!user || hash === null || !passwordOk) {
        return { ok: false, motivo: user ? "password" : "email" };
      }
      const sesion = await crearSesion(tx, { userId: user.id, ip: huella.ip, userAgent: huella.userAgent, ahora });
      return {
        ok: true,
        resultado: { token: sesion.token, sesionId: sesion.id, userId: user.id, organizationId: user.organizationId },
      };
    },
  });

  if (resultado.estado !== "ok") return resultado;

  // Fuera de la transacción a propósito: no es parte del contador y un fallo
  // acá no puede dejar afuera a quien puso bien la contraseña. Sin IP ni
  // user-agent: eso vive en sesiones_acceso.
  try {
    await prisma.eventoAuditoria.create({
      data: {
        organizationId: resultado.resultado.organizationId,
        actorTipo: "usuario",
        actorId: resultado.resultado.userId,
        accion: ACCION_ENTRADA,
        entidad: "usuario",
        entidadId: resultado.resultado.userId,
        detalle: detalleSeguro({ sesionId: resultado.resultado.sesionId }),
      },
    });
  } catch (error) {
    console.error("[cuenta] no se pudo registrar la entrada", error);
  }

  return resultado;
}
