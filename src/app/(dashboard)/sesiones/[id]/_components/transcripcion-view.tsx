"use client";

// "Transcripción": la tercera vista de la sesión.
//
// Misma cabecera y mismo selector que la nota y "Para vos". Abajo, lo que se
// dijo, en bloques con su marca de tiempo y su hablante, y un buscador.
//
// CUÁNDO SE PIDE
//
// Recién al abrir esta vista: el contenedor sólo la monta cuando se la eligió,
// así que entrar a la nota no pide nada. Cada lectura queda auditada en el
// servidor ("sesion.ver_transcripcion"), por eso se pide UNA vez por apertura:
// el pedido vive en un ref y un segundo pase del efecto (React lo hace en
// desarrollo) reusa la misma promesa en vez de leer de nuevo. Reintentar es
// lo único que vuelve a pedir.
//
// El texto vive sólo en el estado de este componente. No va a localStorage,
// sessionStorage ni a ningún caché: salir de la vista lo suelta.
//
// LO QUE NO HACE, A PROPÓSITO
//
// Sin audio, sin sincronización palabra a palabra, sin exportar, sin editar.
// Es lectura.

import * as React from "react";
import { AlertCircle, ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { Button } from "@/components/ui";
import { ApiClientError, apiGet } from "@/lib/api-client";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { CabeceraSesion } from "./cabecera-sesion";
import {
  ALGO_FALLO,
  BUSCAR_ANTERIOR,
  BUSCAR_BORRAR,
  BUSCAR_EN_TRANSCRIPCION,
  BUSCAR_MINIMO,
  BUSCAR_PLACEHOLDER,
  BUSCAR_SIGUIENTE,
  REINTENTAR,
  TRANSCRIPCION,
  TRANSCRIPCION_ABRIENDO,
  TRANSCRIPCION_ERROR_TITULO,
  TRANSCRIPCION_HABLANTES,
  TRANSCRIPCION_SIN_TEXTO,
  TRANSCRIPCION_SIN_TEXTO_TITULO,
  TRANSCRIPCION_SUBTITULO,
  busquedaSinResultados,
  resultadoDeBusqueda,
} from "./textos";
import {
  MINIMO_BUSQUEDA,
  buscarEnBloques,
  leerTranscripcion,
  type BloqueTranscripcion,
  type Coincidencia,
} from "./transcripcion";

type Lectura =
  | { estado: "abriendo" }
  | { estado: "lista"; bloques: BloqueTranscripcion[] }
  | { estado: "sin-texto" }
  | { estado: "error"; detalle: string };

type Respuesta = { transcripcion: string };

/** Así rotula el worker a la terapeuta (processor/transcripcion.py). Sólo se
 *  usa para darle otro color; el nombre que se muestra es el de la línea. */
const ROTULO_TERAPEUTA = "Terapeuta";

interface TranscripcionViewProps {
  sesion: SesionClinicaResponse;
  /** El selector de vista, armado por el contenedor. */
  selector?: React.ReactNode;
}

export function TranscripcionView({ sesion, selector }: TranscripcionViewProps) {
  const [lectura, setLectura] = React.useState<Lectura>({ estado: "abriendo" });
  const [intento, setIntento] = React.useState(0);
  const pedido = React.useRef<{ clave: string; promesa: Promise<Respuesta> } | null>(null);

  React.useEffect(() => {
    let vivo = true;
    const clave = `${sesion.id}:${intento}`;
    if (pedido.current?.clave !== clave) {
      pedido.current = {
        clave,
        promesa: apiGet<Respuesta>(`/api/sesion-clinica/${sesion.id}/transcripcion`),
      };
    }
    pedido.current.promesa.then(
      ({ transcripcion }) => {
        if (!vivo) return;
        const bloques = leerTranscripcion(transcripcion ?? "");
        // Un texto sin una sola línea no es una transcripción: no se dibuja
        // una lista vacía como si fuera el resultado.
        setLectura(bloques.length > 0 ? { estado: "lista", bloques } : { estado: "sin-texto" });
      },
      (error: unknown) => {
        if (!vivo) return;
        setLectura(
          error instanceof ApiClientError && error.status === 409
            ? { estado: "sin-texto" }
            : { estado: "error", detalle: error instanceof Error && error.message ? error.message : ALGO_FALLO },
        );
      },
    );
    return () => {
      vivo = false;
    };
  }, [sesion.id, intento]);

  const reintentar = () => {
    setLectura({ estado: "abriendo" });
    setIntento((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <CabeceraSesion sesion={sesion} rotulo={TRANSCRIPCION} />

      {selector}

      <div className="flex flex-col gap-1">
        <p className="font-sans text-[14px] leading-[1.6] text-ink-500">{TRANSCRIPCION_SUBTITULO}</p>
        <p className="font-sans text-[13px] leading-[1.55] text-ink-500">{TRANSCRIPCION_HABLANTES}</p>
      </div>

      {lectura.estado === "abriendo" ? (
        <p role="status" className="py-10 text-center font-sans text-[14px] text-ink-500">
          {TRANSCRIPCION_ABRIENDO}
        </p>
      ) : null}

      {lectura.estado === "sin-texto" ? (
        <section role="status" className="flex flex-col items-start gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-white px-5 py-6">
          <p className="font-display text-[18px] font-medium text-ink-900">{TRANSCRIPCION_SIN_TEXTO_TITULO}</p>
          <p className="font-sans text-[14px] leading-[1.6] text-ink-700">{TRANSCRIPCION_SIN_TEXTO}</p>
          <Button variant="secondary" onClick={reintentar}>{REINTENTAR}</Button>
        </section>
      ) : null}

      {lectura.estado === "error" ? (
        <section role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-terracotta-100 bg-terracotta-50 px-4 py-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} strokeWidth={1.9} aria-hidden="true" className="mt-[2px] shrink-0 text-terracotta-500" />
            <div className="flex flex-col gap-1">
              <p className="font-sans text-[15px] font-semibold text-ink-900">{TRANSCRIPCION_ERROR_TITULO}</p>
              <p className="font-sans text-[13px] leading-[1.55] text-ink-700">{lectura.detalle}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={reintentar}>{REINTENTAR}</Button>
        </section>
      ) : null}

      {lectura.estado === "lista" ? <Lector bloques={lectura.bloques} /> : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// El lector: buscador pegado arriba y los bloques debajo.
// ────────────────────────────────────────────────────────────────────────────

function Lector({ bloques }: { bloques: BloqueTranscripcion[] }) {
  const [consulta, setConsulta] = React.useState("");
  const [actual, setActual] = React.useState(0);
  const marcaActual = React.useRef<HTMLElement | null>(null);

  const coincidencias = React.useMemo(() => buscarEnBloques(bloques, consulta), [bloques, consulta]);
  const porBloque = React.useMemo(() => {
    const mapa = new Map<number, Array<Coincidencia & { orden: number }>>();
    coincidencias.forEach((c, orden) => {
      const lista = mapa.get(c.bloque) ?? [];
      lista.push({ ...c, orden });
      mapa.set(c.bloque, lista);
    });
    return mapa;
  }, [coincidencias]);

  const total = coincidencias.length;
  const escrita = consulta.trim();
  const corta = escrita.length > 0 && escrita.length < MINIMO_BUSQUEDA;
  const sinResultados = escrita.length >= MINIMO_BUSQUEDA && total === 0;

  // Al resultado: cada vez que cambia cuál es el actual (o la búsqueda), se
  // lo trae al centro, lejos del buscador pegado arriba.
  React.useEffect(() => {
    if (total === 0) return;
    marcaActual.current?.scrollIntoView?.({ block: "center" });
  }, [actual, total, consulta]);

  const mover = (paso: number) => {
    if (total === 0) return;
    setActual((previo) => (previo + paso + total) % total);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="search"
        className="sticky top-0 z-10 -mx-5 flex flex-col gap-1 border-b border-[color:var(--border-subtle)] bg-cream-50 px-5 py-2 lg:mx-0 lg:px-0"
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-sm border border-[color:var(--border-subtle)] bg-white focus-within:border-sage-500 focus-within:ring-[3px] focus-within:ring-sage-500/20">
            <Search size={16} strokeWidth={1.8} aria-hidden="true" className="ml-3 shrink-0 text-ink-500" />
            <input
              type="search"
              value={consulta}
              onChange={(e) => {
                setConsulta(e.target.value);
                setActual(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mover(e.shiftKey ? -1 : 1);
                }
              }}
              aria-label={BUSCAR_EN_TRANSCRIPCION}
              placeholder={BUSCAR_PLACEHOLDER}
              enterKeyHint="search"
              autoComplete="off"
              className="min-h-[44px] min-w-0 flex-1 bg-transparent px-2 text-[15px] text-ink-900 !outline-none placeholder:text-ink-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {total > 0 ? (
              <span aria-live="polite" className="shrink-0 px-2 font-mono text-[12px] tabular-nums text-ink-500">
                {resultadoDeBusqueda(actual + 1, total)}
              </span>
            ) : null}
            {consulta !== "" ? (
              <button
                type="button"
                aria-label={BUSCAR_BORRAR}
                onClick={() => {
                  setConsulta("");
                  setActual(0);
                }}
                className="inline-flex h-11 w-10 shrink-0 items-center justify-center text-ink-500 hover:text-ink-900"
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <BotonMover etiqueta={BUSCAR_ANTERIOR} deshabilitado={total === 0} onClick={() => mover(-1)}>
            <ChevronUp size={18} strokeWidth={1.8} aria-hidden="true" />
          </BotonMover>
          <BotonMover etiqueta={BUSCAR_SIGUIENTE} deshabilitado={total === 0} onClick={() => mover(1)}>
            <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />
          </BotonMover>
        </div>
        {corta || sinResultados ? (
          <p role="status" className="font-sans text-[13px] text-ink-700">
            {corta ? BUSCAR_MINIMO : busquedaSinResultados(escrita)}
          </p>
        ) : null}
      </div>

      <ol className="flex flex-col gap-4">
        {bloques.map((bloque, indice) => (
          <Bloque
            key={indice}
            bloque={bloque}
            coincidencias={porBloque.get(indice)}
            actual={actual}
            marcaActual={marcaActual}
          />
        ))}
      </ol>
    </div>
  );
}

function BotonMover({
  etiqueta,
  deshabilitado,
  onClick,
  children,
}: {
  etiqueta: string;
  deshabilitado: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={onClick}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-white text-ink-700 transition-colors duration-[var(--duration-fast)] hover:bg-cream-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// Sin coincidencias un bloque recibe siempre las mismas props, así que al
// escribir en el buscador sólo se vuelven a dibujar los que tienen algo que
// resaltar (o lo tenían). Una sesión larga son un par de miles de bloques.
const Bloque = React.memo(function Bloque({
  bloque,
  coincidencias,
  actual,
  marcaActual,
}: {
  bloque: BloqueTranscripcion;
  coincidencias?: Array<Coincidencia & { orden: number }>;
  actual: number;
  marcaActual: React.RefObject<HTMLElement | null>;
}) {
  const texto = coincidencias ? (
    <Resaltado texto={bloque.texto} coincidencias={coincidencias} actual={actual} marcaActual={marcaActual} />
  ) : (
    bloque.texto
  );

  if (bloque.tipo === "literal") {
    return (
      <li className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.7] text-ink-900">
        {texto}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[12px] font-semibold tabular-nums text-ink-500">{bloque.marca}</span>
        <span
          className={`font-sans text-[12px] font-semibold uppercase tracking-[0.08em] ${
            bloque.hablante === ROTULO_TERAPEUTA ? "text-sage-700" : "text-ink-700"
          }`}
        >
          {bloque.hablante}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.7] text-ink-900">{texto}</p>
    </li>
  );
}, (a, b) =>
  a.bloque === b.bloque &&
  a.coincidencias === b.coincidencias &&
  // El resultado actual sólo le importa al bloque que resalta algo.
  (a.coincidencias === undefined || a.actual === b.actual),
);

function Resaltado({
  texto,
  coincidencias,
  actual,
  marcaActual,
}: {
  texto: string;
  coincidencias: Array<Coincidencia & { orden: number }>;
  actual: number;
  marcaActual: React.RefObject<HTMLElement | null>;
}) {
  const partes: React.ReactNode[] = [];
  let desde = 0;
  for (const c of coincidencias) {
    if (c.inicio > desde) partes.push(texto.slice(desde, c.inicio));
    const esActual = c.orden === actual;
    partes.push(
      <mark
        key={c.orden}
        ref={esActual ? marcaActual : undefined}
        data-actual={esActual ? "true" : undefined}
        className={`rounded-[3px] px-[1px] text-ink-900 ${esActual ? "bg-gold-500/45 outline outline-2 outline-gold-500" : "bg-gold-500/20"}`}
      >
        {texto.slice(c.inicio, c.fin)}
      </mark>,
    );
    desde = c.fin;
  }
  if (desde < texto.length) partes.push(texto.slice(desde));
  return <>{partes}</>;
}
