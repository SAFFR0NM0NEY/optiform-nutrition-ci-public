import { Timestamp } from 'firebase-admin/firestore';
import {
  CREATOR_MEMBERSHIP_POST_CONTRACT,
  asRecord,
  cleanText,
  exactPayload,
  type RecordValue,
} from './contracts.js';

export const validMembershipPostId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^creator-membership-post-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const activePostKeys = [
  'body',
  'contractVersion',
  'createdAt',
  'creatorId',
  'ownerUid',
  'postId',
  'removedAt',
  'schemaVersion',
  'status',
  'title',
  'updatedAt',
];

export type ActiveMembershipPostRecord = { id: string; data: RecordValue };

export const parseMembershipPage = (payload: unknown, owner = false) => {
  const allowed = owner ? ['cursor', 'limit'] : ['creatorId', 'cursor', 'limit'];
  if (!exactPayload(payload, allowed)) throw new Error('invalid-request');
  const value = asRecord(payload),
    limit = value.limit === null ? 20 : Number(value.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid-request');
  let cursor: { createdAt: Timestamp; postId: string } | null = null;
  if (value.cursor !== null) {
    try {
      const decoded = JSON.parse(
        Buffer.from(String(value.cursor), 'base64url').toString(),
      ) as RecordValue;
      if (
        !exactPayload(decoded, ['createdAt', 'postId']) ||
        !Number.isFinite(decoded.createdAt) ||
        !Number.isInteger(decoded.createdAt) ||
        !validMembershipPostId(decoded.postId)
      )
        throw new Error();
      cursor = {
        createdAt: Timestamp.fromMillis(decoded.createdAt as number),
        postId: decoded.postId as string,
      };
    } catch {
      throw new Error('invalid-request');
    }
  }
  return { value, limit, cursor };
};

export function pageActiveMembershipPostRecords(
  records: ActiveMembershipPostRecord[],
  creatorId: string,
  cursor: { createdAt: Timestamp; postId: string } | null,
  limit: number,
) {
  if (records.length > 250) throw new Error('post-cap-invalid');
  const validated = records.map(({ id, data }) => {
    if (
      Object.keys(data).sort().join('|') !== activePostKeys.join('|') ||
      data.schemaVersion !== 1 ||
      data.contractVersion !== CREATOR_MEMBERSHIP_POST_CONTRACT ||
      data.creatorId !== creatorId ||
      data.postId !== id ||
      !validMembershipPostId(id) ||
      typeof data.ownerUid !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(data.ownerUid) ||
      data.status !== 'active' ||
      data.removedAt !== null ||
      !(data.createdAt instanceof Timestamp) ||
      !(data.updatedAt instanceof Timestamp)
    )
      throw new Error('post-record-invalid');
    cleanText(data.title, 1, 100);
    cleanText(data.body, 1, 4000);
    return { id, data, createdAt: data.createdAt as Timestamp };
  });
  validated.sort(
    (left, right) =>
      right.createdAt.toMillis() - left.createdAt.toMillis() || right.id.localeCompare(left.id),
  );
  const eligible = cursor
    ? validated.filter(
        (item) =>
          item.createdAt.toMillis() < cursor.createdAt.toMillis() ||
          (item.createdAt.toMillis() === cursor.createdAt.toMillis() && item.id < cursor.postId),
      )
    : validated;
  const page = eligible.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ id, data, createdAt }) => ({
      schemaVersion: 1,
      contractVersion: CREATOR_MEMBERSHIP_POST_CONTRACT,
      creatorId,
      postId: id,
      title: String(data.title),
      body: String(data.body),
      status: 'active' as const,
      createdAt: createdAt.toDate().toISOString(),
    })),
    cursor:
      eligible.length > limit && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.createdAt.toMillis(), postId: last.id }),
          ).toString('base64url')
        : null,
  };
}
