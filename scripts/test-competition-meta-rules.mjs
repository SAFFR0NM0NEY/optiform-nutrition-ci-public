import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const app = getApps()[0] ?? initializeApp({ projectId });
const athlete = await user('p49-athlete@example.invalid');
const other = await user('p49-other@example.invalid');
const verifier = await user('p49-verifier@example.invalid', ['verifier']);
const moderator = await user('p49-moderator@example.invalid', ['moderator']);
const support = await user('p49-support@example.invalid', ['support']);
const admin = await user('p49-admin@example.invalid', ['platform-admin']);

for (let index = 0; index < 4; index += 1)
  await adminWrite(`competitionEvents/meta-event-${index}`, {
    startsAt: ts(`2026-09-${String(5 + index).padStart(2, '0')}T00:00:00.000Z`),
    endsAt: ts(`2026-09-${String(6 + index).padStart(2, '0')}T00:00:00.000Z`),
  });

const seasonId = 'meta-season-security';
const season = {
  schemaVersion: i(1),
  contractVersion: s('competition-meta-season-v1'),
  seasonId: s(seasonId),
  name: s('Eight week open season'),
  startsAt: ts('2026-09-03T00:00:00.000Z'),
  endsAt: ts('2026-10-29T00:00:00.000Z'),
  scoringVersion: s('competition-meta-progression-v1'),
  linkedEventIds: arr([0, 1, 2, 3].map((index) => s(`meta-event-${index}`))),
  status: s('draft'),
  createdByUid: s(admin.localId),
};
for (const principal of [athlete, verifier, moderator, support])
  deny(
    await createWithTime(
      `competitionMetaSeasons/${seasonId}-${principal.localId}`,
      {
        ...season,
        seasonId: s(`${seasonId}-${principal.localId}`),
        createdByUid: s(principal.localId),
      },
      principal.idToken,
      ['createdAt', 'updatedAt'],
    ),
  );
allow(
  await createWithTime(`competitionMetaSeasons/${seasonId}`, season, admin.idToken, [
    'createdAt',
    'updatedAt',
  ]),
);
deny(await get(`competitionMetaSeasons/${seasonId}`));
allow(await get(`competitionMetaSeasons/${seasonId}`, athlete.idToken));

allow(
  await commit(admin.idToken, [
    partialUpdate(`competitionMetaSeasons/${seasonId}`, { status: s('active') }),
    createTransform(
      'competitionMetaControl/current',
      {
        schemaVersion: i(1),
        contractVersion: s('competition-meta-season-v1'),
        activeSeasonId: s(seasonId),
      },
      ['updatedAt'],
    ),
  ]),
);
deny(
  await partialCommit(admin.idToken, `competitionMetaSeasons/${seasonId}`, {
    status: s('finalized'),
  }),
);
const overlappingId = 'meta-season-overlapping';
allow(
  await createWithTime(
    `competitionMetaSeasons/${overlappingId}`,
    { ...season, seasonId: s(overlappingId) },
    admin.idToken,
    ['createdAt', 'updatedAt'],
  ),
);
deny(
  await commit(admin.idToken, [
    partialUpdate(`competitionMetaSeasons/${overlappingId}`, { status: s('active') }),
    partialUpdate('competitionMetaControl/current', { activeSeasonId: s(overlappingId) }),
  ]),
);
deny(
  await partialCommit(athlete.idToken, `competitionMetaSeasons/${seasonId}`, {
    status: s('finalizing'),
  }),
);
deny(
  await partialCommit(verifier.idToken, `competitionMetaSeasons/${seasonId}`, {
    status: s('finalizing'),
  }),
);

const projectionId = 'meta-opaque-random-id';
const projection = {
  schemaVersion: i(1),
  contractVersion: s('competition-meta-progression-v1'),
  displayName: s('Safe Athlete'),
  initials: s('SA'),
  currentDivision: s('division-5'),
  seasonId: s(seasonId),
  seasonScore: i(300),
  countedResultCount: i(4),
  eligibleResultCount: i(5),
  seasonStatus: s('active'),
  latestMovement: s('held'),
  prestigeMarks: i(0),
  updatedAt: ts('2026-09-03T00:00:00.000Z'),
};
await adminWrite(`competitionMetaProjections/${projectionId}`, projection);
deny(await get(`competitionMetaProjections/${projectionId}`));
for (const principal of [athlete, other, verifier, moderator, support, admin]) {
  const response = await get(`competitionMetaProjections/${projectionId}`, principal.idToken);
  allow(response);
  const fields = Object.keys((await response.json()).fields);
  assert.ok(
    !fields.some((field) =>
      ['ownerUid', 'email', 'workoutId', 'setId', 'evidencePath', 'auditEventId'].includes(field),
    ),
  );
}
for (const principal of [athlete, other, verifier, moderator, support, admin])
  deny(
    await patch(
      `competitionMetaProjections/${projectionId}`,
      { ...projection, seasonScore: i(400) },
      principal.idToken,
    ),
  );
