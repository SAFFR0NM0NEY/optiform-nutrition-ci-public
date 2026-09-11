import { describe, expect, it, vi } from 'vitest';
import { creatorMembershipsEnabled } from './creatorMembership';
describe('creator membership flag', () => {
  it('defaults closed and opens explicitly', () => {
    vi.stubEnv('VITE_ENABLE_CREATOR_MEMBERSHIPS', 'false');
    expect(creatorMembershipsEnabled()).toBe(false);
    vi.stubEnv('VITE_ENABLE_CREATOR_MEMBERSHIPS', 'true');
    expect(creatorMembershipsEnabled()).toBe(true);
  });
});
