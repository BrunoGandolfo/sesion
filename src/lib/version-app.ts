// Next sustituye este acceso literal por el identificador generado en el build.
// La pestaña conserva el de su JavaScript aunque el servidor se actualice.
export const VERSION_APP = process.env.NEXT_PUBLIC_VERSION_APP ?? "desarrollo";
