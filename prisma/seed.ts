// Datos de prueba mínimos y reproducibles: una organización, una profesional,
// tres pacientes, turnos (pasados cobrados, futuros, una serie semanal) y dos
// envíos de SMS programados. Sin contenido clínico: ninguna columna cifrada se
// escribe (el cifrado lo hace la extensión de src/lib, que este archivo no
// importa a propósito; el seed tiene que correr con el cliente de Prisma pelado).
//
// Cómo correrlo (contra la base de DATABASE_URL):
//   node prisma/seed.ts            (Node ≥ 22.18 quita los tipos solo)
//   npx tsx prisma/seed.ts         (alternativa)
// Es idempotente: usa ids fijos y upsert; se puede correr las veces que haga falta.
//
// Contraseña de la profesional: "sesion-dev-1234".

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// Ids fijos (uuid v4 válidos) para que el seed sea reproducible.
const ID = {
  org: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  config: "33333333-3333-4333-8333-333333333333",
  pacientes: [
    "aaaaaaaa-0001-4000-8000-000000000001",
    "aaaaaaaa-0002-4000-8000-000000000002",
    "aaaaaaaa-0003-4000-8000-000000000003",
  ],
  serie: "bbbbbbbb-0001-4000-8000-000000000001",
} as const;

const PASSWORD = "sesion-dev-1234";

/** Fecha en Montevideo (UTC-3, sin horario de verano) a las HH:MM, desplazada N días desde hoy. */
function enMontevideo(diasDesdeHoy: number, hora: number, minuto = 0): Date {
  const hoy = new Date();
  // Día civil de Montevideo de "ahora".
  const mvd = new Date(hoy.getTime() - 3 * 60 * 60 * 1000);
  const anio = mvd.getUTCFullYear();
  const mes = mvd.getUTCMonth();
  const dia = mvd.getUTCDate() + diasDesdeHoy;
  // HH:MM de Montevideo = HH+3:MM UTC.
  return new Date(Date.UTC(anio, mes, dia, hora + 3, minuto));
}

function idTurno(n: number): string {
  return `cccccccc-${String(n).padStart(4, "0")}-4000-8000-000000000000`;
}

async function main() {
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  await db.organization.upsert({
    where: { id: ID.org },
    update: {},
    create: { id: ID.org, nombre: "Consultorio de prueba" },
  });

  await db.user.upsert({
    where: { id: ID.user },
    update: { hashedPassword },
    create: {
      id: ID.user,
      email: "profesional@sesion.test",
      hashedPassword,
      nombre: "Mariana Prueba",
      rol: "titular",
      organizationId: ID.org,
    },
  });

  await db.configuracion.upsert({
    where: { organizationId: ID.org },
    update: {},
    create: {
      id: ID.config,
      organizationId: ID.org,
      nombreProfesional: "Lic. Mariana Prueba",
      direccion: "Av. de prueba 1234, Montevideo",
      whatsappOrigen: "+59899000000",
      tarifaDefault: 2000,
      recordatorioModo: "dia_anterior",
      orientacionTeorica: "cbt_mi",
    },
  });

  const pacientes = [
    { id: ID.pacientes[0], nombre: "Alejandro", apellido: "Sosa", telefono: "+59899123456", tarifa: 2200 },
    { id: ID.pacientes[1], nombre: "Lucía", apellido: "Fernández", telefono: "+59899234567", tarifa: 2000 },
    { id: ID.pacientes[2], nombre: "Martín", apellido: "Rodríguez", telefono: "+59899345678", tarifa: 2500 },
  ];
  for (const p of pacientes) {
    await db.paciente.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, organizationId: ID.org, activo: true },
    });
  }

  // Turnos pasados: realizados y cobrados (dos) y uno pendiente de cobro.
  const pasados = [
    { n: 1, paciente: 0, dias: -14, hora: 10, pago: "pagado" as const, metodo: "transferencia" as const },
    { n: 2, paciente: 1, dias: -7, hora: 11, pago: "pagado" as const, metodo: "efectivo" as const },
    { n: 3, paciente: 2, dias: -3, hora: 15, pago: "pendiente" as const, metodo: null },
  ];
  for (const t of pasados) {
    const fecha = enMontevideo(t.dias, t.hora);
    const p = pacientes[t.paciente];
    await db.turno.upsert({
      where: { id: idTurno(t.n) },
      update: {},
      create: {
        id: idTurno(t.n),
        organizationId: ID.org,
        pacienteId: p.id,
        fecha,
        duracion: 50,
        modalidad: "presencial",
        estado: "realizado",
        tarifaCobrada: p.tarifa,
        pagoEstado: t.pago,
        pagoMetodo: t.metodo,
        pagoFecha: t.pago === "pagado" ? fecha : null,
      },
    });
  }

  // Un turno futuro suelto (online) para Lucía, mañana a las 9.
  await db.turno.upsert({
    where: { id: idTurno(10) },
    update: {},
    create: {
      id: idTurno(10),
      organizationId: ID.org,
      pacienteId: pacientes[1].id,
      fecha: enMontevideo(1, 9),
      duracion: 45,
      modalidad: "online",
      estado: "programado",
      tarifaCobrada: pacientes[1].tarifa,
    },
  });

  // Serie semanal para Alejandro: cuatro ocurrencias desde la semana que viene.
  const ancla = enMontevideo(7, 10);
  await db.serieTurno.upsert({
    where: { id: ID.serie },
    update: {},
    create: {
      id: ID.serie,
      organizationId: ID.org,
      pacienteId: pacientes[0].id,
      frecuencia: "semanal",
      horaAncla: ancla,
    },
  });
  for (let i = 0; i < 4; i++) {
    await db.turno.upsert({
      where: { id: idTurno(20 + i) },
      update: {},
      create: {
        id: idTurno(20 + i),
        organizationId: ID.org,
        pacienteId: pacientes[0].id,
        serieId: ID.serie,
        fecha: enMontevideo(7 + 7 * i, 10),
        duracion: 50,
        modalidad: "presencial",
        estado: "programado",
        tarifaCobrada: pacientes[0].tarifa,
      },
    });
  }

  // Recordatorios programados para el turno de mañana y el primero de la serie.
  for (const turnoId of [idTurno(10), idTurno(20)]) {
    const turno = await db.turno.findUniqueOrThrow({ where: { id: turnoId } });
    const programadoEn = new Date(turno.fecha.getTime() - 24 * 60 * 60 * 1000);
    await db.envioSms.upsert({
      where: { claveIdempotencia: `turno:${turnoId}:${turno.fecha.toISOString()}` },
      update: {},
      create: {
        organizationId: ID.org,
        claveIdempotencia: `turno:${turnoId}:${turno.fecha.toISOString()}`,
        motivo: "recordatorio_turno",
        estado: "pendiente",
        pacienteId: turno.pacienteId,
        turnoId,
        destino: pacientes.find((p) => p.id === turno.pacienteId)!.telefono,
        programadoEn,
        proximoIntentoEn: programadoEn,
      },
    });
  }

  const resumen = {
    organizaciones: await db.organization.count(),
    usuarios: await db.user.count(),
    pacientes: await db.paciente.count(),
    seriesTurno: await db.serieTurno.count(),
    turnos: await db.turno.count(),
    enviosSms: await db.envioSms.count(),
  };
  console.log("Seed listo:", resumen);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
