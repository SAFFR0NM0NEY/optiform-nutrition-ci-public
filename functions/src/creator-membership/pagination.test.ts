import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  pageActiveMembershipPostRecords,
  parseMembershipPage,
  type ActiveMembershipPostRecord,
} from './pagination.js';

const creatorId = 'creator-pagination';
const id = (suffix: string) =>
  `creator-membership-post-00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const post = (
  suffix: string,
  millis: number,
  extra: Record<string, unknown> = {},
): ActiveMembershipPostRecord => {
  const postId = id(suffix);
  return {
    id: postId,
    data: {
      schemaVersion: 1,
      contractVersion: 'creator-membership-post-v1',
      creatorId,
      postId,
      ownerUid: 'owner_uid',
      title: `Post ${suffix}`,
      body: 'Safe body.',
      status: 'active',
      createdAt: Timestamp.fromMillis(millis),
      updatedAt: Timestamp.fromMillis(millis),
      removedAt: null,
      ...extra,
    },
  };
};
const decoded = (cursor: string) => {
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
    createdAt: number;
    postId: string;
  };
  return { createdAt: Timestamp.fromMillis(value.createdAt), postId: value.postId };
};

describe('active creator membership pagination', () => {
  it('pages the complete active set without tombstone crowding or duplicates', () => {
    const active = [post('1', 1), post('2', 2), post('3', 3), post('4', 4)];
    const first = pageActiveMembershipPostRecords(active, creatorId, null, 2);
    const second = pageActiveMembershipPostRecords(active, creatorId, decoded(first.cursor!), 2);
    expect(first.items.map((item) => item.postId)).toEqual([id('4'), id('3')]);
    expect(second.items.map((item) => item.postId)).toEqual([id('2'), id('1')]);
    expect(second.cursor).toBeNull();
  });

  it('sorts equal timestamps by descending post ID across a page boundary', () => {
    const active = [post('1', 10), post('3', 10), post('2', 10)];
    const first = pageActiveMembershipPostRecords(active, creatorId, null, 2);
    const second = pageActiveMembershipPostRecords(active, creatorId, decoded(first.cursor!), 2);
    expect([...first.items, ...second.items].map((item) => item.postId)).toEqual([
      id('3'),
      id('2'),
      id('1'),
    ]);
  });

  it('continues structurally when the cursor post is removed and ignores a newer insertion', () => {
    const initial = [post('1', 1), post('2', 2), post('3', 3), post('4', 4)];
    const first = pageActiveMembershipPostRecords(initial, creatorId, null, 2);
    const changed = [post('1', 1), post('2', 2), post('5', 5)];
    const second = pageActiveMembershipPostRecords(changed, creatorId, decoded(first.cursor!), 2);
    expect(second.items.map((item) => item.postId)).toEqual([id('2'), id('1')]);
  });

  it('allows 250 active records and fails closed at 251', () => {
    const records = Array.from({ length: 251 }, (_, index) => post(String(index), index));
    expect(
      pageActiveMembershipPostRecords(records.slice(0, 250), creatorId, null, 50).items,
    ).toHaveLength(50);
    expect(() => pageActiveMembershipPostRecords(records, creatorId, null, 50)).toThrow(
      'post-cap-invalid',
    );
  });

  it.each([
    { creatorId: 'wrong' },
    { postId: id('999') },
    { createdAt: 'not-a-timestamp' },
    { extraServerField: true },
  ])('fails the whole page for malformed active state', (extra) => {
    expect(() =>
      pageActiveMembershipPostRecords([post('1', 1, extra)], creatorId, null, 20),
    ).toThrow('post-record-invalid');
  });

  it('rejects malformed or extra-field cursors', () => {
    for (const value of [
      { createdAt: 1.5, postId: id('1') },
      { createdAt: 1, postId: 'bad' },
      { createdAt: 1, postId: id('1'), uid: 'leak' },
    ]) {
      const cursor = Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(() => parseMembershipPage({ creatorId, cursor, limit: 20 })).toThrow(
        'invalid-request',
      );
    }
  });
});
