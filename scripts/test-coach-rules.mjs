import assert from 'node:assert/strict';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const coach = await user('p20-coach@example.invalid');
const athlete = await user('p20-athlete@example.invalid');
const other = await user('p20-other@example.invalid');
const code = '0123456789ABCDEF';
const id = `${coach.localId}__${athlete.localId}`;
const now = new Date().toISOString();
await adminWrite(`coachProfiles/${coach.localId}`, profile(coach.localId, code, 'active'));
await adminWrite(`coachCodes/${code}`, codeFields(coach.localId, code));
assert.equal((await get(`coachProfiles/${coach.localId}`, coach.idToken)).status, 200);
assert.equal((await get(`coachProfiles/${coach.localId}`, athlete.idToken)).status, 403);
assert.equal((await get(`coachCodes/${code}`, athlete.idToken)).status, 200);
assert.equal((await get('coachCodes', athlete.idToken)).status, 403);
const pending = relationship(id, coach.localId, athlete.localId, code, 'pending', []);
assert.equal(
  (
    await serverWrite(
      `coachRelationships/${id}`,
      pending,
      ['createdAt', 'updatedAt'],
      athlete.idToken,
    )
  ).status,
  200,
);
const storedPending = (await (await get(`coachRelationships/${id}`, athlete.idToken)).json())
  .fields;
