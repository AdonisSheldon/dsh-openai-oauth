import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', login: 'src/login-main.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
    clean: false,
  },
])
