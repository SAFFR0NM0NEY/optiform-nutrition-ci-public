import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_COLLISION_MESSAGE,
  canLinkGoogle,
  canUnlinkGoogle,
  googleAuthEnabled,
  normalizeAuthProviders,
  providerLabel,
} from './providerIdentity';
import { userStorageKey } from '../account/userStorage';

describe('P26 provider identity helpers', () => {
  it('normalizes password and Google, deduplicates, and ignores unknown providers', () => {
    expect(normalizeAuthProviders(['google.com', 'password', 'google.com', 'github.com'])).toEqual([
      'google.com',
      'password',
    ]);
  });
  it('allows password-only linking and password plus Google unlinking', () => {
    expect(canLinkGoogle(['password'])).toBe(true);
    expect(canUnlinkGoogle(['password', 'google.com'])).toBe(true);
  });
  it('blocks Google-only unlink and already-linked linking', () => {
    expect(canUnlinkGoogle(['google.com'])).toBe(false);
    expect(canLinkGoogle(['google.com'])).toBe(false);
  });
  it('provides bounded labels and collision recovery copy', () => {
    expect(providerLabel('password')).toBe('Email/Password');
    expect(providerLabel('google.com')).toBe('Google');
    expect(ACCOUNT_COLLISION_MESSAGE).toMatch(/existing method.*link Google/i);
  });
  it('requires the explicit build flag', () => {
    vi.stubEnv('VITE_ENABLE_GOOGLE_AUTH', 'false');
    expect(googleAuthEnabled()).toBe(false);
    vi.stubEnv('VITE_ENABLE_GOOGLE_AUTH', 'true');
    expect(googleAuthEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
  it('keeps UID-scoped storage namespaces identical across provider linking', () => {
    const before = { uid: 'athlete-a', providers: ['password'] };
    const after = { uid: 'athlete-a', providers: ['password', 'google.com'] };
    expect(userStorageKey(before.uid, 'notifications')).toBe(
      userStorageKey(after.uid, 'notifications'),
    );
    expect(userStorageKey(before.uid, 'notification-preferences')).toBe(
      userStorageKey(after.uid, 'notification-preferences'),
    );
    expect(userStorageKey(before.uid, 'onboarding-profile')).toBe(
      userStorageKey(after.uid, 'onboarding-profile'),
    );
  });
});
