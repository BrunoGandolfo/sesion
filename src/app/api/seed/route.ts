import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

import { requireBearer } from "../_lib/auth";
import { addDays, startOfDay } from "../_lib/domain";
import { errorResponse } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORGANIZATION_NAME = "Consultorio Mariana Roldán";
const MARIANA_EMAIL = "mariana@consultorio.uy";
const DEFAULT_TEMPLATE =
  "Hola {{nombre}}, te recuerdo tu sesión del {{fecha}} a las {{hora}}. Nos vemos en {{direccion}}. Mariana.";

type PacienteSeed = {
  nombre: string;
  apellido: string;
  telefono: string;
  tarifa: number;
  notas?: string;
};

const PACIENTES: PacienteSeed[] = [
  { nombre: "Alejandro", apellido: "Sosa", telefono: "+598 99 123 456", tarifa: 2200, notas: "Ansiedad social. Exposición gradual." },
  { nombre: "Lucía", apellido: "Fernández", telefono: "+598 99 234 567", tarifa: 2000 },
  { nombre: "Martín", apellido: "Rodríguez", telefono: "+598 99 345 678", tarifa: 2500 },
  { nombre: "Sofía", apellido: "Gutiérrez", telefono: "+598 99 456 789", tarifa: 2000 },
  { nombre: "Diego", apellido: "Martínez", telefono: "+598 99 567 890", tarifa: 1800 },
  { nombre: "Ana", apellido: "Rodríguez", telefono: "+598 98 111 222", tarifa: 2200 },
  { nombre: "Federico", apellido: "Pérez", telefono: "+598 98 222 333", tarifa: 2400 },
  { nombre: "Camila", apellido: "Silva", telefono: "+598 98 333 444", tarifa: 1900 },
  { nombre: "Gonzalo", apellido: "Méndez", telefono: "+598 98 444 555", tarifa: 2300 },
  { nombre: "Valentina", apellido: "Castro", telefono: "+598 98 555 666", tarifa: 2100 },
  { nombre: "Nicolás", apellido: "Barrios", telefono: "+598 97 111 222", tarifa: 1800 },
  { nombre: "Carolina", apellido: "Píriz", telefono: "+598 97 222 333", tarifa: 2500 },
  { nombre: "Rodrigo", apellido: "Acosta", telefono: "+598 97 333 444", tarifa: 2200 },
  { nombre: "Florencia", apellido: "Benítez", telefono: "+598 97 444 555", tarifa: 2000 },
  { nombre: "Javier", apellido: "Correa", telefono: "+598 97 555 666", tarifa: 1900 },
  { nombre: "Paula", apellido: "Larrañaga", telefono: "+598 96 111 222", tarifa: 2400 },
  { nombre: "Sebastián", apellido: "Viera", telefono: "+598 96 222 333", tarifa: 2100 },
  { nombre: "Mercedes", apellido: "Etcheverry", telefono: "+598 96 333 444", tarifa: 2300 },
];

const HORARIOS = [
  [9, 0],
  [10, 30],
  [12, 0],
  [15, 0],
  [17, 30],
] as const;

function emailFrom(nombre: string, apellido: string) {
  const strip = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ñ/g, "n");

  return `${strip(nombre)}.${strip(apellido)}@gmail.com`;
}

function withTime(date: Date, hours: number, minutes: number) {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function weekdayDates(start: Date, count: number, fromOffset: number) {
  const dates: Date[] = [];
  let cursor = addDays(start, fromOffset);

  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(new Date(cursor));
    }
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "No encontrado" }, { status: 404 });
  }

  const denegado = requireBearer(request, process.env.SEED_SECRET);
  if (denegado) return denegado;

  try {
    const seedUserPassword = process.env.SEED_USER_PASSWORD;

    if (!seedUserPassword) {
      return Response.json(
        { error: "SEED_USER_PASSWORD no configurada" },
        { status: 500 },
      );
    }

    const hashedPassword = await bcrypt.hash(seedUserPassword, 10);
    const now = new Date();
    const today = startOfDay(now);

    const result = await db.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: MARIANA_EMAIL },
        select: { organizationId: true },
      });
      const existingOrganization = existingUser
        ? null
        : await tx.organization.findFirst({
            where: { nombre: ORGANIZATION_NAME },
            select: { id: true },
          });

      const organization = existingUser
        ? await tx.organization.update({
            where: { id: existingUser.organizationId },
            data: { nombre: ORGANIZATION_NAME },
          })
        : existingOrganization
          ? await tx.organization.update({
              where: { id: existingOrganization.id },
              data: { nombre: ORGANIZATION_NAME },
            })
        : await tx.organization.create({
            data: { nombre: ORGANIZATION_NAME },
          });

      await tx.recordatorio.deleteMany({
        where: { turno: { organizationId: organization.id } },
      });
      await tx.turno.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.paciente.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.configuracion.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.user.deleteMany({
        where: { organizationId: organization.id },
      });

      const user = await tx.user.create({
        data: {
          email: MARIANA_EMAIL,
          hashedPassword,
          nombre: "Mariana Roldán",
          organizationId: organization.id,
        },
      });

      const configuracion = await tx.configuracion.create({
        data: {
          organizationId: organization.id,
          nombreProfesional: "Mariana Roldán",
          direccion: "Rivera 2540, Montevideo",
          whatsappOrigen: "+598 99 876 543",
          tarifaDefault: 2200,
          horasAnticipacion: 24,
          templateRecordatorio: DEFAULT_TEMPLATE,
        },
      });

      const pacientes = await Promise.all(
        PACIENTES.map((paciente, index) =>
          tx.paciente.create({
            data: {
              organizationId: organization.id,
              nombre: paciente.nombre,
              apellido: paciente.apellido,
              telefono: paciente.telefono,
              email: emailFrom(paciente.nombre, paciente.apellido),
              tarifa: paciente.tarifa,
              notas: paciente.notas ?? null,
              creadoEn: addDays(today, -520 + index * 19),
            },
          }),
        ),
      );

      const fechasPasadas = weekdayDates(today, 30, -42);
      const fechasFuturas = weekdayDates(today, 10, 0);
      const fechas = [...fechasPasadas, ...fechasFuturas];

      for (const [index, baseDate] of fechas.entries()) {
        const paciente = pacientes[index % pacientes.length];
        const [hours, minutes] = HORARIOS[index % HORARIOS.length];
        const fecha = withTime(baseDate, hours, minutes);
        const esFuturo = fecha.getTime() >= now.getTime();
        const pagado = !esFuturo && index % 4 !== 0;

        const turno = await tx.turno.create({
          data: {
            organizationId: organization.id,
            pacienteId: paciente.id,
            fecha,
            duracion: 50,
            modalidad: index % 5 === 0 ? "online" : "presencial",
            estado: esFuturo ? "programado" : "realizado",
            tarifaCobrada: paciente.tarifa,
            pagoEstado: pagado ? "pagado" : "pendiente",
            pagoFecha: pagado ? addDays(fecha, 1) : null,
            pagoMetodo: pagado ? "transferencia" : null,
            notas: null,
          },
        });

        if (esFuturo) {
          await tx.recordatorio.create({
            data: {
              turnoId: turno.id,
              estado: "pendiente",
              programadoEn: new Date(
                fecha.getTime() -
                  configuracion.horasAnticipacion * 60 * 60 * 1000,
              ),
            },
          });
        }
      }

      return {
        organizationId: organization.id,
        userId: user.id,
      };
    });

    return Response.json(
      {
        message: "Seed completado",
        organizationId: result.organizationId,
        userId: result.userId,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
