import '@testing-library/jest-dom';

// Required for React 18 async act() to work correctly in jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock ResizeObserver for jsdom (recharts etc.)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Reset localStorage between every test to avoid state leaking
beforeEach(() => {
  localStorage.clear();
});

