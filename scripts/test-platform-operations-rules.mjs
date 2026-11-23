import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const password = 'Test-password-123';
const adminApp = getApps()[0] ?? initializeApp({ projectId });

const athlete = await user('p40-athlete@example.invalid');
const other = await user('p40-other@example.invalid');
const moderator = await user('p40-moderator@example.invalid', ['moderator']);
const support = await user('p40-support@example.invalid', ['support']);
const verifier = await user('p40-verifier@example.invalid', ['verifier']);
const admin = await user('p40-admin@example.invalid', ['platform-admin']);
const multi = await user('p40-multi@example.invalid', ['support', 'moderator']);
const now = new Date().toISOString();
const reportId = 'report-10000000-0000-4000-8000-000000000001';
const reportPath = `socialReports/${reportId}`;
await adminWrite(reportPath, report(reportId, athlete.localId, other.localId));

// Source report remains athlete-unreadable and immutable; moderation roles alone may read it.
for (const principal of [moderator, admin, multi]) allow(await get(reportPath, principal.idToken));
for (const principal of [athlete, support, verifier, null])
  deny(await get(reportPath, principal?.idToken));
deny(await update(reportPath, report(reportId, athlete.localId, other.localId), moderator.idToken));
deny(await remove(reportPath, admin.idToken));

const casePath = `moderationCases/${reportId}`;
const caseFields = moderationCase(reportId, other.localId, moderator.localId);
allow(
  await serverWrite('create', casePath, caseFields, moderator.idToken, ['createdAt', 'updatedAt']),
);
allow(await get(casePath, admin.idToken));
deny(await get(casePath, support.idToken));
deny(await get(casePath, verifier.idToken));
deny(await get(casePath, athlete.idToken));
deny(
  await serverWrite('create', `moderationCases/${reportId}-wrong`, caseFields, moderator.idToken, [
    'createdAt',
    'updatedAt',
  ]),
);

// The report-derived authorization grants access to only that exact social target.
const targetKey = other.localId;
allow(
  await serverWrite(
    'create',
    `moderationTargetAuthorizations/profile/owners/${other.localId}`,
    authorization(targetKey, reportId, other.localId, moderator.localId),
    moderator.idToken,
    ['createdAt'],
  ),
);
await adminWrite(`socialProfiles/${other.localId}`, { ownerUid: s(other.localId) });
allow(await get(`socialProfiles/${other.localId}`, moderator.idToken));
deny(await get(`socialProfiles/${athlete.localId}`, moderator.idToken));
deny(await remove(`socialProfiles/${other.localId}`, moderator.idToken));
allow(await removeModeratedProfile(other.localId, reportId, moderator.localId, moderator.idToken));
deny(await remove(`athletes/${other.localId}/measurements/private`, moderator.idToken));
deny(await remove(`athletes/${other.localId}/workouts/private`, moderator.idToken));
deny(await remove(`athletes/${other.localId}/wellnessObservations/private`, moderator.idToken));
deny(await remove(`athletes/${other.localId}/nutritionLogs/private`, moderator.idToken));

// Support cases are owner-private and role-separated, with immutable messages.
const ticketId = 'ticket-10000000-0000-4000-8000-000000000001';
const ticketPath = `supportTickets/${ticketId}`;
const athleteMessage = message(ticketId, 'message-athlete', athlete.localId, 'athlete');

// This is the exact client-shaped atomic create used by createSupportTicket. The parent does not
// exist before the commit, so the former get() lookup rejected it; getAfter() must see both writes.
allow(
  await createSupportCase(
    ticketId,
    athlete.localId,
    'message-athlete',
    athlete.localId,
    'athlete',
    athlete.idToken,
  ),
);
for (const principal of [athlete, support, admin, multi])
  allow(await get(ticketPath, principal.idToken));
for (const principal of [other, moderator, verifier, null])
  deny(await get(ticketPath, principal?.idToken));