notFound(await get('competitionMetaProjections/meta-opted-out', other.idToken));

await adminWrite(`athletes/${athlete.localId}/competitionMetaState/current`, {
  ownerUid: s(athlete.localId),
  currentDivision: s('division-5'),
  prestigeMarks: i(0),
  publicProjectionId: s(projectionId),
});
await adminWrite(`publicCompetitionOptIns/${athlete.localId}`, {
  ownerUid: s(athlete.localId),
  status: s('active'),
});
allow(
  await commit(athlete.idToken, [
    partialUpdate(`publicCompetitionOptIns/${athlete.localId}`, { status: s('withdrawn') }),
    {
      delete: `projects/${projectId}/databases/(default)/documents/competitionMetaProjections/${projectionId}`,
      currentDocument: { exists: true },
    },
  ]),
);
notFound(await get(`competitionMetaProjections/${projectionId}`, other.idToken));
await adminWrite(`athletes/${athlete.localId}/competitionMetaHistory/${seasonId}--r0`, {
  ownerUid: s(athlete.localId),
  seasonId: s(seasonId),
  seasonScore: i(300),
  movement: s('promoted'),
});
allow(await get(`athletes/${athlete.localId}/competitionMetaState/current`, athlete.idToken));
allow(
  await get(`athletes/${athlete.localId}/competitionMetaHistory/${seasonId}--r0`, athlete.idToken),
);
allow(
  await get(`athletes/${athlete.localId}/competitionMetaHistory/${seasonId}--r0`, admin.idToken),
);
for (const principal of [other, verifier, moderator, support, null])
  deny(
    await get(
      `athletes/${athlete.localId}/competitionMetaHistory/${seasonId}--r0`,
      principal?.idToken,
    ),
  );
for (const principal of [athlete, verifier, moderator, support, admin]) {
  deny(
    await patch(
      `athletes/${athlete.localId}/competitionMetaState/current`,
      { currentDivision: s('division-1') },
      principal.idToken,
    ),
  );
  deny(
    await adminLikeCreate(
      `athletes/${athlete.localId}/competitionMetaHistory/fake`,
      { ownerUid: s(athlete.localId), prestigeEarned: i(1) },
      principal.idToken,
    ),
  );
}

console.log(
  'P49 rules verified: authenticated minimal board, owner/admin private history, platform-admin-only bounded season lifecycle, and all browser score/division/Prestige/history authority denied.',
);

function s(value) {
  return { stringValue: value };
}
function i(value) {
  return { integerValue: String(value) };
}
function ts(value) {
  return { timestampValue: value };
}
function arr(values) {
  return { arrayValue: { values } };
}
function headers(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}
async function user(email, roles = []) {
  const password = 'Test-password-123';
  let response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  const created = await response.json();
  if (!roles.length) return created;
  await getAuth(app).setCustomUserClaims(created.localId, { optiformRoles: roles });
  response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  return response.json();
}
function get(path, token) {
  return fetch(`${base}/${path}`, { headers: headers(token) });
}
function patch(path, fields, token) {
  return fetch(`${base}/${path}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function createWithTime(path, fields, token, transforms) {
  return commit(token, [createTransform(path, fields, transforms)]);
}
function createTransform(path, fields, transforms) {
  return {
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields },
    updateTransforms: transforms.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    })),
    currentDocument: { exists: false },
  };
}
function partialUpdate(path, fields) {
  return {
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields },
    updateMask: { fieldPaths: Object.keys(fields) },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true },
  };
}
function partialCommit(token, path, fields) {
  return commit(token, [partialUpdate(path, fields)]);
}
function adminLikeCreate(path, fields, token) {
  const parts = path.split('/');
  const id = parts.pop();
  return fetch(`${base}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function adminWrite(path, fields) {
  const response = await adminLikeCreate(path, fields, 'owner');
  if (!response.ok && response.status !== 409) throw new Error(await response.text());
}
function commit(token, writes) {
  return fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes }),
  });
}
function allow(response) {
  assert.ok(response.ok, `expected allow, received ${response.status}`);
}
function deny(response) {
  assert.equal(response.status, 403);
}
function notFound(response) {
  assert.equal(response.status, 404);
}
