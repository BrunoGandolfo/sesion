import { redirect } from "next/navigation";

// Finanzas y Deudores se unieron en /cobros. La ruta vieja queda solo para
// que el menú y los links guardados sigan llegando.
export default function FinanzasPage() {
  redirect("/cobros");
}
