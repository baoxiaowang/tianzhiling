module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          isolatedModules: true,
          strict: true,
          types: ['jest'],
        },
      },
    ],
  },
}
