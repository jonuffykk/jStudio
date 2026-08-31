import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  { ignores: ['out/**', '.next/**', 'src-tauri/**', 'node_modules/**'] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
      '@next/next/no-img-element': 'off',
    },
  },
]

export default config
