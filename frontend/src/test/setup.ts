import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// This jsdom build ships without Web Storage, so `localStorage`/`sessionStorage`
// are undefined under test even though every real browser has them. Provide a
// minimal in-memory implementation so storage-backed code (onboarding progress,
// language preference) runs as it would in a browser.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!(name in globalThis) || globalThis[name] == null) {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), writable: true });
  }
}

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
