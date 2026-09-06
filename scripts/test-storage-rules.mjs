import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!authHost || !storageHost || !firestoreHost)
  throw new Error('Auth, Firestore, and Storage emulator hosts are required.');
const bucket = `${projectId}.appspot.com`;
const adminApp = getApps()[0] ?? initializeApp({ projectId });
const owner = await createUser('storage-owner@example.invalid');
const other = await createUser('storage-other@example.invalid');
const verifier = await createUser('storage-verifier@example.invalid', ['verifier']);
const admin = await createUser('storage-admin@example.invalid', ['platform-admin']);
const moderator = await createUser('storage-moderator@example.invalid', ['moderator']);
const support = await createUser('storage-support@example.invalid', ['support']);
const path = `athletes/${owner.localId}/progress-photos/photo-1.jpg`;

assert.equal(
  (await upload(path, new Uint8Array([1, 2, 3]), 'image/jpeg', owner.idToken)).status,
  200,
);
assert.equal((await read(path, owner.idToken)).status, 200);
assert.equal((await read(path, other.idToken)).status, 403);
assert.equal((await read(path)).status, 403);
assert.equal(
  (
    await upload(
      `athletes/${owner.localId}/progress-photos/bad.jpg`,
      new Uint8Array([1]),
      'image/png',
      owner.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await upload(
      `athletes/${owner.localId}/progress-photos/large.jpg`,
      new Uint8Array(8 * 1024 * 1024 + 1),
      'image/jpeg',
      owner.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (await upload('unrelated/photo.jpg', new Uint8Array([1]), 'image/jpeg', owner.idToken)).status,
  403,
);
assert.equal((await remove(path, other.idToken)).status, 403);
assert.equal((await remove(path, owner.idToken)).status, 204);

const submissionId = 'submission-10000000-0000-4000-8000-000000000048';
const evidencePath = `athletes/${owner.localId}/competition-evidence/${submissionId}.mp4`;
assert.equal(
  (await upload(evidencePath, new Uint8Array([1, 2, 3]), 'video/mp4', owner.idToken)).status,
  200,
);
for (const principal of [other, verifier, admin, moderator, support, null])
  assert.equal((await read(evidencePath, principal?.idToken)).status, 403);
await adminWrite(`competitionEvidenceReviews/${submissionId}`, {
  ownerUid: { stringValue: owner.localId },
});
for (const principal of [owner, verifier, admin])
  assert.equal((await read(evidencePath, principal.idToken)).status, 200);
for (const principal of [other, moderator, support, null])
  assert.equal((await read(evidencePath, principal?.idToken)).status, 403);
assert.equal(
  (
    await read(
      `athletes/${other.localId}/competition-evidence/${submissionId}.mp4`,
      verifier.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await upload(
      `athletes/${owner.localId}/competition-evidence/bad.mov`,
      new Uint8Array([1]),
      'video/quicktime',
      owner.idToken,
    )
  ).status,
  403,
);
assert.equal((await remove(evidencePath, other.idToken)).status, 403);
assert.equal((await remove(evidencePath, owner.idToken)).status, 204);
console.log(
  'Storage rules verified: progress photos regress cleanly; P48 owner upload/delete and exact verifier/admin evidence reads pass while unrelated athlete, moderator, support, unauthenticated, MIME, and unrelated-path access is denied.',
);

async function createUser(email, roles = []) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test-password-123', returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  const created = await response.json();
  if (!roles.length) return created;
  await getAuth(adminApp).setCustomUserClaims(created.localId, { optiformRoles: roles });
  const signin = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test-password-123', returnSecureToken: true }),
    },
  );
  assert.ok(signin.ok);
  return signin.json();
}
async function adminWrite(path, fields) {
  const parts = path.split('/');
  const id = parts.pop();
  const response = await fetch(
    `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${parts.join('/')}?documentId=${id}`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );
  assert.ok(response.ok || response.status === 409);
}
function requestHeaders(token, contentType) {
  return {
    ...(token ? { Authorization: `Firebase ${token}` } : {}),
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}
function objectUrl(path) {
  return `http://${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
}
function upload(path, body, type, token) {
  return fetch(`http://${storageHost}/v0/b/${bucket}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: requestHeaders(token, type),
    body,
  });
}
function read(path, token) {
  return fetch(`${objectUrl(path)}?alt=media`, { headers: requestHeaders(token) });
}
function remove(path, token) {
  return fetch(objectUrl(path), { method: 'DELETE', headers: requestHeaders(token) });
}
