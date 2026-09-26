// El encabezado de Hoy: quién sos, qué día es y cuántas sesiones hay.
//
// La cabecera de usuario (avatar + saludo + nombre + fecha) reemplazó al
// nombre subrayado con un engranaje al lado: era un enlace que había que
// descubrir, y el engranaje repetía el mismo destino en un ícono distinto.
// Ahora hay un solo bloque tocable y se parece a como se entra a la
// configuración en cualquier app que ella ya usa.
//
// El día en grande dejó de repetir "4 sep": esa fecha ya está, en chico,
// en la cabecera. Acá queda el día de la semana, que es lo que orienta.
//
// Y dejó de ser lo más grande de la pantalla. "lunes" medía 52 px y se comía
// un cuarto de la primera pantalla para decir algo que ella ya sabe; justo
// debajo, en 13 px, iba el único dato que le cambia el día. La jerarquía
// estaba al revés de la importancia: lo más grande de Hoy tiene que ser qué
// sesión viene ahora (card-ahora.tsx), no qué día es. Ahora el día y la
// cuenta de sesiones van en una sola línea, del tamaño de un subtítulo.

//
// LA LÍNEA DE LUPITA
//
// La primera vez del día que ella abre Hoy en este dispositivo, debajo del
// día va una línea corta de Lupita (docs/diseno/06-lupita-presencia.md) y la
// posada la saluda. Sin dibujo propio acá: la que saluda es la posada, y dos
// Lupitas a la vez serían una de más. Cuál es "la primera vez" lo guarda
// `localStorage`; si el navegador no deja leerlo o escribirlo, no saluda
// —antes que saludar en cada visita—.

import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { diaSemana, fechaLarga } from "@/lib/format";
import { HOY_SIN_SESIONES, pluralizar } from "@/lib/glosario";

const CLAVE_SALUDO = "lupita:saludo";

// Lo que se decidió para el día, en esta pestaña. Se decide una sola vez por
// día —leer y escribir el almacenamiento es un efecto— y la línea se ve en
// la PRIMERA visita a Hoy: al volver a la pantalla ya no está.
let decidido: { dia: string; mostrar: boolean; saludo: boolean } | null = null;

/** ¿Es la primera vez del día en este dispositivo? Se puede llamar en el
 *  render: la segunda llamada del mismo día devuelve lo mismo. */
export function tocaSaludarHoy(ahora: Date): boolean {
  const dia = fechaInputMvd(ahora);
  if (decidido?.dia === dia) return decidido.mostrar;
  let mostrar = false;
  try {
    mostrar = window.localStorage.getItem(CLAVE_SALUDO) !== dia;
    if (mostrar) window.localStorage.setItem(CLAVE_SALUDO, dia);
  } catch {
    mostrar = false;
  }
  decidido = { dia, mostrar, saludo: false };
  return mostrar;
}

/** El gesto de la posada sale UNA vez: Hoy se vuelve a leer al agendar o
 *  cuando una nota termina, y la línea puede cambiar de texto, pero el
 *  saludo ya estuvo. Devuelve si toca hacerlo ahora. */
export function tocaElGestoDelSaludo(): boolean {
  if (!decidido?.mostrar || decidido.saludo) return false;
  decidido = { ...decidido, saludo: true };
  return true;
}

/** La línea ya se vio: al volver a Hoy el mismo día, no está. */
export function saludoVisto(): void {
  if (decidido) decidido = { ...decidido, mostrar: false };
}

/** Sólo para tests. */
export function olvidarSaludoParaTests(): void {
  decidido = null;
}

export function Saludo({
  ahora,
  nombre,
  sesiones,
  lineaDeLupita = null,
}: {
  ahora: Date;
  nombre: string | null;
  sesiones: number;
  /** La línea del día, sólo la primera vez (ver arriba). */
  lineaDeLupita?: string | null;
}) {
  return (
    <section aria-label={fechaLarga(ahora)} className="min-w-0">
      <CabeceraUsuario nombre={nombre} ahora={ahora} conSaludo />

      <h1 className="mt-3 flex flex-wrap items-baseline gap-x-2 font-[family-name:var(--font-display)] text-[24px] font-medium italic leading-tight tracking-[-0.02em] text-ink-900 lg:text-[30px]">
        {diaSemana(ahora)}
        <span className="font-sans tabular-nums text-[13px] font-normal not-italic tracking-normal text-ink-500">
          {sesiones > 0
            ? pluralizar(sesiones, "sesión en el día", "sesiones en el día")
            : HOY_SIN_SESIONES}
        </span>
      </h1>
      {lineaDeLupita ? (
        <p className="mt-1 font-sans text-[14px] leading-[1.5] text-ink-700">{lineaDeLupita}</p>
      ) : null}
    </section>
  );
}
