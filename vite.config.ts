import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['**/node_modules/**', 'apps/**/dist/**', 'apps/pipeline/fixtures/**'],
    singleQuote: true,
    semi: true,
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: ['**/node_modules/**', 'apps/**/dist/**', 'apps/pipeline/fixtures/**'],
    plugins: ['typescript'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ['apps/web/**'],
        plugins: ['typescript', 'react'],
      },
      {
        files: ['apps/web/**/*.test.{ts,tsx}'],
        plugins: ['typescript', 'react', 'vitest'],
      },
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx}': 'vp check --fix',
  },
});
