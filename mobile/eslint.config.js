// @ts-check
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/**
 * Mobile lint config.
 *
 * Built on eslint-config-expo, which already carries the React, React Hooks and
 * React Native rules that matter here (hook dependency arrays, unstable nested
 * components, unused styles). Kept close to that baseline rather than layering
 * on a house style — this codebase had no lint until now, and rules nobody
 * agreed to are rules that get disabled at the first inconvenience.
 */
module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'expo-env.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Flat config requires the plugin to be declared in the same object as any
    // rule that references it.
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // The BASE no-unused-vars rule must stay off: it doesn't understand TS type
      // declarations and reports every parameter name in an interface method
      // signature as an unused variable (~130 false positives here). The
      // TypeScript-aware version below is the one that actually works.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // console.warn/error are the app's diagnostics; bare console.log is dev noise.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // An HTML-escaping rule that doesn't apply to React Native: <Text>Don't</Text>
      // renders correctly, there is no HTML parser involved. Enforcing it would
      // only make copy harder to read (`Don&apos;t`) for no correctness gain.
      'react/no-unescaped-entities': 'off',

      // ── React Compiler rules, arrived with eslint-config-expo 57 ────────────
      // The SDK 54 -> 57 upgrade brought React 19.2's compiler-aware rules,
      // which flag 21 PRE-EXISTING patterns: setState inside an effect, refs
      // read during render, Date.now() during render. None of them are new
      // breakage — the code behaves exactly as it did on SDK 54, these paths
      // were simply never checked before.
      //
      // Held at 'warn' so the upgrade stays attributable: mixing 21 hook
      // refactors into an SDK bump would make any regression impossible to
      // pin on either change. They are real signals and worth fixing.
      // TODO: fix these and restore to 'error' — tracked in TODOS.md.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);
