import Link from "next/link";
import { TERMINOS_TITULO, TERMINOS_FECHA, TERMINOS_BORRADOR, TERMINOS_SECCIONES, ENTRADA_VOLVER } from "@/lib/glosario";
export default function TerminosPage() {
  return <main className="min-h-screen bg-cream-50 px-6 py-12 text-ink-900">
    <article className="mx-auto max-w-2xl space-y-6 rounded-lg bg-white p-7 shadow-subtle">
      <h1 className="font-display text-3xl">{TERMINOS_TITULO}</h1>
      <p>{TERMINOS_FECHA}</p>
      <p className="rounded border border-gold-500 bg-cream-100 p-4 font-semibold">{TERMINOS_BORRADOR}</p>
      {TERMINOS_SECCIONES.map(({ titulo, texto }) => <section key={titulo}><h2 className="mb-2 font-display text-xl">{titulo}</h2><p className="leading-relaxed text-ink-700">{texto}</p></section>)}
      <Link href="/login" className="block text-sage-600 underline">{ENTRADA_VOLVER}</Link>
    </article>
  </main>;
}
