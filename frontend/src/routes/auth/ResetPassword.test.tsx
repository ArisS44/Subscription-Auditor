import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import ResetPassword from './ResetPassword';

const updateUser = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser: (...args: unknown[]) => updateUser(...args) } },
  setRememberMe: vi.fn(),
}));

function renderResetPassword() {
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  updateUser.mockReset();
  updateUser.mockResolvedValue({ error: null });
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('ResetPassword password policy', () => {
  it('shows the same requirements checklist as signup', () => {
    renderResetPassword();
    expect(screen.getByText(i18n.t('auth.passwordPolicy.length'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('auth.passwordPolicy.letter'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('auth.passwordPolicy.number'))).toBeInTheDocument();
  });

  // Each of these was accepted by the old bare `minLength={6}` field, and the
  // server (minimum 8) would have rejected the short one after submission.
  it.each([
    ['too short', 'abc123'],
    ['no letter', '12345678'],
    ['no digit', 'abcdefgh'],
  ])('rejects a password that is %s, before submitting', async (_label, password) => {
    const user = userEvent.setup();
    renderResetPassword();

    await user.type(screen.getByLabelText(i18n.t('auth.newPassword')), password);
    await user.click(screen.getByRole('button', { name: i18n.t('auth.resetPassword.submit') }));

    await waitFor(() => expect(updateUser).not.toHaveBeenCalled());
    expect(screen.queryByText(i18n.t('auth.resetPassword.success'))).not.toBeInTheDocument();
  });

  it('completes the reset for a compliant password', async () => {
    const user = userEvent.setup();
    renderResetPassword();

    await user.type(screen.getByLabelText(i18n.t('auth.newPassword')), 'correct1horse');
    await user.click(screen.getByRole('button', { name: i18n.t('auth.resetPassword.submit') }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'correct1horse' }));
    expect(await screen.findByText(i18n.t('auth.resetPassword.success'))).toBeInTheDocument();
  });

  it('accepts a Greek-letter password', async () => {
    // The policy is Unicode-aware on purpose: this app is bilingual, and the
    // server's policy is letters-agnostic, so an ASCII-only rule here would refuse
    // a password the server would happily take.
    const user = userEvent.setup();
    renderResetPassword();

    await user.type(screen.getByLabelText(i18n.t('auth.newPassword')), 'κωδικός12');
    await user.click(screen.getByRole('button', { name: i18n.t('auth.resetPassword.submit') }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'κωδικός12' }));
  });

  it("surfaces the server's own password rejection instead of the expired-link message", async () => {
    // Supabase stays the enforcement point; if its policy rejects a password the
    // client accepted, saying "the link may have expired" would send the user off
    // requesting another link for no reason.
    updateUser.mockResolvedValue({
      error: { name: 'AuthApiError', message: 'weak', status: 422, code: 'weak_password' },
    });
    const user = userEvent.setup();
    renderResetPassword();

    await user.type(screen.getByLabelText(i18n.t('auth.newPassword')), 'correct1horse');
    await user.click(screen.getByRole('button', { name: i18n.t('auth.resetPassword.submit') }));

    expect(await screen.findByText(i18n.t('auth.errors.weakPassword'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('auth.resetPassword.error'))).not.toBeInTheDocument();
  });
});
