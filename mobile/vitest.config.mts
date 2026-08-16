import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure logic only — date maths, formatters, selectors.
 *
 * Component rendering is deliberately out of scope: it needs jest-expo and a
 * native mock layer, which is a much larger setup than the value it would add
 * right now. Anything imported by a test here must be free of react-native
 * imports so it runs under plain Node.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', '.expo/**', 'android/**', 'ios/**'],
  },
});
