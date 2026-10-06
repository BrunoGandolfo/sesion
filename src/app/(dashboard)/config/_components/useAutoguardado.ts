"use client";

// El autoguardado de Tu consultorio: carga la configuración, junta los
// campos que ella cambia, los manda en lote después de `esperaMs` sin
// escribir, y no pierde nada al salir —ni navegando (se manda al desmontar)
// ni cerrando la pestaña (keepalive en pagehide)—. Un campo inválido no
// frena a los válidos del mismo lote: queda pendiente, con su error.
// Lo prueba config-firme.test.tsx a través de la pantalla.

import * as React from "react";

import { useProtegerTrabajo } from "@/components/layout/proteccion-trabajo";
import type { EstadoCampo } from "@/components/ui/guardado-campo";
import { esAbort, mensajeParaElla } from "@/lib/api-client";
import { CONFIG_SIN_GUARDAR_SALIDA } from "@/lib/glosario";

import {
  FORM_VACIO,
  formDesdeConfig,
  guardarConfig,
  guardarConfigAlSalir,
  leerConfig,
  patchDesdeCampos,
  type CampoConfig,
  type EstadoGuardado,
  type FormConfig,
} from "./datos";

export function useAutoguardado(esperaMs: number) {
  const [form, setForm] = React.useState<FormConfig>(FORM_VACIO);
  const [cargando, setCargando] = React.useState(true);
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [estadoGuardado, setEstadoGuardado] =
    React.useState<EstadoGuardado>("idle");
  const [camposAvisados, setCamposAvisados] = React.useState<CampoConfig[]>([]);
  const [camposPendientes, setCamposPendientes] = React.useState<CampoConfig[]>([]);

  const formRef = React.useRef(form);
  const debounceRef = React.useRef<number | null>(null);
  const avisoRef = React.useRef<number | null>(null);
  const guardarPendientesRef = React.useRef<() => Promise<void>>(
    async () => {},
  );
  const camposSuciosRef = React.useRef<Set<CampoConfig>>(new Set());
  const enVueloRef = React.useRef(false);
  const volverAGuardarRef = React.useRef(false);
  const montadoRef = React.useRef(true);

  const limpiarAviso = React.useCallback(() => {
    if (avisoRef.current !== null) {
      window.clearTimeout(avisoRef.current);
      avisoRef.current = null;
    }
  }, []);

  const mostrarGuardado = React.useCallback(() => {
    limpiarAviso();
    setEstadoGuardado("guardado");
    avisoRef.current = window.setTimeout(() => {
      if (montadoRef.current) setEstadoGuardado("idle");
      avisoRef.current = null;
    }, 2000);
  }, [limpiarAviso]);

  const programarGuardado = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void guardarPendientesRef.current();
    }, esperaMs);
  }, [esperaMs]);

  const guardarPendientes = React.useCallback(async () => {
    if (enVueloRef.current) {
      volverAGuardarRef.current = true;
      return;
    }

    const campos = Array.from(camposSuciosRef.current);
    if (campos.length === 0) return;

    const { patch, campos: enviados, invalido } = patchDesdeCampos(
      formRef.current,
      campos,
    );
    setCamposAvisados(enviados);

    if (enviados.length === 0) {
      if (invalido) setEstadoGuardado("error");
      return;
    }

    for (const campo of enviados) camposSuciosRef.current.delete(campo);
    setCamposPendientes(Array.from(camposSuciosRef.current));

    enVueloRef.current = true;
    limpiarAviso();
    setEstadoGuardado("guardando");

    let guardado = false;
    try {
      await guardarConfig(patch);
      guardado = true;
    } catch {
      for (const campo of enviados) camposSuciosRef.current.add(campo);
      if (montadoRef.current) {
        setCamposPendientes(Array.from(camposSuciosRef.current));
        setEstadoGuardado("error");
      }
    } finally {
      enVueloRef.current = false;
      const volver = volverAGuardarRef.current;
      volverAGuardarRef.current = false;

      if (montadoRef.current) {
        if (guardado && invalido) setEstadoGuardado("error");
        else if (guardado && camposSuciosRef.current.size === 0) mostrarGuardado();
        if (camposSuciosRef.current.size > 0 && (guardado || volver)) {
          programarGuardado();
        }
      } else if (volver) {
        // Ella ya se fue y escribió algo mientras viajaba el anterior: no hay
        // pantalla que lo reprograme, se manda ahora.
        void guardarPendientesRef.current();
      }
    }
  }, [limpiarAviso, mostrarGuardado, programarGuardado]);

  React.useEffect(() => {
    guardarPendientesRef.current = guardarPendientes;
  }, [guardarPendientes]);

  // Carga inicial. El estado "cargando" es el inicial y el reintento lo
  // vuelve a poner desde su handler; acá solo se setea cuando responde la red.
  React.useEffect(() => {
    montadoRef.current = true;
    const controller = new AbortController();

    leerConfig(controller.signal)
      .then((config) => {
        // Los campos que la usuaria ya escribió ganan sobre lo que traiga la
        // red, como en el alta de turno. Hoy no puede pasar —el formulario no
        // se dibuja mientras `cargando`, y el reintento lo vuelve a poner—,
        // pero si alguna vez se muestra mientras carga, o se agrega un
        // refetch al volver a la pestaña, esto es lo que evita que una
        // respuesta lenta le borre lo tipeado.
        const escritos = Object.fromEntries(
          Array.from(camposSuciosRef.current, (campo) => [campo, formRef.current[campo]]),
        ) as Partial<FormConfig>;
        const siguiente = { ...formDesdeConfig(config), ...escritos };
        formRef.current = siguiente;
        setCamposPendientes(Array.from(camposSuciosRef.current));
        setForm(siguiente);
        setEstadoGuardado("idle");
        setCargando(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setErrorCarga(mensajeParaElla(err));
        setCargando(false);
      });

    return () => {
      montadoRef.current = false;
      controller.abort();
      if (avisoRef.current !== null) window.clearTimeout(avisoRef.current);
    };
  }, [reloadKey]);

  // Salir de la pantalla no espera al autoguardado: lo pendiente se manda en
  // ese momento. Navegar dentro de la app no recarga la página, así que el
  // pedido termina aunque la pantalla ya no esté.
  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void guardarPendientesRef.current();
    },
    [],
  );

  // Cerrar o recargar la pestaña corta los pedidos comunes; `keepalive` es el
  // que el navegador deja terminar.
  React.useEffect(() => {
    const alSalir = () => {
      const { patch, campos } = patchDesdeCampos(
        formRef.current,
        Array.from(camposSuciosRef.current),
      );
      if (campos.length === 0) return;
      guardarConfigAlSalir(patch);
    };
    window.addEventListener("pagehide", alSalir);
    return () => window.removeEventListener("pagehide", alSalir);
  }, []);

  // Lo único que no se puede mandar al salir: un dato inválido o un guardado
  // que falló. Eso se avisa antes de perderlo.
  useProtegerTrabajo(estadoGuardado === "error", CONFIG_SIN_GUARDAR_SALIDA);

  const reintentarCarga = () => {
    setCargando(true);
    setErrorCarga(null);
    setReloadKey((k) => k + 1);
  };

  const actualizarCampo = React.useCallback(
    <T extends CampoConfig>(campo: T, valor: FormConfig[T]) => {
      setForm((actual) => {
        const siguiente = { ...actual, [campo]: valor };
        formRef.current = siguiente;
        return siguiente;
      });
      camposSuciosRef.current.add(campo);
      setCamposPendientes(actual => actual.includes(campo) ? actual : [...actual, campo]);
      limpiarAviso();
      setEstadoGuardado((estado) =>
        estado === "guardado" || estado === "error" ? "idle" : estado,
      );
      programarGuardado();
    },
    [limpiarAviso, programarGuardado],
  );

  const reintentarGuardado = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void guardarPendientes();
  }, [guardarPendientes]);

  // No atribuir un guardado a otro campo, ni al valor nuevo escrito mientras
  // viajaba el anterior. El error es de lo que quedó sin guardar; los campos
  // válidos del mismo lote ya se guardaron.
  function estadoDelCampo(campo: CampoConfig): EstadoCampo {
    if (camposPendientes.includes(campo)) {
      return estadoGuardado === "error" ? "error" : "pendiente";
    }
    if (!camposAvisados.includes(campo)) return "idle";
    return estadoGuardado === "error" ? "guardado" : estadoGuardado;
  }

  return {
    form,
    cargando,
    errorCarga,
    estadoGuardado,
    reintentarCarga,
    actualizarCampo,
    reintentarGuardado,
    estadoDelCampo,
  };
}
