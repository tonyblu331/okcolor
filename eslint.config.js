import tsPlugin from 'typescript-eslint'

export default tsPlugin.config(
  { ignores: ['dist/', 'packages/core-wasm/pkg/'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'bench/**/*.ts'],
    languageOptions: {
      parser: tsPlugin.parser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin.plugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
)
