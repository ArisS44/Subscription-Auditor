import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, isPasswordAcceptable, unmetPasswordRules } from './password-policy';

function unmetIds(value: string) {
  return unmetPasswordRules(value).map((rule) => rule.id);
}

describe('password policy', () => {
  it('accepts a password meeting every rule', () => {
    expect(isPasswordAcceptable('correct1horse')).toBe(true);
    expect(unmetIds('correct1horse')).toEqual([]);
  });

  it('reports each unmet rule separately rather than one catch-all failure', () => {
    // Short, no letters, no digits — every rule fails at once.
    expect(unmetIds('___')).toEqual(['length', 'letter', 'number']);
    // Long and lettered but no digit: only that rule is reported.
    expect(unmetIds('passwordpassword')).toEqual(['number']);
    // Long and numeric but no letter.
    expect(unmetIds('1234567890')).toEqual(['letter']);
  });

  it('enforces the length boundary exactly', () => {
    const sevenChars = 'abcdef1';
    expect(sevenChars).toHaveLength(PASSWORD_MIN_LENGTH - 1);
    expect(unmetIds(sevenChars)).toEqual(['length']);
    expect(isPasswordAcceptable('abcdef12')).toBe(true);
  });

  it('counts Greek letters and non-ASCII digits as letters and numbers', () => {
    // The app is bilingual: a Greek-letter password is a letter password, so the
    // rules must not be ASCII-only.
    expect(isPasswordAcceptable('κωδικός1')).toBe(true);
    // 10 Greek letters, no digit — only the number rule should be outstanding.
    expect(unmetIds('κωδικόςμου')).toEqual(['number']);
  });

  it('treats an empty password as failing everything', () => {
    expect(isPasswordAcceptable('')).toBe(false);
    expect(unmetIds('')).toEqual(['length', 'letter', 'number']);
  });
});
