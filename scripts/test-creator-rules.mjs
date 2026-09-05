import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc as clientDoc,
  getFirestore as getClientFirestore,
  serverTimestamp,
  setLogLevel,
  writeBatch as clientWriteBatch,
} from 'firebase/firestore';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
setLogLevel('silent');
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
  newOwner = await principal('creator-new@example.invalid'),
  moderator = await principal('creator-moderator@example.invalid', ['moderator']),
  admin = await principal('creator-admin@example.invalid', ['platform-admin']);
const creatorId = '0123456789ABCDEF',
  listingId = 'listing-public-1',
  versionId = 'publication-public-1',
  now = Timestamp.now();
await seedProgram(owner.uid, 'program-owner', 'v1', 'Safe programme', 'Synthetic preview.', 4);
await seedProgram(other.uid, 'program-other', 'v1', 'Other programme', 'Other preview.', 6);
await db.doc(`athletes/${owner.uid}/programs/program-owner/versions/v2`).set({
  schemaVersion: 1,
  contractVersion: 'training-programs-v1',
  ownerUid: owner.uid,
  programId: 'program-mismatched',
  versionId: 'v2',
  versionNumber: 2,
  name: 'Mismatched programme',
  description: '',
  durationWeeks: 4,
  createdAt: now,
});
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
  sourceProgramId: 'program-owner',
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
  preview: {
    title: 'Safe programme',
    description: 'Synthetic preview.',
    durationWeeks: 4,
  },
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