assert.equal((await get(`coachRelationships/${id}`, coach.idToken)).status, 200);
assert.equal((await get(`coachRelationships/${id}`, other.idToken)).status, 403);
assert.equal(
  (
    await create(
      `coachRelationships/${coach.localId}__${coach.localId}`,
      relationship(
        `${coach.localId}__${coach.localId}`,
        coach.localId,
        coach.localId,
        code,
        'pending',
        [],
      ),
      coach.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await update(
      `coachRelationships/${id}`,
      {
        ...storedPending,
        status: s('active'),
        capabilities: a([]),
        respondedAt: ts(),
        updatedAt: ts(),
      },
      athlete.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await serverWrite(
      `coachRelationships/${id}`,
      {
        ...storedPending,
        status: s('active'),
        capabilities: a([]),
        respondedAt: ts(),
        updatedAt: ts(),
      },
      ['respondedAt', 'updatedAt'],
      coach.idToken,
    )
  ).status,
  200,
);
const active = relationship(id, coach.localId, athlete.localId, code, 'active', [
  'training-history-read',
]);
await adminWrite(`coachRelationships/${id}`, active);
assert.equal(
  (
    await update(
      `coachRelationships/${id}`,
      { ...active, capabilities: a(['training-history-read', 'wellness-read']), updatedAt: ts() },
      coach.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await serverWrite(
      `coachRelationships/${id}`,
      { ...active, capabilities: a(['training-history-read', 'wellness-read']), updatedAt: ts() },
      ['updatedAt'],
      athlete.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (
    await update(
      `coachRelationships/${id}`,
      { ...active, capabilities: a(['platform-admin']), updatedAt: ts() },
      athlete.idToken,
    )
  ).status,
  403,
);
for (const path of [
  `athletes/${athlete.localId}/workouts/private`,
  `athletes/${athlete.localId}/nutritionEntries/private`,
  `athletes/${athlete.localId}/wellnessObservations/private`,
  `athletes/${athlete.localId}/measurements/private`,
  `athletes/${athlete.localId}/progressPhotos/private`,
  `athletes/${athlete.localId}/competitionMetaHistory/private`,
]) {
  await adminWrite(path, { ownerUid: s(athlete.localId) });
  assert.equal((await get(path, coach.idToken)).status, 403, path);
}
const terminal = {
  ...active,
  status: s('revoked'),
  capabilities: a([]),
  endedAt: ts(),
  updatedAt: ts(),
};
const history = { ...terminal, historyId: s('1'), terminalStatus: s('revoked') };
assert.equal(
  (
    await serverCommit(
      [
        {
          path: `coachRelationships/${id}`,
          fields: terminal,
          serverFields: ['updatedAt', 'endedAt'],
        },
        {
          path: `coachRelationships/${id}/history/1`,
          fields: { ...history, coachDisplayName: s('Forged Coach') },
          serverFields: ['updatedAt', 'endedAt'],
        },
      ],
      athlete.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await serverCommit(
      [
        {
          path: `coachRelationships/${id}`,
          fields: terminal,
          serverFields: ['updatedAt', 'endedAt'],
        },
        {
          path: `coachRelationships/${id}/history/1`,
          fields: history,
          serverFields: ['updatedAt', 'endedAt'],
        },
      ],
      athlete.idToken,
    )
  ).status,
  200,
);
assert.equal((await get(`coachRelationships/${id}/history/1`, coach.idToken)).status, 200);
assert.equal((await get(`coachRelationships/${id}/history/1`, other.idToken)).status, 403);
assert.equal(
  (await update(`coachRelationships/${id}/history/1`, history, athlete.idToken)).status,
  403,
);
const reconnect = { ...pending, cycle: i(2), createdAt: active.createdAt, updatedAt: ts() };
assert.equal(
  (await serverWrite(`coachRelationships/${id}`, reconnect, ['updatedAt'], athlete.idToken)).status,
  200,
);
await adminWrite(`athletes/${athlete.localId}/blockedUsers/${coach.localId}`, {
  schemaVersion: i(1),
  contractVersion: s('friends-v1'),
  ownerUid: s(athlete.localId),
  blockedUid: s(coach.localId),
  displayNameSnapshot: s('Coach User'),
  createdAt: ts(),
});
assert.equal((await get(`coachCodes/${code}`, athlete.idToken)).status, 403);
console.log(
  'P20 coach rules verified: exact-code privacy, participant lifecycle, athlete-only capabilities, block safety, role-neutrality and zero underlying athlete-data access passed.',
);
function profile(uid, currentCode, status) {
  return {
    schemaVersion: i(1),
    contractVersion: s('coach-profile-v1'),
    ownerUid: s(uid),
    displayName: s('Coach User'),
    status: s(status),
    currentCode: s(currentCode),
    createdAt: ts(now),
    updatedAt: ts(),
  };
}
function codeFields(uid, value) {
  return {
    schemaVersion: i(1),
    contractVersion: s('coach-connection-code-v1'),
    code: s(value),
    coachUid: s(uid),
    coachDisplayName: s('Coach User'),
    status: s('active'),
    createdAt: ts(now),
    updatedAt: ts(),
  };
}
function relationship(rid, coachUid, athleteUid, used, status, capabilities) {
  return {
    schemaVersion: i(1),
    contractVersion: s('coach-relationship-v1'),
    capabilityContractVersion: s('coach-capability-grants-v1'),
    relationshipId: s(rid),
    participantUids: a([coachUid, athleteUid]),
    coachUid: s(coachUid),
    athleteUid: s(athleteUid),
    coachDisplayName: s('Coach User'),
    athleteDisplayName: s('Athlete User'),
    requestSource: s('coach-code'),
    coachCodeUsed: s(used),
    cycle: i(1),
    status: s(status),
    capabilities: a(capabilities),
    createdAt: ts(now),
    updatedAt: ts(),
    ...(status === 'active' ? { respondedAt: ts(now) } : {}),
  };
}
function s(value) {
  return { stringValue: value };
}
function i(value) {
  return { integerValue: String(value) };
}
function ts(value = new Date(Date.now() + 5).toISOString()) {
  return { timestampValue: value };
}
function a(values) {
  return { arrayValue: { values: values.map(s) } };
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
async function serverWrite(path, fields, serverFields, token) {
  return serverCommit([{ path, fields, serverFields }], token);
}
async function serverCommit(writes, token) {
  return fetch(
    `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents:commit`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        writes: writes.map(({ path, fields, serverFields }) => {
          const clean = { ...fields };
          for (const field of serverFields) delete clean[field];
          return {
            update: {
              name: `projects/${projectId}/databases/(default)/documents/${path}`,
              fields: clean,
            },
            updateTransforms: serverFields.map((fieldPath) => ({
              fieldPath,
              setToServerValue: 'REQUEST_TIME',
            })),
          };
        }),
      }),
    },
  );
}
async function adminWrite(path, fields) {
  const parts = path.split('/');
  const id = parts.pop();
  let response = await fetch(`${baseUrl}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (response.status === 409)
    response = await fetch(`${baseUrl}/${path}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  assert.ok(response.ok);
}
