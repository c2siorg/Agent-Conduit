// Flat ESLint config (scaffold). Tighten rules as implementations land.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/dashboard/dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Scaffold stubs carry injected-but-unused deps + placeholder params — ignore `_`-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
