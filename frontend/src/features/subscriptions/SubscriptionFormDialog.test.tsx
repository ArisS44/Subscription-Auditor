import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { SubscriptionFormDialog } from './SubscriptionFormDialog';
import type { Subscription } from '@/hooks/useSubscriptions';

// The profile is only read for the reminder lead-time default.
vi.mock('@/hooks/useMe', () => ({ useMe: () => ({ data: { renewal_lead_days: 3 } }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(subscription?: Subscription) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SubscriptionFormDialog
        open
        onOpenChange={() => {}}
        accessToken="test-token"
        subscription={subscription}
      />
    </QueryClientProvider>,
  );
}

/** The price actually sent to the API on the last write call. */
function sentPrice(): unknown {
  const write = fetchMock.mock.calls.find((c) => {
    const method = (c[1] as RequestInit | undefined)?.method;
    return method === 'POST' || method === 'PATCH';
  });
  if (!write) throw new Error('no write request was made');
  return JSON.parse((write[1] as RequestInit).body as string).price;
}

// End-to-end through the real component: the input, react-hook-form, the zod
// resolver and the payload transform. A desktop keyboard can type the comma that
// an iOS decimal keypad forces on a European user, so everything downstream of
// that keystroke is reproducible here — only the keypad itself is not.
describe('SubscriptionFormDialog price entry', () => {
  it('accepts a comma-typed price and sends it to the API as a dot', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.name')), 'Netflix');
    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.price')), '7,99');
    await user.click(
      screen.getByRole('button', { name: i18n.t('subscriptions.form.submitCreate') }),
    );

    await waitFor(() => expect(sentPrice()).toBe('7.99'));
  });

  it('does not show a validation error for a comma price', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.name')), 'Netflix');
    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.price')), '7,99');
    await user.click(
      screen.getByRole('button', { name: i18n.t('subscriptions.form.submitCreate') }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Both the old failure and the ceiling trap it would have become.
    expect(screen.queryByText(i18n.t('subscriptions.form.errors.priceInvalid'))).toBeNull();
    expect(screen.queryByText(i18n.t('subscriptions.form.errors.priceTooLarge'))).toBeNull();
  });

  it('sends a dot-typed price unchanged', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.name')), 'Netflix');
    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.price')), '7.99');
    await user.click(
      screen.getByRole('button', { name: i18n.t('subscriptions.form.submitCreate') }),
    );

    await waitFor(() => expect(sentPrice()).toBe('7.99'));
  });

  it('normalises on the edit path too, not just create', async () => {
    const user = userEvent.setup();
    const existing = {
      id: 'sub-1',
      name: 'Netflix',
      category: null,
      price: '5.00',
      currency: 'EUR',
      billing_cycle: 'monthly',
      status: 'active',
      start_date: '2026-07-01',
      next_renewal_date: null,
      notes: null,
      manage_url: null,
      reminder_lead_days: null,
    } as unknown as Subscription;
    renderDialog(existing);

    const price = screen.getByLabelText(i18n.t('subscriptions.form.fields.price'));
    await user.clear(price);
    await user.type(price, '12,50');
    await user.click(screen.getByRole('button', { name: i18n.t('subscriptions.form.submitEdit') }));

    await waitFor(() => expect(sentPrice()).toBe('12.50'));
  });

  it('still blocks a price with two separators', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.name')), 'Netflix');
    await user.type(screen.getByLabelText(i18n.t('subscriptions.form.fields.price')), '1.234,56');
    await user.click(
      screen.getByRole('button', { name: i18n.t('subscriptions.form.submitCreate') }),
    );

    expect(
      await screen.findByText(i18n.t('subscriptions.form.errors.priceInvalid')),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
