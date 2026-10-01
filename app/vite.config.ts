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
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