const newCreatorId = '1111111111111111';
const ownerCreator = await clientFor('owner-client', owner.email);
const newCreator = await clientFor('new-owner-client', newOwner.email);
const enableBatch = clientWriteBatch(newCreator.db);
enableBatch.set(clientDoc(newCreator.db, 'creatorAccounts', newOwner.uid), {
  schemaVersion: 1,
  contractVersion: 'creator-mode-v1',
  ownerUid: newOwner.uid,
  creatorId: newCreatorId,
  status: 'active',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
enableBatch.set(clientDoc(newCreator.db, 'creatorPublicControls', newCreatorId), {
  schemaVersion: 1,
  contractVersion: 'creator-mode-v1',
  ownerUid: newOwner.uid,
  creatorId: newCreatorId,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
enableBatch.set(clientDoc(newCreator.db, 'creatorPublicProfiles', newCreatorId), {
  ...profile('draft', 'active'),
  creatorId: newCreatorId,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
await allowedPromise(enableBatch.commit());
const publishProfileBatch = clientWriteBatch(newCreator.db);
publishProfileBatch.update(clientDoc(newCreator.db, 'creatorPublicProfiles', newCreatorId), {
  status: 'published',
  updatedAt: serverTimestamp(),
});
await allowedPromise(publishProfileBatch.commit());

const validPublication = publicationBatch(ownerCreator.db, 'listing-owner-valid', {
  sourceProgramId: 'program-owner',
  sourceVersionId: 'v1',
  creatorId,
  title: 'Safe programme',
  description: 'Synthetic preview.',
  durationWeeks: 4,
});
await allowedPromise(validPublication.commit());

for (const [name, overrides] of [
  ['cross-creator-listing', { listingCreatorId: newCreatorId }],
  ['cross-creator-version', { versionCreatorId: newCreatorId }],
  ['other-owner-source', { sourceProgramId: 'program-other' }],
  ['missing-source-program', { sourceProgramId: 'program-missing' }],
  ['missing-source-version', { sourceVersionId: 'v99' }],
  ['mismatched-source-version', { sourceVersionId: 'v2' }],
  ['incorrect-title', { title: 'Forged title' }],
  ['incorrect-description', { description: 'Forged description' }],
  ['incorrect-duration', { durationWeeks: 5 }],
  ['duration-over-52', { durationWeeks: 53 }],
  ['listing-pointer-mismatch', { listingVersionId: 'publication-wrong' }],
  ['version-number-mismatch', { versionNumber: 2 }],
  ['control-pointer-mismatch', { controlVersionId: 'publication-wrong' }],
  ['nested-days', { extraPreview: { days: [] } }],
  ['private-owner', { extraPreview: { ownerUid: owner.uid } }],
  ['private-program-id', { extraPreview: { programId: 'program-owner' } }],
  ['private-version-id', { extraPreview: { versionId: 'v1' } }],
  ['private-exercises', { extraPreview: { exercises: [] } }],
  ['private-sets', { extraPreview: { sets: [] } }],
  ['private-groups', { extraPreview: { groups: [] } }],
  ['private-note', { extraPreview: { note: 'private' } }],
  ['private-instruction-text', { extraPreview: { instructionText: 'private' } }],
  ['private-instruction-url', { extraPreview: { instructionUrl: 'https://example.invalid' } }],
  ['legacy-snapshot', { extraVersion: { snapshot: {} } }],
  ['unverifiable-hash', { extraVersion: { snapshotHash: 'a'.repeat(64) } }],
]) {
  await deniedPromise(
    publicationBatch(ownerCreator.db, `listing-negative-${name}`, {
      sourceProgramId: 'program-owner',
      sourceVersionId: 'v1',
      creatorId,
      title: 'Safe programme',
      description: 'Synthetic preview.',
      durationWeeks: 4,
      ...overrides,
    }).commit(),
    name,
  );
}

const attributedRevision = clientWriteBatch(ownerCreator.db);
attributedRevision.update(
  clientDoc(ownerCreator.db, 'creatorPublicListings', 'listing-owner-valid'),
  { creatorId: newCreatorId, updatedAt: serverTimestamp() },
);
await deniedPromise(attributedRevision.commit(), 'cross-creator listing revision');

const foreignVersionRevision = clientWriteBatch(ownerCreator.db);
foreignVersionRevision.update(
  clientDoc(ownerCreator.db, 'creatorPublicationControls', 'listing-owner-valid'),
  {
    currentPublicationVersion: 2,
    currentPublicVersionId: 'publication-listing-owner-valid-foreign',
    updatedAt: serverTimestamp(),
  },
);
foreignVersionRevision.set(
  clientDoc(
    ownerCreator.db,
    'creatorPublicListings',
    'listing-owner-valid',
    'versions',
    'publication-listing-owner-valid-foreign',
  ),
  publicVersion('listing-owner-valid', 'publication-listing-owner-valid-foreign', newCreatorId, 2, {
    title: 'Safe programme',
    description: 'Synthetic preview.',
    durationWeeks: 4,
  }),
);
foreignVersionRevision.update(
  clientDoc(ownerCreator.db, 'creatorPublicListings', 'listing-owner-valid'),
  {
    currentVersionId: 'publication-listing-owner-valid-foreign',
    updatedAt: serverTimestamp(),
  },
);
await deniedPromise(foreignVersionRevision.commit(), 'cross-creator version revision');

const revisionBatch = clientWriteBatch(ownerCreator.db);
revisionBatch.update(
  clientDoc(ownerCreator.db, 'creatorPublicationControls', 'listing-owner-valid'),
  {
    currentPublicationVersion: 2,
    currentPublicVersionId: 'publication-listing-owner-valid-v2',
    updatedAt: serverTimestamp(),
  },
);
revisionBatch.set(
  clientDoc(
    ownerCreator.db,
    'creatorPublicListings',
    'listing-owner-valid',
    'versions',
    'publication-listing-owner-valid-v2',
  ),
  publicVersion('listing-owner-valid', 'publication-listing-owner-valid-v2', creatorId, 2, {
    title: 'Safe programme',
    description: 'Synthetic preview.',
    durationWeeks: 4,
  }),
);
revisionBatch.update(clientDoc(ownerCreator.db, 'creatorPublicListings', 'listing-owner-valid'), {
  currentVersionId: 'publication-listing-owner-valid-v2',
  updatedAt: serverTimestamp(),
});
await allowedPromise(revisionBatch.commit());
deny(
  await update(
    'creatorPublicListings/listing-owner-valid/versions/publication-listing-owner-valid-v1',
    { preview: { title: 'Changed', description: '', durationWeeks: 1 } },
    owner.token,
  ),
);
allow(
  await update('creatorPublicListings/listing-owner-valid', { status: 'withdrawn' }, owner.token),
);
console.log(
  'P34 creator rules verified: source ownership, cross-creator attribution, metadata-only projection, revision consistency, privacy, moderation and immutability passed.',
);
process.exit(0);
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
  return { uid: user.uid, email, token: (await response.json()).idToken };
}
async function seedProgram(uid, programId, versionId, name, description, durationWeeks) {
  await db.doc(`athletes/${uid}/programs/${programId}`).set({
    schemaVersion: 1,
    contractVersion: 'training-programs-v1',
    ownerUid: uid,
    programId,
    source: 'athlete',
    name,
    currentVersionId: versionId,
    currentVersionNumber: Number(versionId.slice(1)),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`athletes/${uid}/programs/${programId}/versions/${versionId}`).set({
    schemaVersion: 1,
    contractVersion: 'training-programs-v1',
    ownerUid: uid,
    programId,
    versionId,
    versionNumber: Number(versionId.slice(1)),
    name,
    description,
    durationWeeks,
    createdAt: now,
  });
}
async function clientFor(name, email) {
  const clientApp = initializeClientApp({ projectId, apiKey: 'fake' }, name);
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(clientAuth, email, password);
  const clientDb = getClientFirestore(clientApp);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(clientDb, host, Number(port));
  return { db: clientDb };
}
function publicationBatch(clientDb, listingId, options) {
  const versionId = `publication-${listingId}-v1`;
  const controlVersionId = options.controlVersionId ?? versionId;
  const listingVersionId = options.listingVersionId ?? versionId;
  const batch = clientWriteBatch(clientDb);
  batch.set(clientDoc(clientDb, 'creatorPublicationControls', listingId), {
    schemaVersion: 1,
    contractVersion: 'creator-program-publication-v1',
    ownerUid: owner.uid,
    creatorId: options.creatorId,
    listingId,
    sourceProgramId: options.sourceProgramId,
    sourceVersionId: options.sourceVersionId,
    currentPublicationVersion: 1,
    currentPublicVersionId: controlVersionId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(clientDoc(clientDb, 'creatorPublicListings', listingId, 'versions', versionId), {
    ...publicVersion(
      listingId,
      versionId,
      options.versionCreatorId ?? options.creatorId,
      options.versionNumber ?? 1,
      {
        title: options.title,
        description: options.description,
        durationWeeks: options.durationWeeks,
        ...options.extraPreview,
      },
    ),
    ...options.extraVersion,
  });
  batch.set(clientDoc(clientDb, 'creatorPublicListings', listingId), {
    schemaVersion: 1,
    contractVersion: 'creator-program-publication-v1',
    listingId,
    creatorId: options.listingCreatorId ?? options.creatorId,
    title: options.title,
    summary: options.description,
    status: 'published',
    platformStatus: 'active',
    currentVersionId: listingVersionId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return batch;
}
function publicVersion(listingId, publicationVersionId, versionCreatorId, versionNumber, preview) {
  return {
    schemaVersion: 1,
    contractVersion: 'creator-program-publication-v1',
    publicationVersionId,
    creatorId: versionCreatorId,
    listingId,
    versionNumber,
    preview,
    publishedAt: serverTimestamp(),
  };
}
async function allowedPromise(promise) {
  await promise;
}
async function deniedPromise(promise, label) {
  await assert.rejects(promise, undefined, `expected ${label} to be denied`);
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
