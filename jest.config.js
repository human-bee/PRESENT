module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom', // Use jsdom for React components
  moduleNameMapper: {
    // Handle module aliases (if any, common in Next.js projects)
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock CSS imports
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // Optional: for global test setup
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json', // Ensure it uses the project's tsconfig
      babelConfig: './babel.config.test.js', // Tell ts-jest to use babel.config.test.js for JSX
    }],
    '^.+\\.(js|jsx)$': 'babel-jest', // For JavaScript files
  },
  // Ignore Next.js build directory
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
};
