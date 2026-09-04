import { redirect } from "next/navigation";

// Deudores ya no es una pantalla: "Te deben" vive en /cobros.
export default function DeudoresPage() {
  redirect("/cobros");
}
