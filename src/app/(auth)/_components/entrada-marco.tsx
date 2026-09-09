import Link from "next/link";
import { Card } from "@/components/ui";
import { ENTRADA_VOLVER } from "@/lib/glosario";
import { Presencia } from "../login/_components/presencia";

export function EntradaMarco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-cream-50">
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-6 py-12 lg:max-w-[1020px] lg:flex-row lg:items-center lg:justify-center lg:gap-20 lg:px-12">
      <Presencia />
      <div className="mt-10 w-full lg:mt-0 lg:w-[380px] lg:shrink-0">
        <Card className="p-7 shadow-subtle">
          <h2 className="mb-5 font-display text-xl text-ink-900">{titulo}</h2>
          {children}
          <Link href="/login" className="mt-5 block text-sm text-sage-600 underline">{ENTRADA_VOLVER}</Link>
        </Card>
      </div>
    </div>
  </main>;
}
