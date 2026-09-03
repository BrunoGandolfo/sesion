import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Los tests de integración comparten la rama `test` de Neon y la vacían en
    // cada corrida: los archivos deben correr de a uno para no pisarse.
    fileParallelism: false,
    // Los de integración hablan con Neon por red; 5 s (el default) no alcanza.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
