import { defineConfig } from 'vitest/config'
import path from 'path'

// Los tests se dividen en dos suites:
//
//   - unitarios: puros, sin red ni base. Corren en cualquier lado.
//   - integración: los siete archivos de INTEGRACION, que se conectan a la
//     rama de test de Neon (DATABASE_URL_TEST) y la vacían entre casos.
//
// `npm test` corre las dos (es lo que corre CI). `npm run test:unit` y
// `npm run test:integration` eligen una, vía VITEST_SUITE. La lista vive acá
// y no en los scripts para que agregar un archivo de integración sea tocar
// un solo lugar.
//
// Cuando el proyecto crezca conviene renombrarlos a *.integration.test.ts y
// reemplazar la lista por un glob; hoy son siete y una lista explícita se
// lee mejor que una convención que hay que recordar.
const INTEGRACION = [
  'src/lib/__tests__/prisma-encryption.test.ts',
  'src/lib/__tests__/casos-uso-sesion.test.ts',
  'src/lib/__tests__/casos-uso-worker.test.ts',
  'src/lib/__tests__/casos-uso-recordatorios.test.ts',
  'src/lib/__tests__/pendientes-terapeuta.test.ts',
  'src/lib/__tests__/cobrar-turno.test.ts',
  'src/lib/__tests__/contexto-clinico.test.ts',
]

// Repetidos a mano en vez de importar `defaultExclude`: al pasar `exclude`
// se pisa el default de vitest, y sin estos tres se colectarían tests de
// dependencias.
const EXCLUIDOS_SIEMPRE = ['**/node_modules/**', '**/dist/**', '**/.next/**']

const suite = process.env.VITEST_SUITE

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Los tests de integración comparten la rama `test` de Neon y la vacían en
    // cada corrida: los archivos deben correr de a uno para no pisarse.
    fileParallelism: false,
    // Los de integración hablan con Neon por red; 5 s (el default) no alcanza.
    testTimeout: 30_000,
    ...(suite === 'integration' ? { include: INTEGRACION } : {}),
    ...(suite === 'unit'
      ? { exclude: [...EXCLUIDOS_SIEMPRE, ...INTEGRACION] }
      : {}),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
