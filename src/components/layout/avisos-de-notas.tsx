"use client";

// El aviso de "la nota está lista": una franja arriba de todas las pantallas
// del panel, y un globito en Hoy (bottom-nav.tsx, sidebar.tsx).
//
// Vive en el layout del panel, así que no se desmonta al navegar: ella puede
// estar en Cobros, en la agenda o en otra ficha y la franja aparece igual.
// Qué hay que avisar lo dice el servidor (src/lib/notas-en-proceso.ts); acá
// está el reloj de la consulta y el dibujo.
//
// NO SE CIERRA CON UNA CRUZ
//
// Una nota que espera revisión es trabajo pendiente, y ella mira el teléfono
// entre paciente y paciente: el dueño lo probó y pidió "una verdadera
// notificación". La franja se va cuando abre ESA nota (el servidor ve el
// `sesion.ver`), en este teléfono o en otro.
//
// POSICIÓN
//
// Primer hijo del <main>, en el flujo y pegada arriba (`sticky top-0`): no
// flota sobre nada, empuja la pantalla hacia abajo. Así nunca tapa el botón
// Agendar de Hoy ni el de la agenda (están en la cabecera de cada pantalla,
// que queda debajo) ni el menú de abajo, que es `fixed bottom-0`.
// En /sesiones/* no se pega: el índice de la nota y el buscador de la
// transcripción son `sticky top-0` y quedarían debajo de la franja.
//
// En /grabar/* no se muestra (el globito de Hoy sí, y la consulta sigue):
// mientras graba, la paciente está frente al teléfono y leería el nombre de
// otra. Es el mismo criterio de aviso-version.tsx.
//
// VARIOS AVISOS: UNA SOLA FRANJA
//
// A 390 px un aviso ocupa un renglón y medio con su botón (~60 px). Una
// franja por sesión son 120 px con dos y 180 con tres, pegados arriba de la
// pantalla del teléfono mientras ella hace otra cosa: la franja se come la
// pantalla. Con más de uno hay una sola franja del mismo alto que dice
// cuántas y de quiénes ("2 notas listas" / "Lucía Fernández y Ana Pérez") y
// con Ver despliega un renglón por sesión con su botón. Los nombres se leen
// sin tocar nada; el botón de cada una, con un toque más.

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui";
import { ApiClientError, apiGet } from "@/lib/api-client";
import {
  REVISAR,
  VER_QUE_PASO,
  notaFallidaDe,
  notaListaDe,
} from "@/lib/glosario";
import {
  RUTA_AVISOS,
  SEGUIMIENTO_VACIO,
  actualizarSeguimiento,
  aplicarRespuesta,
  avisosVisibles,
  borrarRastroViejo,
  intervaloDeConsulta,
  marcarFallo,
  marcarVista,
  obtenerSeguimiento,
  pedirConsulta,
  sesionDeLaRuta,
  suscribirSeguimiento,
  type AvisoNota,
  type AvisoServidor,
} from "@/lib/notas-en-proceso";

import {
  OCULTAR_AVISOS,
  REGION_AVISOS,
  VER_AVISOS,
  nombresDeAvisos,
  resumenDeAvisos,
} from "./textos";

export function useSeguimientoNotas() {
  return React.useSyncExternalStore(
    suscribirSeguimiento,
    obtenerSeguimiento,
    () => SEGUIMIENTO_VACIO,
  );
}

/** Los avisos que se muestran: sin los ya abiertos, ni el de la nota que
 *  ella tiene en pantalla. Lo usan la franja y el globito de Hoy. */
export function useAvisosPendientes(): AvisoNota[] {
  const seguimiento = useSeguimientoNotas();
  const abierta = sesionDeLaRuta(usePathname());
  return React.useMemo(
    () => avisosVisibles(seguimiento).filter((a) => a.sesionId !== abierta),
    [seguimiento, abierta],
  );
}

/** Una consulta a la vez. Si piden otra mientras vuela, se hace al volver:
 *  la respuesta en vuelo pudo salir antes de lo que motivó el pedido. */
