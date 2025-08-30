/**
 * ESLint configuration for the Next.js application.
 *
 * This configuration file sets up ESLint with the following features:
 * - Next.js core web vitals rules
 * - TypeScript support
 * - React hooks rules
 * - React best practices
 * - React performance best practices
 * - React accessibility best practices
 */

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default eslintConfig;
