// Única fuente de verdad del borrado best-effort del audio cifrado en R2.
// Lo usan el DELETE de sesión clínica (eliminación definitiva) y /aprobar
// (fin del ciclo de vida del audio: grabación → aprobación de la nota).
//
// Import dinámico de @/lib/r2 (mismo patrón que upload/route.ts) para
// tolerar entornos de desarrollo sin R2 configurado.
//
// Devuelve true si después de la llamada ya no queda audio que borrar (se
// borró, o no había nada: key nula o "dev-no-r2"); false si el objeto puede
// seguir existiendo en R2 (R2 no configurado o el delete falló). Con false,
// el caller NO debe nulear audioR2Key: la key es el único puntero para poder
// borrar el blob en un intento posterior.
export async function borrarAudioBestEffort(
  audioR2Key: string | null,
): Promise<boolean> {
  if (!audioR2Key || audioR2Key === "dev-no-r2") return true;
  try {
    const r2 = await import("@/lib/r2");
    if (!r2.r2Configurado()) {
      console.warn(
        "[sesion-clinica/audio] R2 no configurado; el audio no se pudo borrar.",
        { audioR2Key },
      );
      return false;
    }
    await r2.borrarAudio(audioR2Key);
    return true;
  } catch (error) {
    console.warn(
      "[sesion-clinica/audio] No se pudo borrar el audio de R2.",
      { audioR2Key, error },
    );
    return false;
  }
}
