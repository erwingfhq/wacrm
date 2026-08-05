/**
 * Configuración aparte para las comprobaciones EN VIVO
 * (`src/**​/__live-*.test.ts`), que sí llaman a proveedores reales.
 *
 * `vitest.config.ts` inyecta secretos falsos a propósito, así que no
 * puede descifrar las claves guardadas en la base de datos. Aquí se
 * cargan las de verdad desde `.env.local` (fichero ignorado por git).
 *
 *   npx vitest run --config vitest.live.config.ts
 */
import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('./.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z]/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim()]
    }),
)

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/__live-*.test.ts'],
    env,
    testTimeout: 240_000,
  },
})
