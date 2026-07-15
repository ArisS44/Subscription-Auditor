import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { ConversationSidebar } from './ConversationSidebar';
import type { Conversation } from './types';

// A conversation is auto-titled from its first message; a row without a title is
// the rare case where titling hasn't landed or failed. Those fall back to their
// creation time, which must stay distinct per row and localized.

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    user_id: 'u1',
    title: null,
    created_at: '2026-07-15T14:32:00Z',
    updated_at: '2026-07-15T14:32:00Z',
    ...overrides,
  };
}

function renderSidebar(conversations: Conversation[]) {
  return render(
    <ConversationSidebar
      conversations={conversations}
      activeId={null}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      loading={false}
    />,
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('conversation rows', () => {
  it('shows the title when the conversation has one', () => {
    renderSidebar([conversation({ title: 'Cancel my Adobe sub' })]);
    expect(screen.getByText('Cancel my Adobe sub')).toBeInTheDocument();
  });

  it('falls back to a timestamp that keeps untitled rows distinguishable', () => {
    renderSidebar([
      conversation({ id: 'a', created_at: '2026-07-15T14:32:00Z' }),
      conversation({ id: 'b', created_at: '2026-07-14T09:05:00Z' }),
    ]);

    const labels = screen.getAllByRole('button', { name: /Chat ·/ }).map((b) => b.textContent);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
  });

  it('never labels a row with the new-chat wording', () => {
    renderSidebar([conversation()]);
    // The row must not read as the "New chat" action sitting right above it.
    const rows = screen.getAllByRole('button', { name: /Chat ·/ });
    expect(rows[0].textContent).not.toContain(i18n.t('chat.sidebar.new'));
  });

  it('localizes the fallback label', async () => {
    await i18n.changeLanguage('el');
    renderSidebar([conversation()]);
    expect(screen.getByRole('button', { name: /Συνομιλία ·/ })).toBeInTheDocument();
  });
});
