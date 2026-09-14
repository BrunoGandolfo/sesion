import { invitacionDisponible } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { repositorioRegistro } from "@/lib/cuenta-registro-db";
import { db } from "@/lib/db";
import { RegistroForm } from "./registro-form";
export default async function RegistroPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const valor = typeof token === "string" ? token : "";
  const valida = Boolean(await invitacionDisponible(valor, repositorioRegistro(db)));
  return <RegistroForm token={valor} valida={valida} />;
}
