// ESLint 9 flat config for nestr-mcp (Node 22 / TypeScript, no React, no Meteor).
// Toolchain: ESLint (flat config) + typescript-eslint + eslint-config-prettier.
// Prettier owns formatting; ESLint owns correctness and code quality.
//
// Named .mjs so Node treats it as ESM regardless of package.json "type".
// If your package.json already has "type":"module", .js works fine instead.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ┐┐ Ignored paths
  {
    ignores: [
      'node_modules/**',
      'build/**',       // tsc output
      'dist/**',
      'coverage/**',
      '**/*.min.js',
      'web/**',         // static HTML/CSS assets; not linted as JS
    ],
  },

  // ┐┐ Base JS recommended rules
  js.configs.recommended,

  // ┐┐ TypeScript recommended (applies to .ts files)
  ...tseslint.configs.recommended,

  // ┐┐ Project-wide language options
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,   // process, __dirname, Buffer, etc.
      },
    },
    rules: {
      // Surface unused code; allow intentional _-prefixed args / vars
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // console.log is noisy in a library/server; warn, sllow warn/error
      'no-console': ['warn', { allow: ['warn', 'error']}],

      // Prefer explicit return types on exported functions
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // No floating promises -- await or void-cast them
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // ┐┐ Test files: relax a few rules
  {
    files: ['tests/**', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      // Test helpers often use `any` for flexibility
      '@typescript-eslint/no-explicit-any': 'off',
      // Floating promises are common in test setup/teardown
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  // ┐┐ MUST be last: disable rules that conflict with Prettier
  prettier,
);
