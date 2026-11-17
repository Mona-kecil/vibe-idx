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
        // Keep web modules compatible with plain ESM imports.
        files: ['apps/web/**'],
        plugins: ['typescript', 'react', 'import'],
        rules: {
          'import/extensions': [
            'error',
            'always',
            { ignorePackages: true, checkTypeImports: false },
          ],
        },
      },
      {
        files: ['apps/web/**/*.test.{ts,tsx}'],
        plugins: ['typescript', 'react', 'vitest', 'import'],
        rules: { 'import/extensions': 'off' },
      },
      {
        // Local tools run with tsx.
        files: ['apps/web/hillclimb/**', 'apps/web/scripts/**'],
        plugins: ['typescript', 'react', 'import'],
        rules: { 'import/extensions': 'off' },
      },
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx}': [
      'vp check --fix',
      'pnpm -r --workspace-concurrency=1 exec vp test related --run --passWithNoTests',
    ],
  },
});