// Owner replies remain valid once the ticket exists, but unrelated athletes cannot write/read it.
allow(
  await serverWrite(
    'create',
    `${ticketPath}/messages/message-athlete-reply`,
    message(ticketId, 'message-athlete-reply', athlete.localId, 'athlete'),
    athlete.idToken,
    ['createdAt'],
  ),
);
deny(
  await serverWrite(
    'create',
    `${ticketPath}/messages/message-unrelated`,
    message(ticketId, 'message-unrelated', other.localId, 'athlete'),
    other.idToken,
    ['createdAt'],
  ),
);
deny(await get(`${ticketPath}/messages/message-athlete`, other.idToken));

// Only the support operational authority may write operator messages.
deny(
  await serverWrite(
    'create',
    `${ticketPath}/messages/message-fake`,
    message(ticketId, 'message-fake', athlete.localId, 'operator'),
    athlete.idToken,
    ['createdAt'],
  ),
);
for (const principal of [moderator, verifier])
  deny(
    await serverWrite(
      'create',
      `${ticketPath}/messages/message-${principal.localId}`,
      message(ticketId, `message-${principal.localId}`, principal.localId, 'operator'),
      principal.idToken,
      ['createdAt'],
    ),
  );
allow(
  await serverWrite(
    'create',
    `${ticketPath}/messages/message-support`,
    message(ticketId, 'message-support', support.localId, 'operator'),
    support.idToken,
    ['createdAt'],
  ),
);
const currentTicket = await (await get(ticketPath, support.idToken)).json();
const waitingTicket = {
  ...currentTicket.fields,
  status: s('waiting-on-user'),
};
delete waitingTicket.updatedAt;
allow(await serverWrite('update', ticketPath, waitingTicket, support.idToken, ['updatedAt']));
const updatedTicket = await (await get(ticketPath, support.idToken)).json();
const resolvedTicket = {
  ...updatedTicket.fields,
  status: s('resolved'),
};
delete resolvedTicket.updatedAt;
for (const principal of [moderator, verifier])
  deny(await serverWrite('update', ticketPath, resolvedTicket, principal.idToken, ['updatedAt']));
deny(await update(`${ticketPath}/messages/message-athlete`, athleteMessage, athlete.idToken));
deny(await remove(`${ticketPath}/messages/message-athlete`, support.idToken));

// Every authority and field binding must hold across the same atomic create.
deny(
  await createSupportCase(
    'ticket-atomic-other-sender',
    athlete.localId,
    'message-atomic-other-sender',
    other.localId,
    'athlete',
    athlete.idToken,
  ),
);
deny(
  await createSupportCase(
    'ticket-atomic-wrong-child',
    athlete.localId,
    'message-atomic-wrong-child',
    athlete.localId,
    'athlete',
    athlete.idToken,
    { messageTicketId: 'ticket-not-the-parent' },
  ),
);
deny(
  await createSupportCase(
    'ticket-atomic-unauthenticated',
    athlete.localId,
    'message-atomic-unauthenticated',
    athlete.localId,
    'athlete',
  ),
);
deny(
  await createSupportCase(
    'ticket-atomic-malformed-case',
    athlete.localId,
    'message-atomic-malformed-case',
    athlete.localId,
    'athlete',
    athlete.idToken,
    { category: 'billing' },
  ),
);
deny(
  await createSupportCase(
    'ticket-atomic-malformed-message',
    athlete.localId,
    'message-atomic-malformed-message',
    athlete.localId,
    'athlete',
    athlete.idToken,
    { body: '<script>not plain text</script>' },
  ),
);

// P43 request stays immutable; operational status is separate and never completed.
await adminWrite(`accountDeletionRequests/${athlete.localId}`, deletionRequest(athlete.localId));
allow(await get(`accountDeletionRequests/${athlete.localId}`, support.idToken));
allow(await get(`accountDeletionRequests/${athlete.localId}`, admin.idToken));
deny(await get(`accountDeletionRequests/${athlete.localId}`, moderator.idToken));
deny(
  await update(
    `accountDeletionRequests/${athlete.localId}`,
    deletionRequest(athlete.localId),
    support.idToken,
  ),
);
const operationPath = `accountDeletionOperations/${athlete.localId}`;
allow(
  await serverWrite(
    'create',
    operationPath,
    deletionOperation(athlete.localId, support.localId, 'queued'),
    support.idToken,
    ['createdAt', 'updatedAt'],
  ),
);
allow(await get(operationPath, athlete.idToken));
deny(await get(operationPath, other.idToken));
deny(
  await serverWrite(
    'update',
    operationPath,
    deletionOperation(athlete.localId, support.localId, 'completed'),
    support.idToken,
    ['updatedAt'],
  ),
);
deny(
  await update(
    operationPath,
    deletionOperation(athlete.localId, athlete.localId, 'processing'),
    athlete.idToken,
  ),
);

