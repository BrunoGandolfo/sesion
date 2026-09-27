import { FinanzasView } from "./_components/finanzas-view";

// Dinámica como el resto del dashboard: sin request no hay nonce para la CSP.
export const dynamic = "force-dynamic";

export default function FinanzasPage() {
  return <FinanzasView />;
}
