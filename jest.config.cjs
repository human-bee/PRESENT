/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    '^server-only$': '<rootDir>/tests/__mocks__/server-only.ts',
    '^@/components/TO BE REFACTORED/tool-dispatcher$': '<rootDir>/tests/__mocks__/virtual-tool-dispatcher.ts',
    '^@tldraw/tldraw$': '<rootDir>/tests/__mocks__/tldraw-stub.ts',
    '^@tldraw/fairy-shared$': '<rootDir>/src/vendor/tldraw-fairy/fairy-shared/index.ts',
    '^@tldraw/fairy-shared/(.*)$': '<rootDir>/src/vendor/tldraw-fairy/fairy-shared/$1',
    '^@custom-ai/react$': '<rootDir>/tests/__mocks__/custom-ai-react.ts',
    '^react-markdown$': '<rootDir>/tests/__mocks__/react-markdown.tsx',
    '^nanoid$': '<rootDir>/tests/__mocks__/nanoid-stub.ts',
    '^@openai/apps-sdk-ui/components/(.*)$': '<rootDir>/tests/__mocks__/openai-apps-sdk-ui-components.tsx',
    '^@present/contracts$': '<rootDir>/packages/contracts/src/index.ts',
    '^@present/contracts/(.*)$': '<rootDir>/packages/contracts/src/$1',
    '^@present/kernel$': '<rootDir>/services/kernel/src/index.ts',
    '^@present/kernel/(.*)$': '<rootDir>/services/kernel/src/$1',
    '^@present/codex-adapter$': '<rootDir>/services/codex-adapter/src/index.ts',
    '^@present/codex-adapter/(.*)$': '<rootDir>/services/codex-adapter/src/$1',
    '^@present/ui$': '<rootDir>/packages/ui/src/index.ts',
    '^@present/ui/(.*)$': '<rootDir>/packages/ui/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^.+\\.(css|less|scss)$': '<rootDir>/tests/__mocks__/styleMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/tests/'],
};
