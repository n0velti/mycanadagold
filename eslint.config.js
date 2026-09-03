// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Deno Edge Functions are type-checked by the Supabase CLI (`supabase functions serve`).
    ignores: ['dist/*', 'supabase/functions/**'],
  },
  {
    files: ['scripts/**/*.js', 'metro.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        console: 'readonly',
      },
    },
  },
]);
