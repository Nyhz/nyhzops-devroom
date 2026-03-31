import { defineConfig, defineProject } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(__dirname, './src') };

export default defineConfig({
  test: {
    projects: [
      defineProject({
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./src/lib/test/setup.ts'],
          include: ['src/**/*.test.ts'],
          exclude: ['src/hooks/__tests__/**'],
        },
      }),
      defineProject({
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: [
            './src/lib/test/setup.ts',
            './src/lib/test/component-setup.ts',
          ],
          include: ['src/**/*.test.tsx', 'src/hooks/__tests__/*.test.ts'],
        },
      }),
    ],
  },
});
