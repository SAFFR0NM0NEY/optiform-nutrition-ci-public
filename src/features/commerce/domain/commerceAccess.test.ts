import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCommerceAccessSnapshot,
  commerceFoundationEnabled,
  commerceProductLabel,
} from './commerceAccess';

afterEach(() => vi.unstubAllEnvs());
describe('commerce client contract', () => {
  it('uses only the explicit default-off flag', () => {
    vi.stubEnv('VITE_ENABLE_COMMERCE_FOUNDATION', 'false');
    expect(commerceFoundationEnabled()).toBe(false);
    vi.stubEnv('VITE_ENABLE_COMMERCE_FOUNDATION', 'true');
    expect(commerceFoundationEnabled()).toBe(true);
  });
  it('validates the minimal snapshot and labels reserved product kinds', () => {
    const snapshot = {
      schemaVersion: 1,
      contractVersion: 'commerce-access-snapshot-v1',
      generatedAt: '2026-09-05T00:00:00Z',
      entitlements: [],
    };
    expect(() => assertCommerceAccessSnapshot(snapshot)).not.toThrow();
    expect(() =>
      assertCommerceAccessSnapshot({
        ...snapshot,
        entitlements: [{ entitlementKey: 'x', productKind: 'fake', status: 'active' }],
      }),
    ).toThrow();
    expect(commerceProductLabel('optiform-pro')).toBe('Optiform Pro');
  });
});
