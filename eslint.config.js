import tsPlugin from 'typescript-eslint'

export default tsPlugin.config(
  { ignores: ['dist/', 'packages/core-wasm/pkg/'] },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
)
