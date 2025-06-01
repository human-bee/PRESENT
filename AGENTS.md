# AGENTS.md

## Overview

This repository is a Next.js monorepo for PRESENT, featuring AI-driven chat, canvas, and voice components. It uses TypeScript, React, and integrates with Tambo AI and LiveKit.

## Development Environment

- **Node.js package manager:** Use `pnpm` for all dependency management and scripts.
- **TypeScript:** All source code and tests are written in TypeScript.
- **Jest:** Used for unit and integration testing.
- **ESLint:** Used for linting, with Next.js configuration.
- **Tambo AI SDK:** Both `@tambo-ai/react` and `@tambo-ai/typescript-sdk` are required for development and testing.

## Environment Variables

Set the following environment variables for local development and testing. Use the **Secrets** section for sensitive values in remote environments.

```env
NEXT_PUBLIC_TAMBO_API_KEY=your-tambo-api-key
NEXT_PUBLIC_LK_TOKEN_ENDPOINT=/api/token
NEXT_PUBLIC_LK_SERVER_URL=your-livekit-server-url
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
LIVEKIT_URL=your-livekit-server-url
```

## Common Commands

| Task         | Command                | Notes                                      |
|--------------|------------------------|--------------------------------------------|
| **Dev**      | `pnpm dev`             | Starts Next.js in development mode         |
| **Build**    | `pnpm build`           | Builds the Next.js app                     |
| **Start**    | `pnpm start`           | Runs the production build                  |
| **Test**     | `pnpm test`            | Runs Jest tests (see below for details)    |
| **Lint**     | `pnpm lint`            | Runs ESLint with Next.js config            |

## Testing Instructions

- **Run all tests:**  
  ```bash
  pnpm test
  ```
- **Jest configuration:**  
  - Uses `ts-jest` and `jest-environment-jsdom` for React/TypeScript.
  - Global setup in `jest.setup.js` (includes Tambo AI SDK shims and jest-dom).
  - Babel config for tests in `babel.config.test.js`.
- **Required dependencies:**  
  - Ensure `@tambo-ai/typescript-sdk` is installed (devDependency).
  - If missing, add with:  
    ```bash
    pnpm add -D @tambo-ai/typescript-sdk
    ```

## Linting Instructions

- **Run linter:**  
  ```bash
  pnpm lint
  ```
- **ESLint config:**  
  - Uses Next.js ESLint configuration.
  - Fix lint errors before submitting code.

## Build Instructions

- **Build the app:**  
  ```bash
  pnpm build
  ```

## Contribution Guidelines

- **Write and update tests** for any code you change.
- **Fix all lint and type errors** before submitting.
- **Document any new environment variables** in this file.
- **Use clear, descriptive commit and PR messages.**

## Pull Request Instructions

- Title format: `[<project_name>] <Title>`
- Ensure all tests and lints pass before requesting review.

---

**If you are a software agent (e.g., Codex):**
- Use the commands above to validate your changes.
- Install all dependencies in the setup script before network access is disabled.
- Reference this file for environment variables and test/lint/build instructions.
