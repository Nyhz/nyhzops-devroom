import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Component tests use // @vitest-environment jsdom directive
    // Server action / unit tests run in default node environment
    setupFiles: [
      './src/lib/test/setup.ts',
    ],
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
});
