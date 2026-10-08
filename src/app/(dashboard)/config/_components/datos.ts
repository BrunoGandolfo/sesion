// Tu consultorio, del lado de los datos: la forma del formulario, cómo se
// arma desde la configuración guardada, qué campos de un lote se pueden
// mandar y las tres llamadas a /api/config. Sin estado, sin efectos, sin
// React.

import { apiGet, apiPatch } from "@/lib/api-client";
import {
  RECORDATORIO_MODO_DEFAULT,
  type RecordatorioModo,
} from "@/lib/recordatorios-programacion";
import { prepararPlantillaRecordatorio, TEMPLATE_SMS_SUGERIDO } from "@/lib/sms/texto";
import type { Configuracion, OrientacionTeorica } from "@/types/domain";

import type { CanalRecordatorio } from "../../_components/recordatorios-datos";

/** Lo que manda /api/config. `canalRecordatorio` lo agrega la API de los
 *  recordatorios por WhatsApp; mientras una respuesta no lo traiga, el canal
 *  es el de siempre: SMS. */
type ConfigLeida = Configuracion & { canalRecordatorio?: CanalRecordatorio };

export type CampoConfig =
  | "nombreProfesional"
  | "direccion"
  | "whatsappOrigen"
  | "tarifaDefault"
  | "recordatorioModo"
  | "canalRecordatorio"
  | "templateRecordatorio"
  | "orientacionTeorica";

export type FormConfig = {
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: string;
  recordatorioModo: RecordatorioModo;
  canalRecordatorio: CanalRecordatorio;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
};

type PatchConfig = Partial<{
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: number;
  recordatorioModo: RecordatorioModo;
  canalRecordatorio: CanalRecordatorio;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
}>;

export type EstadoGuardado = "idle" | "guardando" | "guardado" | "error";

// Sin datos inventados: los campos de "Vos" arrancan vacíos hasta que llega
// la configuración real. Lo único con valor propio es lo que también tiene
// default en la base (el momento del aviso) y el template sugerido.
export const FORM_VACIO: FormConfig = {
  nombreProfesional: "",
  direccion: "",
  whatsappOrigen: "",
  tarifaDefault: "",
  recordatorioModo: RECORDATORIO_MODO_DEFAULT,
  canalRecordatorio: "sms",
  templateRecordatorio: TEMPLATE_SMS_SUGERIDO,
  orientacionTeorica: "cbt_mi",
};

export function formDesdeConfig(config: ConfigLeida): FormConfig {
  return {
    nombreProfesional: config.nombreProfesional,
    direccion: config.direccion,
    whatsappOrigen: config.whatsappOrigen,
    tarifaDefault: String(config.tarifaDefault),
    recordatorioModo: config.recordatorioModo,
    canalRecordatorio: config.canalRecordatorio ?? "sms",
    // La plantilla que de verdad sale: la misma preparación que usan el envío
    // y la vista previa. Sin esto, el editor mostraba la guardada tal cual y
    // la vista previa otra (el default viejo de la base se reemplaza entero,
    // y a cualquier otra se le agregan remitente y contacto). No se guarda al
    // abrir: queda en la base con el primer cambio que ella haga.
    templateRecordatorio: prepararPlantillaRecordatorio(config.templateRecordatorio),
    orientacionTeorica: config.orientacionTeorica,
  };
}

export function patchDesdeCampos(
  form: FormConfig,
  campos: CampoConfig[],
): { patch: PatchConfig; campos: CampoConfig[]; invalido: boolean } {
  // `invalido` avisa, no frena: los campos válidos del lote salen igual y los
  // inválidos quedan pendientes, con su error en el campo.
  const patch: PatchConfig = {};
  const incluidos: CampoConfig[] = [];
  let invalido = false;

  for (const campo of campos) {
    if (campo === "tarifaDefault") {
      const valor = Number(form.tarifaDefault);
      if (
        !form.tarifaDefault.trim() ||
        !Number.isInteger(valor) ||
        valor < 0
      ) {
        invalido = true;
        continue;
      }
      patch.tarifaDefault = valor;
      incluidos.push(campo);
      continue;
    }

    if (campo === "templateRecordatorio") {
      if (!form.templateRecordatorio.trim()) {
        invalido = true;
        continue;
      }
      patch.templateRecordatorio = form.templateRecordatorio;
      incluidos.push(campo);
      continue;
    }

    if (campo === "nombreProfesional") {
      if (!form.nombreProfesional.trim()) {
        invalido = true;
        continue;
      }
      patch.nombreProfesional = form.nombreProfesional;
      incluidos.push(campo);
      continue;
    }

    if (campo === "recordatorioModo") {
      patch.recordatorioModo = form.recordatorioModo;
      incluidos.push(campo);
      continue;
    }

    if (campo === "canalRecordatorio") {
      patch.canalRecordatorio = form.canalRecordatorio;
      incluidos.push(campo);
      continue;
    }

    if (campo === "orientacionTeorica") {
      patch.orientacionTeorica = form.orientacionTeorica;
      incluidos.push(campo);
      continue;
    }

    patch[campo] = form[campo];
    incluidos.push(campo);
  }

  return { patch, campos: incluidos, invalido };
}

export function leerConfig(signal: AbortSignal): Promise<ConfigLeida> {
  return apiGet<ConfigLeida>("/api/config", { signal });
}

export function guardarConfig(patch: PatchConfig): Promise<ConfigLeida> {
  return apiPatch<ConfigLeida>("/api/config", patch);
}

/** Lo pendiente al cerrar o recargar la pestaña: `keepalive` es el pedido
 *  que el navegador deja terminar. Nadie espera la respuesta. */
export function guardarConfigAlSalir(patch: PatchConfig): void {
  void apiPatch("/api/config", patch, { keepalive: true }).catch(() => {});
}
