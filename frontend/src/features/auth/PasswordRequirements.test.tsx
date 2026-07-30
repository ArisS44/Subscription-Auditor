import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { PasswordRequirements } from './PasswordRequirements';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('PasswordRequirements', () => {
  it('lists every rule up front, before the user has failed anything', () => {
    render(<PasswordRequirements value="" />);
    expect(screen.getByText(i18n.t('auth.passwordPolicy.length'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('auth.passwordPolicy.letter'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('auth.passwordPolicy.number'))).toBeInTheDocument();
  });

  it('conveys met/unmet as text, not by colour and icon alone', () => {
    // "abcdefgh" satisfies length and letter but has no digit.
    render(<PasswordRequirements value="abcdefgh" />);
    expect(screen.getAllByText(i18n.t('auth.passwordPolicy.met'))).toHaveLength(2);
    expect(screen.getAllByText(i18n.t('auth.passwordPolicy.notMet'))).toHaveLength(1);
  });

  it('marks every rule met once the password satisfies the policy', () => {
    render(<PasswordRequirements value="abcdefg1" />);
    expect(screen.getAllByText(i18n.t('auth.passwordPolicy.met'))).toHaveLength(3);
    expect(screen.queryByText(i18n.t('auth.passwordPolicy.notMet'))).not.toBeInTheDocument();
  });

  it('renders the rules in Greek too', async () => {
    await i18n.changeLanguage('el');
    render(<PasswordRequirements value="" />);
    expect(screen.getByText('Τουλάχιστον 8 χαρακτήρες')).toBeInTheDocument();
    expect(screen.getByText('Τουλάχιστον ένα γράμμα')).toBeInTheDocument();
  });
});
