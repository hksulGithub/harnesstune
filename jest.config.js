module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      },
    }],
    '^.+\\.m?js$': ['ts-jest', { useESM: false }],
  },
  moduleNameMapper: {
    '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
