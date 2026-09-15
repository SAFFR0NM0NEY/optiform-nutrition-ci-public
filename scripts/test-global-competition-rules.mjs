import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const app = getApps()[0] ?? initializeApp({ projectId });
const password = 'Test-password-123';
const athlete = await user('p48-athlete@example.invalid');
const other = await user('p48-other@example.invalid');
const verifier = await user('p48-verifier@example.invalid', ['verifier']);
const moderator = await user('p48-moderator@example.invalid', ['moderator']);
const support = await user('p48-support@example.invalid', ['support']);
const admin = await user('p48-admin@example.invalid', ['platform-admin']);

for (const policy of ['terms-of-use', 'privacy-notice', 'community-guidelines'])
  await adminWrite(`athletes/${athlete.localId}/policyConsents/${policy}--2026.09-beta.1`, {
    ownerUid: s(athlete.localId),
  });
const optIn = {
  schemaVersion: i(1),
  contractVersion: s('public-competition-opt-in-v1'),
  ownerUid: s(athlete.localId),
  acknowledgementVersion: s('public-competition-v1'),
  status: s('active'),
};
allow(
  await createWithTime(`publicCompetitionOptIns/${athlete.localId}`, optIn, athlete.idToken, [
    'acceptedAt',
    'updatedAt',
  ]),
);
deny(
  await createWithTime(
    `publicCompetitionOptIns/${other.localId}`,
    { ...optIn, ownerUid: s(other.localId) },
    other.idToken,
    ['acceptedAt', 'updatedAt'],
  ),
);
deny(await get(`publicCompetitionOptIns/${athlete.localId}`, other.idToken));
deny(await get(`publicCompetitionOptIns/${athlete.localId}`));

await adminWrite('exercises/p48-squat', {
  source: s('system'),
  status: s('published'),
  trackingProfile: map({ primaryMetric: s('load'), supportedMetrics: arr([s('load'), s('reps')]) }),
});
const eventId = 'event-p48-security';
const event = {
  schemaVersion: i(1),
  contractVersion: s('competition-events-v1'),
  eventId: s(eventId),
  exerciseId: s('p48-squat'),
  exerciseName: s('P48 Squat'),
  targetReps: i(5),
  scoreMetric: s('load-kg'),
  competitionClass: s('open'),
  status: s('draft'),
  startsAt: ts('2026-09-04T00:00:00.000Z'),
  endsAt: ts('2026-09-11T00:00:00.000Z'),
  reviewEndsAt: ts('2026-09-18T00:00:00.000Z'),
  createdByUid: s(admin.localId),
};
deny(
  await createWithTime(
    `competitionEvents/event-athlete`,
    { ...event, eventId: s('event-athlete'), createdByUid: s(athlete.localId) },
    athlete.idToken,
    ['createdAt', 'updatedAt'],
  ),
);
allow(
  await createWithTime(`competitionEvents/${eventId}`, event, admin.idToken, [
    'createdAt',
    'updatedAt',
  ]),
);
allow(await get(`competitionEvents/${eventId}`, athlete.idToken));
deny(await get(`competitionEvents/${eventId}`));
deny(
  await patch(
    `competitionEvents/${eventId}`,
    { ...event, targetReps: i(10), status: s('open') },
    admin.idToken,
  ),
);

const submissionId = 'submission-p48-security';
await adminWrite(`competitionSubmissions/${submissionId}`, {
  ownerUid: s(athlete.localId),
  eventId: s(eventId),
  status: s('submitted'),
  evidencePath: s(`athletes/${athlete.localId}/competition-evidence/${submissionId}.mp4`),
  displayNameSnapshot: s('Safe Athlete'),
  exerciseName: s('P48 Squat'),
  targetReps: i(5),
  loadKg: d(100),
});
await adminWrite(`competitionEvidenceReviews/${submissionId}`, {
  ownerUid: s(athlete.localId),
  eventId: s(eventId),
  submissionId: s(submissionId),
  status: s('pending'),
});
allow(await get(`competitionSubmissions/${submissionId}`, athlete.idToken));
allow(await get(`competitionSubmissions/${submissionId}`, verifier.idToken));
allow(await get(`competitionSubmissions/${submissionId}`, admin.idToken));
for (const principal of [other, moderator, support, null])
  deny(await get(`competitionSubmissions/${submissionId}`, principal?.idToken));
