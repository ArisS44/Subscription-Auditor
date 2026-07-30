import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { readLanguageChoice } from '@/i18n/language-preference';
import { LanguageToggle } from './LanguageToggle';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('LanguageToggle', () => {
  it('switches the active language and records the click as an explicit choice', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle />);

    // Nothing is recorded until the visitor actually picks: a language merely
    // detected from the browser must never be written to the profile.
    expect(readLanguageChoice()).toBeNull();

    await user.click(screen.getByRole('button', { name: i18n.t('language.el') }));

    expect(i18n.language).toBe('el');
    expect(readLanguageChoice()).toBe('el');
  });

  it('marks the active language as pressed for assistive technology', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle />);

    const greek = screen.getByRole('button', { name: i18n.t('language.el') });
    expect(greek).toHaveAttribute('aria-pressed', 'false');

    await user.click(greek);

    // Re-queried by the now-Greek label, since the labels are themselves translated.
    expect(screen.getByRole('button', { name: i18n.t('language.el') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('resolves labels to strings rather than i18next namespace-collision fallbacks', () => {
    render(<LanguageToggle />);
    for (const label of [i18n.t('language.en'), i18n.t('language.el')]) {
      expect(label).not.toMatch(/returned an object/i);
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});
