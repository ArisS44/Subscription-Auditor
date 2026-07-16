import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOnboarding } from './useOnboarding';
import { readProgress } from './onboarding-state';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render() {
  return renderHook(() => useOnboarding('token'), { wrapper });
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('useOnboarding navigation', () => {
  it('starts at welcome and marks the flow entered', () => {
    const { result } = render();
    expect(result.current.step).toBe('welcome');
    expect(result.current.stepIndex).toBe(0);
    expect(readProgress().entered).toBe(true);
  });

  it('advances and retreats through steps, persisting position', () => {
    const { result } = render();
    act(() => result.current.goNext());
    expect(result.current.step).toBe('method');
    expect(readProgress().stepIndex).toBe(1);

    act(() => result.current.goBack());
    expect(result.current.step).toBe('welcome');
  });

  it('does not advance past the last step or before the first', () => {
    const { result } = render();
    act(() => result.current.goBack());
    expect(result.current.stepIndex).toBe(0);
    for (let i = 0; i < 20; i++) act(() => result.current.goNext());
    expect(result.current.stepIndex).toBe(result.current.stepCount - 1);
    expect(result.current.step).toBe('done');
  });

  it('records the chosen method and advances to setup in one step', () => {
    const { result } = render();
    act(() => result.current.goNext()); // -> method
    act(() => result.current.chooseMethod('manual'));
    expect(result.current.step).toBe('setup');
    expect(result.current.method).toBe('manual');
    expect(readProgress().method).toBe('manual');
  });

  it('resumes from the persisted step on a fresh mount', () => {
    const first = render();
    act(() => first.result.current.goNext());
    act(() => first.result.current.goNext());
    first.unmount();

    const second = render();
    expect(second.result.current.step).toBe('setup');
  });

  it('complete() PATCHes onboarding_completed and clears local progress', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ onboarding_completed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = render();
    act(() => result.current.goNext());
    await act(async () => {
      await result.current.complete();
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      expect(String(call[0])).toContain('/me');
      expect((call[1] as RequestInit).method).toBe('PATCH');
      expect((call[1] as RequestInit).body).toContain('onboarding_completed');
    });
    // Local progress wiped so a returning user isn't mid-flow anymore.
    expect(readProgress().entered).toBe(false);
  });
});
