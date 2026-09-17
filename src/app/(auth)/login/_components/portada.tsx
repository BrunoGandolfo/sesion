import type { ReactNode } from "react";

import { Marca, medidasPara } from "@/app/_marca";
import {
  ENTRADA_CONFIDENCIALIDAD,
  ENTRADA_QUE_HACE,
  ENTRAR,
  ESLOGAN,
  NOMBRE_PRODUCTO,
  PORTADA_ACCESO,
  PORTADA_CIFRADO,
  PORTADA_FUNCIONES,
  PORTADA_FUNCIONES_TITULO,
  PORTADA_LUPITA,
  PORTADA_LUPITA_CUIDADO,
  PORTADA_LUPITA_TITULO,
  PORTADA_PIE,
} from "@/lib/glosario";

// Solo presentación. El formulario llega intacto desde la página de entrada.
export function Portada({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-cream-50">
      <div className="mx-auto max-w-6xl px-6 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] py-5 lg:py-8">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="shrink-0">
              <Marca lado={44} medidas={medidasPara(44)} />
            </span>
            <span className="font-display text-3xl font-medium text-ink-900">{NOMBRE_PRODUCTO}</span>
          </div>
          <a href="#ingresar" className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-sage-600 underline decoration-sage-200 underline-offset-4 hover:decoration-sage-600">
            {ENTRAR}
          </a>
        </header>

        <div className="grid gap-7 py-7 sm:gap-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center lg:gap-20 lg:py-16">
          <div>
            <h1 className="max-w-[14ch] text-balance font-display text-4xl font-medium leading-[1.12] tracking-tight text-ink-900 lg:text-6xl">
              {ESLOGAN}
            </h1>
            <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-ink-700 lg:mt-6 lg:text-lg">
              {ENTRADA_QUE_HACE}
            </p>
          </div>
          <section id="ingresar" aria-labelledby="titulo-ingresar" className="min-w-0 scroll-mt-6">
            <h2 id="titulo-ingresar" tabIndex={-1} className="mb-4 font-display text-2xl font-medium text-ink-900">
              {PORTADA_ACCESO}
            </h2>
            {children}
          </section>
        </div>

        <section aria-labelledby="titulo-funciones" className="border-t border-[color:var(--border-subtle)] py-10 lg:py-14">
          <h2 id="titulo-funciones" className="mb-8 font-display text-3xl font-medium text-ink-900 lg:mb-10 lg:text-4xl">
            {PORTADA_FUNCIONES_TITULO}
          </h2>
          <div className="grid gap-x-16 gap-y-9 md:grid-cols-2 lg:gap-y-12">
            {PORTADA_FUNCIONES.map(({ titulo, parrafos }, i) => (
              <article key={titulo} className="border-t border-[color:var(--border-subtle)] pt-5">
                <p aria-hidden="true" className="mb-3 text-xs font-semibold tracking-widest text-sage-600">0{i + 1}</p>
                <h3 className="font-display text-2xl font-medium leading-tight text-ink-900">{titulo}</h3>
                {parrafos.map((parrafo) => (
                  <p key={parrafo} className="mt-3 text-sm leading-7 text-ink-700">{parrafo}</p>
                ))}
              </article>
            ))}
          </div>
        </section>

        <div className="grid gap-8 rounded-xl border border-sage-100 bg-sage-50 p-6 md:grid-cols-2 lg:gap-16 lg:p-9">
          <section aria-labelledby="titulo-cifrado">
            <h2 id="titulo-cifrado" className="font-display text-2xl font-medium text-sage-800">{PORTADA_CIFRADO}</h2>
            <p className="mt-3 text-sm leading-7 text-ink-700">{ENTRADA_CONFIDENCIALIDAD}</p>
          </section>
          <section aria-labelledby="titulo-lupita">
            <h2 id="titulo-lupita" className="font-display text-2xl font-medium text-sage-800">{PORTADA_LUPITA_TITULO}</h2>
            <p className="mt-3 text-sm leading-7 text-ink-700">{PORTADA_LUPITA}</p>
            <p className="mt-3 text-sm leading-7 text-ink-700">{PORTADA_LUPITA_CUIDADO}</p>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 py-8 text-xs text-ink-500 lg:py-10">
          <p>{PORTADA_PIE}</p>
          <a href="#ingresar" className="inline-flex min-h-11 items-center rounded-sm text-sm text-sage-600 underline underline-offset-4">{ENTRAR}</a>
        </footer>
      </div>
    </main>
  );
}
