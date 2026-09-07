import { describe, expect, it } from 'vitest';
import {
  communityId,
  decodeCommunityCursor,
  encodeCommunityCursor,
  reactionOwnerKey,
  validCommentBody,
  validGroupDescription,
  validGroupName,
  validPostBody,
} from './contracts.js';

describe('P38C gym community contracts', () => {
  it('validates bounded plain text and rejects markup, links and controls', () => {
    expect(validGroupName('Training chat')).toBe(true);
    expect(validGroupDescription('')).toBe(true);
    expect(validPostBody('First line\nSecond line')).toBe(true);
    expect(validCommentBody('https://example.test')).toBe(false);
    expect(validPostBody('<b>unsafe</b>')).toBe(false);
    expect(validGroupName('bad\nname')).toBe(false);
  });
  it('creates server-shaped opaque IDs', () => {
    expect(communityId('post', '123e4567-e89b-42d3-a456-426614174000')).toBe(
      'gym-post-123e4567-e89b-42d3-a456-426614174000',
    );
  });
  it('uses a deterministic namespaced SHA-256 reaction owner key', () => {
    expect(reactionOwnerKey('uid-a')).toMatch(/^[a-f0-9]{64}$/);
    expect(reactionOwnerKey('uid-a')).toBe(reactionOwnerKey('uid-a'));
    expect(reactionOwnerKey('uid-a')).not.toContain('uid-a');
  });
  it('round-trips a safe cursor and rejects malformed cursors', () => {
    const cursor = { createdAt: '2026-09-06T10:00:00.000Z', id: 'gym-post-safe-id' };
    expect(decodeCommunityCursor(encodeCommunityCursor(cursor))).toEqual(cursor);
    expect(() => decodeCommunityCursor('bad')).toThrow('invalid-cursor');
  });
});
