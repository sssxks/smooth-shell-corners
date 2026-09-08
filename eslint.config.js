import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {ignores: ['dist/**', 'node_modules/**']},
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'tests/**/*.js', 'tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2023,
            globals: {
                ...globals.es2021,
                ...globals.browser,
                global: 'readonly',
                ARGV: 'readonly',
                print: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
            'no-unused-vars': 'off',
            'no-empty': ['error', {allowEmptyCatch: true}],
            'prefer-const': 'warn',
        },
    },
);
