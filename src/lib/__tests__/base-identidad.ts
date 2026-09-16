// Identidad y cifrado usan la misma conexión validada y limpieza administrativa
// que las demás integraciones. La copia anterior del vaciado saltaba el helper
// común y ya no puede truncar las tablas protegidas por triggers.
export {
  conectarBaseDeTest as conectarBaseIdentidad,
  vaciarTablas as vaciarBaseIdentidad,
  urlDeBaseDeTest,
  hayBaseDeTest,
  type BaseDeTest as BaseIdentidad,
} from "./db-test";

/** Clave de cifrado de los tests: 32 bytes en cero, id 1. */
export const CLAVES_CIFRADO_TEST = "1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
