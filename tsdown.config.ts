import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22.12',
  outDir: 'dist',
  clean: true,
  dts: false,
  shims: false,

  // The package is "type": "module", so .js is already ESM — .mjs would be noise.
  outExtensions: () => ({ js: '.js' }),

  // Every runtime dependency is declared in devDependencies, which tsdown bundles
  // by default. That is what makes the published package resolve to zero
  // transitive dependencies (LINCHPIN-5366).
  deps: { onlyBundle: false },
});
