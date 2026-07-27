import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { LeadTimeChips } from './LeadTimeChips';

// Stateful harness so the controlled custom input actually reflects changes,
// while `spy` still records every emitted value.
function Harness({ initial, spy }: { initial: number | null; spy: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <LeadTimeChips
      value={value}
      onChange={(v) => {
        spy(v);
        setValue(v);
      }}
      allowInherit
      inheritDays={3}
    />
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LeadTimeChips', () => {
  it('shows Inherit as active when the value is null', () => {
    render(<Harness initial={null} spy={vi.fn()} />);
    expect(screen.getByRole('button', { name: /default/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('emits the preset (an override) when a preset chip is clicked', async () => {
    const spy = vi.fn();
    render(<Harness initial={null} spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: '7' }));
    expect(spy).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole('button', { name: '7' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears back to inherit (null) from an override', async () => {
    const spy = vi.fn();
    render(<Harness initial={7} spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: /default/i }));
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it('opens a custom field and emits a clamped custom value', async () => {
    const spy = vi.fn();
    render(<Harness initial={null} spy={spy} />);
    // Opening custom from inherit seeds the default so the field is not empty.
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(spy).toHaveBeenLastCalledWith(3);

    const input = screen.getByLabelText(i18n.t('notifications.leadTime.customLabel'));
    fireEvent.change(input, { target: { value: '10' } });
    expect(spy).toHaveBeenLastCalledWith(10);
    // Out-of-range is clamped to the 0–30 bound (UX only; backend re-validates).
    fireEvent.change(input, { target: { value: '45' } });
    expect(spy).toHaveBeenLastCalledWith(30);
  });
});