// Verification is internal to verifier/admin roles and has no public read surface.
const verificationPath = 'verificationCases/case-p40-1';
allow(
  await serverWrite('create', verificationPath, verificationCase('case-p40-1'), verifier.idToken, [
    'createdAt',
    'updatedAt',
  ]),
);
allow(await get(verificationPath, verifier.idToken));
allow(await get(verificationPath, admin.idToken));
for (const principal of [athlete, moderator, support, multi, null])
  deny(await get(verificationPath, principal?.idToken));
deny(
  await serverWrite(
    'create',
    'verificationCases/case-p40-bad',
    verificationCase('case-p40-bad', 'certified'),
    verifier.idToken,
    ['createdAt', 'updatedAt'],
  ),
);

// Audit events are own-actor, exact-role, append-only and readable only by platform-admin.
const auditPath = 'platformAudit/audit-p40-1';
allow(
  await serverWrite(
    'create',
    auditPath,
    auditEvent('audit-p40-1', moderator.localId, ['moderator'], 'dismiss-report'),
    moderator.idToken,
    ['createdAt'],
  ),
);
allow(await get(auditPath, admin.idToken));
deny(await get(auditPath, moderator.idToken));
deny(
  await serverWrite(
    'create',
    'platformAudit/audit-spoof',
    auditEvent('audit-spoof', athlete.localId, ['moderator'], 'dismiss-report'),
    moderator.idToken,
    ['createdAt'],
  ),
);
deny(
  await serverWrite(
    'create',
    'platformAudit/audit-cross-role',
    auditEvent('audit-cross-role', moderator.localId, ['moderator'], 'support-reply'),
    moderator.idToken,
    ['createdAt'],
  ),
);
deny(
  await serverWrite(
    'create',
    'platformAudit/audit-unknown',
    auditEvent('audit-unknown', moderator.localId, ['moderator'], 'ban-athlete'),
    moderator.idToken,
    ['createdAt'],
  ),
);
deny(
  await update(
    auditPath,
    auditEvent('audit-p40-1', moderator.localId, ['moderator'], 'dismiss-report'),
    moderator.idToken,
  ),
);
deny(await remove(auditPath, admin.idToken));

console.log(
  'P40 role/security rules verified: atomic support case creation, owner privacy, operator role separation, malformed writes, and existing platform boundaries passed.',
);

