// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Backend lint config.
 *
 * Scoped deliberately tight: this codebase had no lint at all until now, so the
 * goal is rules that catch real defects (unused code, floating promises, unsafe
 * comparisons) without flooding the first run with thousands of style opinions
 * that would get ignored wholesale.
 *
 * Type-aware rules are enabled — most of the bugs found in this repo (silently
 * dropped fields, unawaited writes) are only visible with type information.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped `await` on a Prisma write is the exact class of bug that
      // silently loses data — this is the highest-value rule here.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Unused code is called out in CLAUDE.md. Leading underscore opts out, for
      // deliberately-ignored Express args like `_next`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` is a warning, not an error: a handful of pre-existing Prisma/Express
      // escapes exist and blocking the build on them helps nobody. New code should
      // still avoid it.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Template literals over string concatenation is a style call; the codebase
      // already mixes both and neither is a defect.
      '@typescript-eslint/restrict-template-expressions': 'off',

      // `router.get('/x', async (req, res) => …)` is the standard Express 4 idiom
      // and every handler in this codebase wraps its body in try/catch, so the
      // promise is never actually unhandled. Flagging all ~90 of them would be
      // pure noise. The rest of the rule stays on — only the "async function
      // passed as a void-returning argument" case is exempted.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // console is the logging strategy on this server
    },
  },

  {
    // Augmenting Express's Request type (to add `req.userId`) requires
    // `declare global { namespace Express { … } }` — there is no ES-module
    // equivalent, so the rule cannot be satisfied here.
    files: ['src/middleware/auth.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },

  // Standalone scripts run via tsx. They sit outside tsconfig's `src/**` include,
  // so type-aware rules cannot resolve them — lint them syntactically instead of
  // widening the build tsconfig just to satisfy the linter.
  {
    files: ['prisma/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
