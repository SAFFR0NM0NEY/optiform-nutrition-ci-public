import assert from 'node:assert/strict';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const a = await user('trust-a@example.invalid');
const b = await user('trust-b@example.invalid');
const now = new Date().toISOString();
const consentId = 'terms-of-use--2026.09-beta.1';
const consentPath = `athletes/${a.localId}/policyConsents/${consentId}`;
const consent = consentFields(a.localId, now);
assert.equal((await create(consentPath, consent, a.idToken)).status, 200);
assert.equal((await get(consentPath, a.idToken)).status, 200);
assert.equal((await get(`athletes/${a.localId}/policyConsents`, a.idToken)).status, 200);
assert.equal((await get(consentPath, b.idToken)).status, 403);
assert.equal((await get(consentPath)).status, 403);
assert.equal((await update(consentPath, consent, a.idToken)).status, 403);
assert.equal((await remove(consentPath, a.idToken)).status, 403);
assert.equal((await create(consentPath, consent, a.idToken)).status, 409);
assert.equal(
  (
    await create(
      `athletes/${a.localId}/policyConsents/privacy-notice--2025.01`,
      {
        ...consentFields(a.localId, now),
        policyId: s('privacy-notice'),
        policyVersion: s('2025.01'),
      },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await create(
      `athletes/${a.localId}/policyConsents/privacy-notice--2026.09-beta.1`,
      { ...consentFields(b.localId, now), policyId: s('privacy-notice') },
      a.idToken,
    )
  ).status,
  403,
);
const old = new Date(Date.now() - 10 * 60_000).toISOString();
assert.equal(
  (
    await create(
      `athletes/${a.localId}/policyConsents/fitness-safety-notice--2026.09-beta.1`,
      { ...consentFields(a.localId, old), policyId: s('fitness-safety-notice') },
      a.idToken,
    )
  ).status,
  403,
);

const deletionPath = `accountDeletionRequests/${a.localId}`;
const deletion = deletionFields(a.localId, now);
assert.equal((await create(deletionPath, deletion, a.idToken)).status, 200);
assert.equal((await get(deletionPath, a.idToken)).status, 200);
assert.equal((await get(deletionPath, b.idToken)).status, 403);
assert.equal((await update(deletionPath, deletion, a.idToken)).status, 403);
assert.equal((await remove(deletionPath, a.idToken)).status, 403);
assert.equal(
  (
    await create(
      `accountDeletionRequests/${b.localId}`,
      { ...deletionFields(a.localId, now), status: s('completed') },
      a.idToken,
    )
  ).status,
  403,
);
console.log(
  'P43 trust rules verified: immutable current consent, timestamp, ownership and request-only deletion boundaries passed.',
);

function consentFields(uid, acceptedAt) {
  return {
    schemaVersion: i(1),
    contractVersion: s('policy-consent-v1'),
    ownerUid: s(uid),
    policyId: s('terms-of-use'),
    policyVersion: s('2026.09-beta.1'),
    policyStatusAtAcceptance: s('beta-draft'),
    acceptedAt: ts(acceptedAt),
    acceptanceSource: s('in-app'),
  };
}
function deletionFields(uid, requestedAt) {
  return {
    schemaVersion: i(1),
    contractVersion: s('account-deletion-request-v1'),
    ownerUid: s(uid),
    status: s('requested'),
    requestedAt: ts(requestedAt),
  };
}
function s(value) {
  return { stringValue: value };
}
function i(value) {
  return { integerValue: String(value) };
}
function ts(value) {
  return { timestampValue: value };
}
async function user(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test-password-123', returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  return response.json();
}
function headers(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}
async function get(path, token) {
  return fetch(`${baseUrl}/${path}`, { headers: headers(token) });
}
async function create(path, fields, token) {
  const parts = path.split('/');
  const id = parts.pop();
  return fetch(`${baseUrl}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function update(path, fields, token) {
  return fetch(`${baseUrl}/${path}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function remove(path, token) {
  return fetch(`${baseUrl}/${path}`, { method: 'DELETE', headers: headers(token) });
}