function useConsultarAvisos() {
  const enVuelo = React.useRef(false);
  const otraVez = React.useRef(false);

  return React.useCallback(async function consultar(): Promise<void> {
    if (enVuelo.current) {
      otraVez.current = true;
      return;
    }
    enVuelo.current = true;
    const pedidoEn = Date.now();
    try {
      const filas = await apiGet<AvisoServidor[]>(RUTA_AVISOS);
      actualizarSeguimiento((s) => aplicarRespuesta(s, filas, pedidoEn));
    } catch (error) {
      // Sin red o el servidor falló: queda lo que había y el reloj reintenta,
      // aunque no se supiera de nada pendiente. Con la sesión vencida no:
      // el panel ya no es de ella, y la próxima pantalla la manda a entrar.
      if (!(error instanceof ApiClientError && error.esNoAutorizado)) {
        actualizarSeguimiento(marcarFallo);
      }
    } finally {
      enVuelo.current = false;
    }
    if (otraVez.current) {
      otraVez.current = false;
      await consultar();
    }
  }, []);
}

export function AvisosDeNotas() {
  const seguimiento = useSeguimientoNotas();
  const pathname = usePathname();
  const consultar = useConsultarAvisos();
  const intervalo = intervaloDeConsulta(seguimiento);

  // Una vez al montar el panel: la franja sale de lo que diga el servidor,
  // también después de cerrar y volver a abrir la pestaña. Y se borra lo que
  // la versión anterior dejó en la pestaña.
  React.useEffect(() => {
    borrarRastroViejo();
    void consultar();
  }, [consultar]);

  // La ficha o Hoy vieron una sesión en proceso que el panel no conocía, o
  // ella salió de grabar.
  const pedidos = seguimiento.consultarYa;
  const pedidosVistos = React.useRef(pedidos);
  React.useEffect(() => {
    if (pedidos === pedidosVistos.current) return;
    pedidosVistos.current = pedidos;
    void consultar();
  }, [pedidos, consultar]);

  // El reloj, solo mientras haya algo en proceso o sin ver, o la última
  // consulta falló. Con la pestaña oculta no pregunta; al volver pregunta
  // una vez y sigue.
  React.useEffect(() => {
    if (intervalo === null) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void consultar();
    }, intervalo);
    return () => clearInterval(id);
  }, [intervalo, consultar]);

  React.useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [consultar]);

  // Al salir de grabar, la sesión recién enviada ya está en proceso: sin
  // esto, ir de grabar directo a Cobros no la seguía nadie.
  const rutaAnterior = React.useRef(pathname);
  React.useEffect(() => {
    const venia = rutaAnterior.current;
    rutaAnterior.current = pathname;
    if (venia?.startsWith("/grabar/") && !pathname?.startsWith("/grabar/")) {
      actualizarSeguimiento(pedirConsulta);
    }
  }, [pathname]);

  // Abrió la nota: la franja se va ya, sin esperar al servidor. Mientras
  // está en ella, la franja no la nombra (useAvisosPendientes). Al salir se
  // renueva la marca y se pregunta una vez: si la nota no llegó a leerse, el
  // servidor la sigue trayendo y el aviso vuelve (MARGEN_VISTA_MS).
  const abierta = sesionDeLaRuta(pathname);
  const abiertaAntes = React.useRef<string | null>(null);
  React.useEffect(() => {
    const anterior = abiertaAntes.current;
    abiertaAntes.current = abierta;
    if (anterior === abierta) return;
    if (abierta) {
      actualizarSeguimiento((s) => marcarVista(s, abierta, Date.now()));
    }
    if (anterior) {
      actualizarSeguimiento((s) => pedirConsulta(marcarVista(s, anterior, Date.now())));
    }
  }, [abierta]);

  const avisos = useAvisosPendientes();
  if (avisos.length === 0 || pathname?.startsWith("/grabar/")) return null;

  const pegada = pathname?.startsWith("/sesiones/") ? "relative" : "sticky top-0";
  return (
    <section aria-label={REGION_AVISOS} className={`${pegada} z-30`}>
      {avisos.length === 1 ? (
        <UnAviso aviso={avisos[0]} />
      ) : (
        <VariosAvisos avisos={avisos} />
      )}
    </section>
  );
}

