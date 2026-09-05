import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (
  projectId !== 'demo-optiform-nutrition' ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error('Demo emulators required.');
const app = getApps()[0] ?? initializeApp({ projectId }),
  auth = getAuth(app),
  db = getFirestore(app),
  password = 'Test-password-123';
const owner = await principal('creator-owner@example.invalid'),
  other = await principal('creator-other@example.invalid'),
  moderator = await principal('creator-moderator@example.invalid', ['moderator']),
  admin = await principal('creator-admin@example.invalid', ['platform-admin']);
const creatorId = '0123456789ABCDEF',
  listingId = 'listing-public-1',
  versionId = 'publication-public-1',
  now = Timestamp.now();
await db.doc(`creatorAccounts/${owner.uid}`).set({
  schemaVersion: 1,
  contractVersion: 'creator-mode-v1',
  ownerUid: owner.uid,
  creatorId,
  status: 'active',
  createdAt: now,
  updatedAt: now,
});
await db.doc(`creatorPublicControls/${creatorId}`).set({
  schemaVersion: 1,
  contractVersion: 'creator-mode-v1',
  ownerUid: owner.uid,
  creatorId,
  createdAt: now,
  updatedAt: now,
});
await db.doc(`creatorPublicProfiles/${creatorId}`).set(profile('published', 'active'));
await db.doc(`creatorPublicationControls/${listingId}`).set({
  schemaVersion: 1,
  contractVersion: 'creator-program-publication-v1',
  ownerUid: owner.uid,
  creatorId,
  listingId,
  sourceProgramId: 'private-program',
  sourceVersionId: 'v1',
  currentPublicationVersion: 1,
  currentPublicVersionId: versionId,
  createdAt: now,
  updatedAt: now,
});
await db.doc(`creatorPublicListings/${listingId}`).set(listing('published', 'active'));
await db.doc(`creatorPublicListings/${listingId}/versions/${versionId}`).set({
  schemaVersion: 1,
  contractVersion: 'creator-program-publication-v1',
  publicationVersionId: versionId,
  creatorId,
  listingId,
  versionNumber: 1,
  snapshot: {
    schemaVersion: 1,
    contractVersion: 'creator-program-publication-v1',
    title: 'Safe programme',
    description: '',
    durationWeeks: 1,
    days: [],
  },
  snapshotHash: 'a'.repeat(64),
  publishedAt: now,
});
deny(await get(`creatorPublicProfiles/${creatorId}`));
allow(await get(`creatorPublicProfiles/${creatorId}`, other.token));
deny(await get(`creatorPublicControls/${creatorId}`, owner.token));
deny(await update(`creatorPublicControls/${creatorId}`, { ownerUid: other.uid }, other.token));
allow(await get(`creatorAccounts/${owner.uid}`, owner.token));
deny(await get(`creatorAccounts/${owner.uid}`, other.token));
allow(await get(`creatorPublicListings/${listingId}`, other.token));
allow(await get(`creatorPublicListings/${listingId}/versions/${versionId}`, other.token));
deny(await update(`creatorPublicProfiles/${creatorId}`, { displayName: 'Stolen' }, other.token));
deny(
  await update(`creatorPublicProfiles/${creatorId}`, { platformStatus: 'suspended' }, owner.token),
);
allow(
  await update(
    `creatorPublicProfiles/${creatorId}`,
    { platformStatus: 'suspended' },
    moderator.token,
  ),
);
allow(
  await update(`creatorPublicProfiles/${creatorId}`, { platformStatus: 'active' }, admin.token),
);
await db.doc(`creatorPublicProfiles/${creatorId}`).update({ status: 'draft' });
deny(await get(`creatorPublicProfiles/${creatorId}`, other.token));
allow(await get(`creatorPublicProfiles/${creatorId}`, owner.token));
await db.doc(`creatorPublicProfiles/${creatorId}`).update({ status: 'paused' });
deny(await get(`creatorPublicProfiles/${creatorId}`, other.token));
await db
  .doc(`creatorPublicProfiles/${creatorId}`)
  .update({ status: 'published', platformStatus: 'active' });
await db.doc(`creatorPublicListings/${listingId}`).update({ status: 'withdrawn' });
deny(await get(`creatorPublicListings/${listingId}`, other.token));
allow(await get(`creatorPublicListings/${listingId}`, owner.token));
await db
  .doc(`creatorPublicListings/${listingId}`)
  .update({ status: 'published', platformStatus: 'suspended' });
deny(await get(`creatorPublicListings/${listingId}`, other.token));
deny(
  await update(
    `creatorPublicListings/${listingId}/versions/${versionId}`,
    { snapshotHash: 'b'.repeat(64) },
    owner.token,
  ),
);
deny(await update(`creatorPublicListings/${listingId}`, { platformStatus: 'active' }, owner.token));
deny(await remove(`creatorPublicListings/${listingId}/versions/${versionId}`, owner.token));
deny(await update(`creatorPublicationControls/${listingId}`, { ownerUid: other.uid }, other.token));
assert.equal(
  'ownerUid' in (await db.doc(`creatorPublicProfiles/${creatorId}`).get()).data(),
  false,
);
assert.equal('price' in (await db.doc(`creatorPublicListings/${listingId}`).get()).data(), false);
console.log(
  'P34 creator rules verified: visibility, privacy, moderation, withdrawal, suspension and immutable versions passed.',
);
function profile(status, platformStatus) {
  return {
    schemaVersion: 1,
    contractVersion: 'creator-profile-v1',
    creatorId,
    displayName: 'Test Creator',
    bio: 'Synthetic creator profile.',
    specialties: ['strength'],
    socialLinks: [],
    status,
    platformStatus,
    createdAt: now,
    updatedAt: now,
  };
}
function listing(status, platformStatus) {
  return {
    schemaVersion: 1,
    contractVersion: 'creator-program-publication-v1',
    listingId,
    creatorId,
    title: 'Safe programme',
    summary: 'Synthetic preview.',
    status,
    platformStatus,
    currentVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  };
}
async function principal(email, roles = []) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password });
  }
  if (roles.length) await auth.setCustomUserClaims(user.uid, { optiformRoles: roles });
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return { uid: user.uid, token: (await response.json()).idToken };
}
async function request(method, path, token, fields) {
  return fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(fields ? { body: JSON.stringify({ fields: encode(fields) }) } : {}),
    },
  );
}
function get(path, token) {
  return request('GET', path, token);
}
function remove(path, token) {
  return request('DELETE', path, token);
}
async function update(path, changes, token) {
  const current = await db.doc(path).get();
  return request('PATCH', path, token, {
    ...current.data(),
    ...changes,
    updatedAt: Timestamp.now(),
  });
}
function encode(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, field(item)]));
}
function field(value) {
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: encode(value) } };
}
function allow(response) {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `expected allow, got ${response.status}`,
  );
}
function deny(response) {
  assert.ok(
    response.status === 401 || response.status === 403,
    `expected deny, got ${response.status}`,
  );
}