deny(
  await patch(
    `competitionSubmissions/${submissionId}`,
    { ownerUid: s(athlete.localId), eventId: s(eventId), status: s('evidence-verified') },
    athlete.idToken,
  ),
);

const standingId = 'submission-p48-public';
await adminWrite(`verifiedPublicStandings/${standingId}`, {
  schemaVersion: i(1),
  contractVersion: s('verified-public-standings-v1'),
  eventId: s(eventId),
  displayName: s('Safe Athlete'),
  initials: s('SA'),
  exerciseName: s('P48 Squat'),
  targetReps: i(5),
  loadKg: d(100),
  verification: s('evidence-verified'),
  status: s('active'),
  auditEventId: s('audit-p48'),
  verifiedAt: ts('2026-09-03T00:00:00.000Z'),
});
for (const principal of [athlete, other, verifier, moderator, support, admin])
  allow(await get(`verifiedPublicStandings/${standingId}`, principal.idToken));
deny(await get(`verifiedPublicStandings/${standingId}`));
deny(await patch(`verifiedPublicStandings/${standingId}`, { loadKg: d(200) }, athlete.idToken));
deny(await remove(`verifiedPublicStandings/${standingId}`, verifier.idToken));

const publishStanding = {
  schemaVersion: i(1),
  contractVersion: s('verified-public-standings-v1'),
  eventId: s(eventId),
  displayName: s('Safe Athlete'),
  initials: s('SA'),
  exerciseName: s('P48 Squat'),
  targetReps: i(5),
  loadKg: d(100),
  verification: s('evidence-verified'),
  status: s('active'),
  auditEventId: s('audit-p48-publish'),
};
deny(
  await createWithTime(
    `verifiedPublicStandings/${submissionId}`,
    publishStanding,
    verifier.idToken,
    ['verifiedAt'],
  ),
);
allow(await publishResult(submissionId, athlete.localId, verifier));
allow(await get(`verifiedPublicStandings/${submissionId}`, other.idToken));
allow(await invalidateResult(submissionId, athlete.localId, verifier));
assert.equal((await get(`verifiedPublicStandings/${submissionId}`, athlete.idToken)).status, 404);

const reportId = 'competition-report-p48';
allow(
  await createWithTime(
    `competitionResultReports/${reportId}`,
    {
      schemaVersion: i(1),
      contractVersion: s('moderation-operations-v1'),
      reportId: s(reportId),
      reporterUid: s(other.localId),
      targetId: s(standingId),
      reason: s('Suspected mismatch'),
      status: s('open'),
    },
    other.idToken,
    ['createdAt'],
  ),
);
allow(await get(`competitionResultReports/${reportId}`, moderator.idToken));
allow(await get(`competitionResultReports/${reportId}`, admin.idToken));
for (const principal of [athlete, other, verifier, support, null])
  deny(await get(`competitionResultReports/${reportId}`, principal?.idToken));

const claimPath = `athletes/${athlete.localId}/competitionSourceClaims/w--e--s`;
const claim = {
  schemaVersion: i(1),
  contractVersion: s('competition-evidence-v1'),
  ownerUid: s(athlete.localId),
  eventId: s(eventId),
  submissionId: s(submissionId),
  sourceWorkoutId: s('w'),
  sourceExerciseEntryId: s('e'),
  sourceSetId: s('s'),
};
allow(await createWithTime(claimPath, claim, athlete.idToken, ['createdAt']));
assert.equal((await createWithTime(claimPath, claim, athlete.idToken, ['createdAt'])).status, 409);
deny(await get(claimPath, other.idToken));

