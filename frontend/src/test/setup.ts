import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-registers its cleanup when Vitest runs with
// `globals: true`; this project keeps globals off (explicit imports), so we
// unmount between tests ourselves. Without this, every render accumulates in the
// same document and queries match elements left over from earlier tests.
afterEach(cleanup);

// jsdom implements no layout engine, so `scrollIntoView` is simply absent from
// its Element prototype — any component that keeps content in view (the chat
// message list) would throw on mount. Stub it so those effects are inert under
// test rather than fatal.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
