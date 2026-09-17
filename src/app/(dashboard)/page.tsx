import { buscarActor } from "@/app/api/_lib/auth";
import { leerEstadoPrueba } from "@/app/api/_lib/casos-uso/estado-prueba";
import { AvisoPrueba } from "@/components/layout/aviso-prueba";
import { db } from "@/lib/db";

import { Dashboard } from "./_components/dashboard";

export default async function DashboardPage() {
  // El layout ya redirige sin sesión; acá sólo hace falta el consultorio.
  const actor = await buscarActor();
  const prueba = actor ? await leerEstadoPrueba({ prisma: db, organizationId: actor.organizationId }) : null;
  return (
    <>
      {prueba && (
        <div className="mx-auto w-full max-w-[1200px] px-5 pt-5 lg:px-14 lg:pt-14">
          <AvisoPrueba prueba={prueba} />
        </div>
      )}
      <Dashboard />
    </>
  );
}