console.log(
  'P48 Firestore rules verified: policy-gated opt-in, admin-only immutable events, owner/exact verifier private submissions, authenticated-only minimal standings, self-verification/score-write denial, report role separation, and deterministic duplicate source claims passed.',
);

function s(v) {
  return { stringValue: v };
}
function i(v) {
  return { integerValue: String(v) };
}
function d(v) {
  return { doubleValue: v };
}
function ts(v) {
  return { timestampValue: v };
}
function arr(values) {
  return { arrayValue: { values } };
}
function map(fields) {
  return { mapValue: { fields } };
}
function headers(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}
async function user(email, roles = []) {
  let response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  return response.json();
}
function get(path, token) {
  return fetch(`${base}/${path}`, { headers: headers(token) });
}
function remove(path, token) {
  return fetch(`${base}/${path}`, { method: 'DELETE', headers: headers(token) });
}
function patch(path, fields, token) {
  return fetch(`${base}/${path}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function createWithTime(path, fields, token, transforms) {
  const name = `projects/${projectId}/databases/(default)/documents/${path}`;
  return fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      writes: [
        {
          update: { name, fields },
          updateTransforms: transforms.map((fieldPath) => ({
            fieldPath,
            setToServerValue: 'REQUEST_TIME',
          })),
          currentDocument: { exists: false },
        },
      ],
    }),
  });
}
async function adminWrite(path, fields) {
  const parts = path.split('/');
  const id = parts.pop();
  const response = await fetch(`${base}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: headers('owner'),
    body: JSON.stringify({ fields }),
  });
  if (!response.ok && response.status !== 409) throw new Error(await response.text());
}
function allow(response) {
  assert.ok(response.ok, `expected allow, received ${response.status}`);
}
function deny(response) {
  assert.equal(response.status, 403);
}

function auditFields(id, actor, action, ownerUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('platform-enforcement-v1'),
    eventId: s(id),
    actorUid: s(actor.localId),
    actorRoles: arr([s('verifier')]),
    action: s(action),
    caseId: s(submissionId),
    targetType: s('competition-result'),
    targetOwnerUid: s(ownerUid),
    targetId: s(submissionId),
    reasonCode: s('bounded-review'),
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
async function publishResult(id, ownerUid, actor) {
  const auditId = 'audit-p48-publish';
  return commit(actor.idToken, [
    partialUpdate(`competitionSubmissions/${id}`, {
      status: s('evidence-verified'),
      reviewedByUid: s(actor.localId),
      reviewReason: s('bounded-review'),
      auditEventId: s(auditId),
    }),
    partialUpdate(`competitionEvidenceReviews/${id}`, {
      status: s('evidence-verified'),
      assignedVerifierUid: s(actor.localId),
      reason: s('bounded-review'),
      auditEventId: s(auditId),
    }),
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/verifiedPublicStandings/${id}`,
        fields: publishStanding,
      },
      updateTransforms: [{ fieldPath: 'verifiedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    },
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/platformAudit/${auditId}`,
        fields: auditFields(auditId, actor, 'publish-competition-result', ownerUid),
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    },
  ]);
}
async function invalidateResult(id, ownerUid, actor) {
  const auditId = 'audit-p48-invalidate';
  return commit(actor.idToken, [
    partialUpdate(`competitionSubmissions/${id}`, {
      status: s('invalidated'),
      reviewedByUid: s(actor.localId),
      reviewReason: s('bounded-review'),
      auditEventId: s(auditId),
    }),
    partialUpdate(`competitionEvidenceReviews/${id}`, {
      status: s('invalidated'),
      assignedVerifierUid: s(actor.localId),
      reason: s('bounded-review'),
      auditEventId: s(auditId),
    }),
    {
      delete: `projects/${projectId}/databases/(default)/documents/verifiedPublicStandings/${id}`,
      currentDocument: { exists: true },
    },
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/platformAudit/${auditId}`,
        fields: auditFields(auditId, actor, 'invalidate-competition-result', ownerUid),
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    },
  ]);
}
function commit(token, writes) {
  return fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes }),
  });
}
