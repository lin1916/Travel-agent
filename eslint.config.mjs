import parser from '@typescript-eslint/parser';

export default [{
  files: ['**/*.{js,mjs,ts,tsx}'],
  ignores: ['**/dist/**', '**/node_modules/**'],
  languageOptions: { parser },
}];
