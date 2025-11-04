/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        module: {
          type: 'commonjs',
        },
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            tsx: true,
            decorators: false,
          },
          transform: {
            react: {
              runtime: 'automatic',
              development: process.env.NODE_ENV === 'test',
            },
          },
        },
      },
    ],
  },
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    '^@/components/TO BE REFACTORED/tool-dispatcher$': '<rootDir>/tests/__mocks__/virtual-tool-dispatcher.ts',
    '^@tldraw/tldraw$': '<rootDir>/tests/__mocks__/tldraw-stub.ts',
    '^@custom-ai/react$': '<rootDir>/tests/__mocks__/custom-ai-react.ts',
    '^react-markdown$': '<rootDir>/tests/__mocks__/react-markdown.tsx',
    '^nanoid$': '<rootDir>/tests/__mocks__/nanoid-stub.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^.+\\.(css|less|scss)$': '<rootDir>/tests/__mocks__/styleMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/tests/'],
};
