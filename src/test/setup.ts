import '@testing-library/jest-dom';

// Required for React 18 async act() to work correctly in jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Reset localStorage between every test to avoid state leaking
beforeEach(() => {
  localStorage.clear();
});
