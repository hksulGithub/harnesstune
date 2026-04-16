module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.m?js$': ['ts-jest', { useESM: false }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(d3-hierarchy)/)',
  ],
  moduleNameMapper: { '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts' },
};