function report(id, reporterUid, targetOwnerUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    reportId: s(id),
    reporterUid: s(reporterUid),
    targetType: s('profile'),
    targetOwnerUid: s(targetOwnerUid),
    targetId: s(targetOwnerUid),
    reason: s('privacy'),
    createdAt: ts(now),
  };
}
function moderationCase(id, targetOwnerUid, actorUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('moderation-operations-v1'),
    reportId: s(id),
    targetType: s('profile'),
    targetOwnerUid: s(targetOwnerUid),
    targetId: s(targetOwnerUid),
    status: s('open'),
    assignedOperatorUid: s(actorUid),
  };
}
function authorization(key, id, ownerUid, actorUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('moderation-operations-v1'),
    targetKey: s(key),
    reportId: s(id),
    targetType: s('profile'),
    targetOwnerUid: s(ownerUid),
    targetId: s(ownerUid),
    createdByUid: s(actorUid),
  };
}
function ticket(id, ownerUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('support-cases-v1'),
    ticketId: s(id),
    ownerUid: s(ownerUid),
    category: s('technical'),
    subject: s('A bounded request'),
    status: s('open'),
  };
}
function message(ticketId, messageId, senderUid, senderType) {
  return {
    schemaVersion: i(1),
    contractVersion: s('support-cases-v1'),
    ticketId: s(ticketId),
    messageId: s(messageId),
    senderUid: s(senderUid),
    senderType: s(senderType),
    body: s('Plain support message'),
  };
}
function deletionRequest(ownerUid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('account-deletion-request-v1'),
    ownerUid: s(ownerUid),
    status: s('requested'),
    requestedAt: ts(now),
  };
}
function deletionOperation(ownerUid, actorUid, status) {
  return {
    schemaVersion: i(1),
    contractVersion: s('account-deletion-operations-v1'),
    ownerUid: s(ownerUid),
    status: s(status),
    assignedOperatorUid: s(actorUid),
  };
}
function verificationCase(caseId, outcome = 'pending') {
  return {
    schemaVersion: i(1),
    contractVersion: s('verification-review-v1'),
    caseId: s(caseId),
    subjectUid: s(athlete.localId),
    sourceType: s('future-bounded-evidence'),
    sourceId: s('source-1'),
    outcome: s(outcome),
  };
}
function auditEvent(eventId, actorUid, roles, action) {
  return {
    schemaVersion: i(1),
    contractVersion: s('platform-enforcement-v1'),
    eventId: s(eventId),
    actorUid: s(actorUid),
    actorRoles: arr(roles.map(s)),
    action: s(action),
    targetType: s('profile'),
    targetId: s(other.localId),
    reasonCode: s('privacy'),
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
  const signup = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.ok(signup.ok);
  const created = await signup.json();
  if (!roles.length) return created;
  await getAuth(adminApp).setCustomUserClaims(created.localId, { optiformRoles: roles });
  const signin = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.ok(signin.ok);
  return signin.json();
}
async function get(path, token) {
  return fetch(`${base}/${path}`, { headers: headers(token) });
}
async function update(path, fields, token) {
  return fetch(`${base}/${path}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function remove(path, token) {
  return fetch(`${base}/${path}`, { method: 'DELETE', headers: headers(token) });
}
async function serverWrite(kind, path, fields, token, transforms) {
  const write = {
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields },
    updateTransforms: transforms.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    })),
  };
  if (kind === 'update') write.currentDocument = { exists: true };
  else write.currentDocument = { exists: false };
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes: [write] }),
  });
  if (!response.ok && response.status !== 403)
    throw new Error(`Server write failed (${response.status}): ${await response.text()}`);
  return response;
}
async function createSupportCase(
  ticketId,
  ownerUid,
  messageId,
  senderUid,
  senderType,
  token,
  overrides = {},
) {
  const ticketFields = ticket(ticketId, ownerUid);
  if (overrides.category) ticketFields.category = s(overrides.category);
  const messageFields = message(
    overrides.messageTicketId ?? ticketId,
    messageId,
    senderUid,
    senderType,
  );
  if (overrides.body) messageFields.body = s(overrides.body);
  const writes = [
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/supportTickets/${ticketId}`,
        fields: ticketFields,
      },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
      currentDocument: { exists: false },
    },
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/supportTickets/${ticketId}/messages/${messageId}`,
        fields: messageFields,
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    },
  ];
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes }),
  });
  if (!response.ok && response.status !== 403)
    throw new Error(`Support case batch failed (${response.status}): ${await response.text()}`);
  return response;
}
async function removeModeratedProfile(ownerUid, sourceReportId, actorUid, token) {
  const auditId = 'audit-p40-remove-profile';
  const authorizationPath = `moderationTargetAuthorizations/profile/owners/${ownerUid}`;
  const authorizationFields = authorization(ownerUid, sourceReportId, ownerUid, actorUid);
  authorizationFields.action = s('remove-profile');
  authorizationFields.auditEventId = s(auditId);
  const writes = [
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/${authorizationPath}`,
        fields: authorizationFields,
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: true },
    },
    {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/platformAudit/${auditId}`,
        fields: auditEvent(auditId, actorUid, ['moderator'], 'remove-profile'),
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    },
    {
      delete: `projects/${projectId}/databases/(default)/documents/socialProfiles/${ownerUid}`,
      currentDocument: { exists: true },
    },
  ];
  return fetch(`${base}:commit`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ writes }),
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
  if (!response.ok && response.status !== 409)
    throw new Error(`Admin fixture write failed (${response.status}): ${await response.text()}`);
}
function allow(response) {
  assert.ok(response.ok, `expected allow, received ${response.status}`);
}
function deny(response) {
  assert.equal(response.status, 403);
}
