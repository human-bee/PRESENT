module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom', // Use jsdom for React components
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    // Handle module aliases (if any, common in Next.js projects)
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock CSS imports
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // Mock Tambo AI SDK for testing
    '^@tambo-ai/(.*)$': '<rootDir>/__mocks__/tambo-ai.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // Optional: for global test setup
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json', // Ensure it uses the project's tsconfig
      useESM: true, // Tell ts-jest to use ESM
    }],
    '^.+\\.(js|jsx)$': 'babel-jest', // For JavaScript files
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@tambo-ai|@livekit)/)',
  ],
  // Ignore Next.js build directory
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};