function tono(fallida: boolean): string {
  return fallida
    ? "border-terracotta-100 bg-terracotta-50"
    : "border-sage-100 bg-sage-50";
}

function Icono({ fallida }: { fallida: boolean }) {
  return fallida ? (
    <AlertCircle
      size={20}
      strokeWidth={1.8}
      aria-hidden="true"
      className="shrink-0 text-[color:var(--color-error)]"
    />
  ) : (
    <CheckCircle2
      size={20}
      strokeWidth={1.8}
      aria-hidden="true"
      className="shrink-0 text-sage-600"
    />
  );
}

/** Texto y botón de un aviso: el mismo renglón suelto o dentro de la lista. */
function RenglonAviso({ aviso }: { aviso: AvisoNota }) {
  const lista = aviso.tipo === "lista";
  return (
    <>
      <Icono fallida={!lista} />
      <p className="min-w-0 flex-1 font-sans text-[15px] font-semibold leading-snug text-ink-900">
        {lista ? notaListaDe(aviso.paciente) : notaFallidaDe(aviso.paciente)}
      </p>
      <Button
        asChild
        size="sm"
        variant={lista ? "primary" : "secondary"}
        className="shrink-0"
      >
        <Link
          href={`/sesiones/${aviso.sesionId}`}
          onClick={() =>
            actualizarSeguimiento((s) => marcarVista(s, aviso.sesionId, Date.now()))
          }
        >
          {lista ? REVISAR : VER_QUE_PASO}
        </Link>
      </Button>
    </>
  );
}

function UnAviso({ aviso }: { aviso: AvisoNota }) {
  return (
    <div
      role="status"
      className={`flex items-center gap-3 border-b px-4 py-2 lg:px-8 ${tono(aviso.tipo === "fallida")}`}
    >
      <RenglonAviso aviso={aviso} />
    </div>
  );
}

function VariosAvisos({ avisos }: { avisos: AvisoNota[] }) {
  const [desplegada, setDesplegada] = React.useState(false);
  const listaId = React.useId();
  const fallidas = avisos.filter((a) => a.tipo === "fallida").length;
  const listas = avisos.length - fallidas;

  return (
    <div className={`border-b ${tono(fallidas > 0)}`}>
      <div role="status" className="flex items-center gap-3 px-4 py-2 lg:px-8">
        <Icono fallida={fallidas > 0} />
        <div className="min-w-0 flex-1">
          <p className="font-sans text-[15px] font-semibold leading-snug text-ink-900">
            {resumenDeAvisos(listas, fallidas)}
          </p>
          <p className="truncate font-sans text-[13px] leading-snug text-ink-700">
            {nombresDeAvisos(avisos.map((a) => a.paciente))}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 bg-white"
          aria-expanded={desplegada}
          aria-controls={listaId}
          onClick={() => setDesplegada((d) => !d)}
        >
          {desplegada ? OCULTAR_AVISOS : VER_AVISOS}
          <ChevronDown
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none ${desplegada ? "rotate-180" : ""}`}
          />
        </Button>
      </div>
      {desplegada ? (
        // Con muchas, la lista scrollea sola y nunca pasa el alto de la
        // pantalla: la franja está pegada arriba y abajo está el menú.
        <ul
          id={listaId}
          className="max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain border-t border-[color:var(--border-subtle)] bg-white lg:max-h-[calc(100dvh-8rem)]"
        >
          {avisos.map((aviso) => (
            <li
              key={aviso.sesionId}
              className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-2 last:border-b-0 lg:px-8"
            >
              <RenglonAviso aviso={aviso} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
