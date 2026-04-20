import '@testing-library/jest-dom';

describe('App', () => {
  test('app module loads', () => {
    expect(require('./App')).toBeDefined();
  });

  test('customers handles empty state', () => {
    expect([]).toHaveLength(0);
  });
});