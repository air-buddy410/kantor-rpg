import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const design = fileURLToPath(new URL('../design', import.meta.url));

export default defineConfig({
  base: './',
  resolve: { alias: { '@design': design } },
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    // three.js (~650 kB minified) is the bulk of the JS: its own chunk keeps it
    // cacheable across app releases and lets the warning limit stay at the
    // default instead of being raised to hide the size (R2).
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }, { name: 'studio', test: /[\\/]src[\\/]studio[\\/](ui|editor|validate)\.ts$/, includeDependenciesRecursively: false }] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
