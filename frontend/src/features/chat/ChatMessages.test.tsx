import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { ChatMessages } from './ChatMessages';
import type { ChatFailureReason, PendingTurn } from './types';

// The chat surface has three rules worth pinning down: a failed turn shows
// localized copy chosen from the backend's machine tag (never the backend's own
// English string), a turn may invoke several tools and must show them all in
// order, and no internal tool-registry name may ever reach the screen.

function turn(overrides: Partial<PendingTurn> = {}): PendingTurn {
  return {
    userContent: 'How much am I spending?',
    assistantContent: '',
    structured: [],
    toolNames: [],
    errorReason: null,
    streaming: true,
    ...overrides,
  };
}

function renderPending(pending: PendingTurn) {
  return render(
    <ChatMessages messages={[]} pending={pending} loading={false} onExampleSelect={() => {}} />,
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('turn failures', () => {
  const reasons: ChatFailureReason[] = [
    'rate',
    'user_daily',
    'global_daily',
    'rate_limited',
    'llm_error',
    'not_found',
    'network',
  ];

  it.each(reasons)('renders localized copy for reason "%s" in both locales', async (reason) => {
    for (const lng of ['en', 'el'] as const) {
      await i18n.changeLanguage(lng);
      const { unmount } = renderPending(turn({ errorReason: reason, streaming: false }));

      const status = screen.getByRole('status');
      // A resolved translation, not a raw key echoed back by i18next.
      expect(status.textContent?.trim()).not.toBe('');
      expect(status.textContent).not.toContain('chat.error.');
      unmount();
    }
  });

  it('gives each reason its own distinct message', () => {
    const seen = reasons.map((reason) => {
      const { unmount } = renderPending(turn({ errorReason: reason, streaming: false }));
      const text = screen.getByRole('status').textContent ?? '';
      unmount();
      return text;
    });
    expect(new Set(seen).size).toBe(reasons.length);
  });

  it('reads a transient failure as retriable and a hard failure as an error', () => {
    const { unmount } = renderPending(turn({ errorReason: 'rate_limited', streaming: false }));
    expect(screen.getByRole('status').className).toContain('text-muted-foreground');
    unmount();

    renderPending(turn({ errorReason: 'llm_error', streaming: false }));
    expect(screen.getByRole('status').className).toContain('text-destructive');
  });

  it('never shows the backend provider wording verbatim', () => {
    const { container } = renderPending(turn({ errorReason: 'llm_error', streaming: false }));
    expect(container.textContent).not.toContain('LLM');
    expect(container.textContent).not.toContain('provider');
  });
});

describe('multi-tool turns', () => {
  it('renders every tool of a turn, in arrival order', () => {
    renderPending(turn({ toolNames: ['get_analytics', 'render_table'] }));

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0].textContent).toBe(i18n.t('chat.tool.get_analytics'));
    expect(steps[1].textContent).toBe(i18n.t('chat.tool.render_table'));
  });

  it('does not leak internal tool-registry names', () => {
    const { container } = renderPending(turn({ toolNames: ['get_analytics', 'render_table'] }));
    expect(container.textContent).not.toContain('get_analytics');
    expect(container.textContent).not.toContain('render_table');
  });

  it('falls back to neutral copy for a tool it has no label for', () => {
    renderPending(turn({ toolNames: ['some_future_tool'] }));
    const step = screen.getByRole('listitem');
    expect(step.textContent).toBe(i18n.t('chat.tool.fallback'));
    expect(step.textContent).not.toContain('some_future_tool');
  });

  it('counts every structured payload a turn produced', () => {
    renderPending(
      turn({
        assistantContent: 'Here you go.',
        structured: [{ kind: 'chart' }, { kind: 'table' }],
        streaming: false,
      }),
    );
    expect(
      screen.getByText(i18n.t('chat.structuredPlaceholder', { count: 2 })),
    ).toBeInTheDocument();
  });
});

describe('empty state', () => {
  function renderEmpty(onExampleSelect: (prompt: string) => void = () => {}) {
    return render(
      <ChatMessages
        messages={[]}
        pending={null}
        loading={false}
        onExampleSelect={onExampleSelect}
      />,
    );
  }

  it('offers example prompts and sends the one clicked', async () => {
    const sent: string[] = [];
    renderEmpty((prompt) => sent.push(prompt));

    const prompts = screen.getAllByRole('button');
    expect(prompts).toHaveLength(3);

    await userEvent.click(prompts[0]);
    expect(sent).toEqual([i18n.t('chat.empty.examples.monthly')]);
  });

  it('localizes the example prompts', async () => {
    await i18n.changeLanguage('el');
    renderEmpty();
    expect(screen.getByText(i18n.t('chat.empty.examples.cutBack'))).toBeInTheDocument();
    // Guard against the Greek locale silently falling back to the English copy.
    expect(screen.queryByText('Which subscriptions could I cut back?')).not.toBeInTheDocument();
  });
});

describe('history', () => {
  it('shows the assistant reply and the user turn together', () => {
    renderPending(turn({ assistantContent: 'You spend **€42** a month.', streaming: false }));
    expect(screen.getByText('How much am I spending?')).toBeInTheDocument();
    const strong = document.querySelector('.chat-markdown strong');
    expect(within(strong as HTMLElement).getByText('€42')).toBeInTheDocument();
  });
});
