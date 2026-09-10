import { dbAuth } from "@/lib/db-auth";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { invitacionDisponible } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { RegistroForm } from "./registro-form";
export default async function RegistroPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const valor = typeof token === "string" ? token : "";
  const valida = Boolean(await invitacionDisponible(valor, repositorioRegistro(dbAuth)));
  return <RegistroForm token={valor} valida={valida} />;
}
