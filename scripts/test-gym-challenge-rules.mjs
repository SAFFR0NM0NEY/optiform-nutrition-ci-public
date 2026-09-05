import { strict as assert } from 'node:assert';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore as getClientFirestore,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT;
if (
  projectId !== 'demo-optiform-nutrition' ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error('P38B tests require the exact demo emulators.');
setLogLevel('silent');
const app = getApps()[0] ?? initializeApp({ projectId });
const auth = getAuth(app),
  admin = getFirestore(app),
  password = 'Test-password-123';
const owner = await principal('p38b-owner@example.invalid');
const member = await principal('p38b-member@example.invalid');
const other = await principal('p38b-other@example.invalid');
const staff = await principal('p38b-staff@example.invalid');
const inactive = await principal('p38b-inactive@example.invalid');
const outsider = await principal('p38b-outsider@example.invalid');
const ownerDb = await client('p38b-owner', owner.email);
const memberDb = await client('p38b-member', member.email);
const otherDb = await client('p38b-other', other.email);
const staffDb = await client('p38b-staff', staff.email);
const inactiveDb = await client('p38b-inactive', inactive.email);
const outsiderDb = await client('p38b-outsider', outsider.email);
const gymId = 'P38BCHAXXENGEGYM';
const challengeId = 'P38BCHAXXENGE001';
const participantId = 'P38BPARTJCJPANT1';
const now = Date.now();
const startsAt = new Date(now + 60 * 60 * 1000);

await seedGym();

await deny(
  setDoc(doc(outsiderDb, 'gymChallenges', challengeId), challenge()),
  'non-owner challenge create',
);
await deny(
  setDoc(doc(staffDb, 'gymChallenges', challengeId), challenge()),
  'staff-only challenge create',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), { ...challenge(), createdAt: new Date() }),
  'spoofed creation timestamp',
);
await deny(
  setDoc(
    doc(ownerDb, 'gymChallenges', challengeId),
    challenge({ startsAt: new Date(now + 5 * 60 * 1000) }),
  ),
  'start too early',
);
await deny(
  setDoc(
    doc(ownerDb, 'gymChallenges', challengeId),
    challenge({ startsAt: new Date(now + 8 * 86400000) }),
  ),
  'start too late',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), { ...challenge(), type: 'volume' }),
  'unsupported challenge type',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), { ...challenge(), score: 4 }),
  'unsupported score configuration',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), {
    ...challenge(),
    endsAt: new Date(startsAt.getTime() + 6 * 86400000),
  }),
  'wrong challenge end',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), {
    ...challenge(),
    finalizeAfter: new Date(startsAt.getTime() + 8 * 86400000),
  }),
  'wrong sync deadline',
);
await deny(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), challenge({ participantCount: 1 })),
  'nonzero initial participant count',
);
await allow(
  setDoc(doc(ownerDb, 'gymChallenges', challengeId), challenge()),
  'owner challenge create',
);
await deny(
  updateDoc(doc(ownerDb, 'gymChallenges', challengeId), {
    title: 'Changed',
    updatedAt: serverTimestamp(),
  }),
  'immutable challenge terms',
);
const ownerCancelId = 'P38B0WNERCANCEX1';
await allow(
  setDoc(doc(ownerDb, 'gymChallenges', ownerCancelId), challenge({ challengeId: ownerCancelId })),
  'owner cancellable challenge',
);
await allow(
  updateDoc(doc(ownerDb, 'gymChallenges', ownerCancelId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }),
  'owner pre-start cancellation',
);
await deny(
  updateDoc(doc(ownerDb, 'gymChallenges', ownerCancelId), {
    status: 'enabled',
    updatedAt: serverTimestamp(),
  }),
  'cancelled challenge reactivation',
);
await deny(getDoc(doc(outsiderDb, 'gymChallenges', challengeId)), 'non-member challenge read');
await deny(getDoc(doc(staffDb, 'gymChallenges', challengeId)), 'staff-only challenge read');
await allow(getDoc(doc(memberDb, 'gymChallenges', challengeId)), 'active member challenge read');

await deny(join(ownerDb, owner.uid, 'P38B0WNERPART001'), 'owner without athlete membership join');
await deny(join(outsiderDb, outsider.uid, 'P38BN0NMEMBER001'), 'nonmember join');
await deny(join(inactiveDb, inactive.uid, 'P38BJNACTJVE001'), 'inactive member join');
await deny(
  join(memberDb, member.uid, participantId, { includeProjection: false }),
  'join without public projection',
);
await deny(
  join(memberDb, member.uid, participantId, { countIncrement: 2 }),
  'forged participant count',
);
await deny(
  join(memberDb, member.uid, participantId, { displayName: 'Forged Name' }),
  'forged display name',
);
await deny(
  join(memberDb, member.uid, participantId, { projectionId: 'P38BF0RGEDPART01' }),
  'forged participant projection identity',
);
await allow(join(memberDb, member.uid, participantId), 'active member atomic join');
await deny(join(memberDb, member.uid, 'P38BSEC0NDPART01'), 'duplicate UID join');
await allow(
  getDoc(doc(memberDb, 'gymChallengeParticipantControls', challengeId, 'participants', member.uid)),
  'participant reads own control',
);
await deny(
  getDoc(doc(ownerDb, 'gymChallengeParticipantControls', challengeId, 'participants', member.uid)),
  'owner participant UID control',
);
await deny(
  getDocs(
    query(collection(ownerDb, 'gymChallengeParticipantControls', challengeId, 'participants')),
  ),
  'owner participant UID list',
);
const publicParticipant = (
  await getDoc(doc(ownerDb, 'gymChallenges', challengeId, 'participants', participantId))
).data();
assert.equal('participantUid' in publicParticipant, false);
assert.equal('memberUid' in publicParticipant, false);
await allow(
  getDocs(query(collection(memberDb, 'gymChallenges', challengeId, 'participants'))),
  'member participant leaderboard list',
);

const cancelledId = 'P38BCANCEXXED001';
await admin.doc(`gymChallenges/${cancelledId}`).set({
  ...challenge({ challengeId: cancelledId, status: 'cancelled', cancelledAt: new Date() }),
  createdAt: new Date(),
  updatedAt: new Date(),
});
await deny(
  join(otherDb, other.uid, 'P38BCANCEXPART01', { challengeId: cancelledId }),
  'cancelled challenge join',
);
const fullId = 'P38BFAXXCHAXX001';
await admin.doc(`gymChallenges/${fullId}`).set({
  ...challenge({ challengeId: fullId, participantCount: 50 }),
  createdAt: new Date(),
  updatedAt: new Date(),
});
await deny(
  join(otherDb, other.uid, 'P38BFAXXPART0001', { challengeId: fullId }),
  '50 participant cap',
);
const startedId = 'P38BSTARTED00001';
await admin.doc(`gymChallenges/${startedId}`).set({
  ...challenge({ challengeId: startedId, startsAt: new Date(now - 60000) }),
  createdAt: new Date(now - 86400000),
  updatedAt: new Date(),
});
await deny(
  join(otherDb, other.uid, 'P38BSTARTPART001', { challengeId: startedId }),
  'join after challenge start',
);

const activeStarts = new Date(now - 2 * 86400000);
await admin.doc(`gymChallenges/${challengeId}`).update({
  startsAt: activeStarts,
  endsAt: new Date(activeStarts.getTime() + 7 * 86400000),
  finalizeAfter: new Date(activeStarts.getTime() + 9 * 86400000),
  updatedAt: new Date(),
});
const completedAt = new Date(activeStarts.getTime() + 25 * 60 * 60 * 1000);
await admin
  .doc(`athletes/${member.uid}/workouts/workout-own`)
  .set(workout(member.uid, 'workout-own', completedAt));
await admin
  .doc(`athletes/${other.uid}/workouts/workout-other`)
  .set(workout(other.uid, 'workout-other', completedAt));
await admin.doc(`athletes/${member.uid}/workouts/workout-invalid`).set({
  ownerUid: member.uid,
  workoutId: 'workout-invalid',
  completedAt,
});
const evidenceId = `${participantId}_1`;
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { includePublic: false }),
  'private evidence without projection',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { includePrivate: false }),
  'public evidence without provenance',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { sourceWorkoutId: 'missing' }),
  'missing workout source',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { sourceWorkoutId: 'workout-other' }),
  'another athlete workout source',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, new Date(completedAt.getTime() + 1)),
  'completed time mismatch',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, {
    sourceWorkoutId: 'workout-invalid',
  }),
  'incomplete workout record',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { dayIndex: 2 }),
  'wrong challenge day',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, {
    publicParticipantId: 'P38BF0RGEDPART01',
  }),
  'mismatched safe participant identity',
);
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt, { publicPointValue: 2 }),
  'mismatched safe evidence point',
);
await allow(evidence(memberDb, member.uid, evidenceId, completedAt), 'valid atomic own evidence');
await deny(
  evidence(memberDb, member.uid, evidenceId, completedAt),
  'duplicate participant day evidence',
);
const safeEvidence = (
  await getDoc(doc(ownerDb, 'gymChallenges', challengeId, 'evidence', evidenceId))
).data();
for (const privateField of [
  'participantUid',
  'sourceWorkoutId',
  'sourceCompletedAt',
  'completedAt',
])
  assert.equal(privateField in safeEvidence, false, `${privateField} leaked into safe evidence`);
await allow(
  getDocs(query(collection(memberDb, 'gymChallenges', challengeId, 'evidence'))),
  'member safe evidence list',
);
await deny(
  getDoc(doc(ownerDb, 'gymChallengeEvidenceControls', challengeId, 'entries', evidenceId)),
  'owner private provenance',
);
await deny(
  getDoc(doc(staffDb, 'gymChallengeEvidenceControls', challengeId, 'entries', evidenceId)),
  'staff private provenance',
);
await deny(
  getDoc(doc(otherDb, 'gymChallengeEvidenceControls', challengeId, 'entries', evidenceId)),
  'other member private provenance',
);
await allow(
  getDoc(doc(memberDb, 'gymChallengeEvidenceControls', challengeId, 'entries', evidenceId)),
  'athlete own provenance',
);
const cancelledParticipantId = 'P38BCANCEPART001';
await seedParticipation(cancelledId, member.uid, cancelledParticipantId);
const cancelledCompletedAt = new Date(startsAt.getTime() + 60000);
await admin
  .doc(`athletes/${member.uid}/workouts/workout-cancelled`)
  .set(workout(member.uid, 'workout-cancelled', cancelledCompletedAt));
await deny(
  evidence(memberDb, member.uid, `${cancelledParticipantId}_0`, cancelledCompletedAt, {
    challengeId: cancelledId,
    participantId: cancelledParticipantId,
    sourceWorkoutId: 'workout-cancelled',
    dayIndex: 0,
  }),
  'cancelled challenge evidence',
);
const settledId = 'P38BSETTLED00001';
const settledParticipantId = 'P38BSETTLEPART01';
const settledStarts = new Date(now - 10 * 86400000);
await admin.doc(`gymChallenges/${settledId}`).set({
  ...challenge({ challengeId: settledId, startsAt: settledStarts, participantCount: 1 }),
  createdAt: new Date(now - 11 * 86400000),
  updatedAt: new Date(),
});
await seedParticipation(settledId, member.uid, settledParticipantId);
const settledCompletedAt = new Date(settledStarts.getTime() + 60000);
await admin
  .doc(`athletes/${member.uid}/workouts/workout-settled`)
  .set(workout(member.uid, 'workout-settled', settledCompletedAt));
await deny(
  evidence(memberDb, member.uid, `${settledParticipantId}_0`, settledCompletedAt, {
    challengeId: settledId,
    participantId: settledParticipantId,
    sourceWorkoutId: 'workout-settled',
    dayIndex: 0,
  }),
  'evidence after sync grace',
);
const archivedId = 'P38BARCHJVED0001';
const oldStart = new Date(now - 10 * 86400000);
await admin.doc(`gymChallenges/${archivedId}`).set({
  ...challenge({ challengeId: archivedId, startsAt: oldStart }),
  createdAt: new Date(now - 11 * 86400000),
  updatedAt: new Date(),
});
await allow(
  updateDoc(doc(ownerDb, 'gymChallenges', archivedId), {
    status: 'archived',
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }),
  'owner archive after grace',
);

await admin
  .doc(`gymMemberships/${gymId}/members/${member.uid}`)
  .update({ status: 'left', endedAt: new Date(), updatedAt: new Date() });
await deny(getDoc(doc(memberDb, 'gymChallenges', challengeId)), 'former member challenge read');
await deny(
  evidence(
    memberDb,
    member.uid,
    `${participantId}_2`,
    new Date(activeStarts.getTime() + 49 * 60 * 60 * 1000),
  ),
  'inactive member evidence',
);
await admin
  .doc(`gymMemberships/${gymId}/members/${member.uid}`)
  .set(membership(member.uid, 'P38BREJJNMEMBER1', 2));
await deny(
  evidence(
    memberDb,
    member.uid,
    `${participantId}_2`,
    new Date(activeStarts.getTime() + 49 * 60 * 60 * 1000),
  ),
  'changed membership cycle evidence',
);

await admin.doc(`gymBusinessProfiles/${gymId}`).update({ status: 'paused' });
await deny(getDoc(doc(memberDb, 'gymChallenges', challengeId)), 'paused gym member challenge read');
await admin
  .doc(`gymBusinessProfiles/${gymId}`)
  .update({ status: 'active', platformStatus: 'suspended' });
await deny(
  getDoc(doc(memberDb, 'gymChallenges', challengeId)),
  'suspended gym member challenge read',
);
await admin.doc(`gymBusinessProfiles/${gymId}`).update({ platformStatus: 'active' });

for (const path of [
  `athletes/${other.uid}`,
  `athletes/${other.uid}/workouts/private`,
  `athletes/${other.uid}/programEnrollments/private`,
  `athletes/${other.uid}/nutritionEntries/private`,
  `athletes/${other.uid}/wellnessEntries/private`,
  `athletes/${other.uid}/measurements/private`,
  `athletes/${other.uid}/progressPhotos/private`,
  `athletes/${other.uid}/notifications/private`,
  'coachRelationships/private',
]) {
  await admin.doc(path).set({ ownerUid: other.uid, private: true });
  await deny(getDoc(doc(ownerDb, path)), `owner athlete isolation ${path}`);
  await deny(getDoc(doc(staffDb, path)), `staff athlete isolation ${path}`);
}

console.log(
  'P38B gym challenge rules verified: owner creation, explicit bounded participation, UID-free projections, own-workout atomic evidence, cycle binding and athlete isolation passed.',
);
process.exit(0);

function challenge(overrides = {}) {
  const id = overrides.challengeId ?? challengeId;
  const start = overrides.startsAt ?? startsAt;
  const status = overrides.status ?? 'enabled';
  return {
    schemaVersion: 1,
    contractVersion: 'gym-challenges-v1',
    challengeId: id,
    gymId,
    title: 'September consistency',
    description: 'Train on four days.',
    type: 'training-days',
    status,
    participantCount: overrides.participantCount ?? 0,
    createdAt: serverTimestamp(),
    startsAt: start,
    endsAt: new Date(start.getTime() + 7 * 86400000),
    finalizeAfter: new Date(start.getTime() + 9 * 86400000),
    updatedAt: serverTimestamp(),
    ...(overrides.cancelledAt ? { cancelledAt: overrides.cancelledAt } : {}),
  };
}
function membership(uid, memberId, cycle = 1, status = 'active') {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-membership-v1',
    gymId,
    memberUid: uid,
    memberId,
    displayNameSnapshot:
      uid === member.uid ? 'Member One' : uid === other.uid ? 'Member Two' : 'Inactive Member',
    inviteCodeUsed: 'P38BMEMBERJNV001',
    cycle,
    status,
    joinedAt: new Date(),
    updatedAt: new Date(),
    ...(status === 'active' ? {} : { endedAt: new Date() }),
  };
}
async function seedGym() {
  await admin.doc(`gymBusinessControls/${gymId}`).set({
    schemaVersion: 1,
    contractVersion: 'gym-business-v1',
    gymId,
    ownerUid: owner.uid,
    currentInviteCode: 'P38BMEMBERJNV001',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await admin.doc(`gymBusinessProfiles/${gymId}`).set({
    schemaVersion: 1,
    contractVersion: 'gym-business-v1',
    gymId,
    displayName: 'Challenge Gym',
    description: '',
    status: 'active',
    platformStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await admin
    .doc(`gymMemberships/${gymId}/members/${member.uid}`)
    .set(membership(member.uid, 'P38BMEMBER000001'));
  await admin
    .doc(`gymMemberships/${gymId}/members/${other.uid}`)
    .set(membership(other.uid, 'P38BMEMBER000002'));
  await admin
    .doc(`gymMemberships/${gymId}/members/${inactive.uid}`)
    .set(membership(inactive.uid, 'P38BMEMBER000003', 1, 'left'));
  await admin.doc(`gymStaffMemberships/${gymId}/staffMembers/${staff.uid}`).set({
    schemaVersion: 1,
    contractVersion: 'gym-staff-membership-v1',
    historyContractVersion: 'gym-staff-access-history-v1',
    capabilityContractVersion: 'gym-staff-capabilities-v1',
    gymId,
    staffUid: staff.uid,
    staffId: 'P38BSTAFF0000001',
    displayNameSnapshot: 'Staff Only',
    role: 'manager',
    capabilities: [
      'gym-profile-edit',
      'gym-member-invite-manage',
      'gym-member-directory-read',
      'gym-announcements-manage',
      'gym-stations-manage',
    ],
    status: 'active',
    cycle: 1,
    revision: 1,
    inviteCodeUsed: 'P38BSTAFFJNV0001',
    joinedAt: new Date(),
    updatedAt: new Date(),
  });
}
function join(db, uid, id, options = {}) {
  const cid = options.challengeId ?? challengeId;
  const batch = writeBatch(db);
  batch.update(doc(db, 'gymChallenges', cid), {
    participantCount: (options.currentCount ?? 0) + (options.countIncrement ?? 1),
    updatedAt: serverTimestamp(),
  });
  const control = {
    schemaVersion: 1,
    contractVersion: 'gym-challenge-participation-v1',
    challengeId: cid,
    gymId,
    participantUid: uid,
    participantId: id,
    membershipCycle: 1,
    joinedAt: serverTimestamp(),
  };
  batch.set(doc(db, 'gymChallengeParticipantControls', cid, 'participants', uid), control);
  if (options.includeProjection !== false)
    batch.set(doc(db, 'gymChallenges', cid, 'participants', options.projectionId ?? id), {
      schemaVersion: 1,
      contractVersion: 'gym-challenge-participation-v1',
      challengeId: cid,
      gymId,
      participantId: id,
      displayName:
        options.displayName ??
        (uid === member.uid ? 'Member One' : uid === other.uid ? 'Member Two' : 'Outsider'),
      joinedAt: serverTimestamp(),
    });
  return batch.commit();
}
function evidence(db, uid, id, completedAt, options = {}) {
  const cid = options.challengeId ?? challengeId;
  const dayIndex = options.dayIndex ?? 1;
  const participant = options.participantId ?? id.slice(0, -2);
  const source = {
    schemaVersion: 1,
    contractVersion: 'gym-challenge-evidence-v1',
    challengeId: cid,
    gymId,
    participantUid: uid,
    participantId: participant,
    membershipCycle: 1,
    evidenceId: id,
    dayIndex,
    pointValue: 1,
    sourceWorkoutId: options.sourceWorkoutId ?? 'workout-own',
    sourceCompletedAt: completedAt,
    createdAt: serverTimestamp(),
  };
  const projection = {
    schemaVersion: 1,
    contractVersion: 'gym-challenge-evidence-v1',
    challengeId: cid,
    gymId,
    evidenceId: id,
    participantId: options.publicParticipantId ?? participant,
    dayIndex,
    pointValue: options.publicPointValue ?? 1,
  };
  const batch = writeBatch(db);
  if (options.includePrivate !== false)
    batch.set(doc(db, 'gymChallengeEvidenceControls', cid, 'entries', id), source);
  if (options.includePublic !== false)
    batch.set(doc(db, 'gymChallenges', cid, 'evidence', id), projection);
  return batch.commit();
}
async function seedParticipation(cid, uid, id) {
  await admin.doc(`gymChallengeParticipantControls/${cid}/participants/${uid}`).set({
    schemaVersion: 1,
    contractVersion: 'gym-challenge-participation-v1',
    challengeId: cid,
    gymId,
    participantUid: uid,
    participantId: id,
    membershipCycle: 1,
    joinedAt: new Date(),
  });
  await admin.doc(`gymChallenges/${cid}/participants/${id}`).set({
    schemaVersion: 1,
    contractVersion: 'gym-challenge-participation-v1',
    challengeId: cid,
    gymId,
    participantId: id,
    displayName: 'Member One',
    joinedAt: new Date(),
  });
}
function workout(uid, workoutId, completedAt) {
  return {
    schemaVersion: 1,
    recordOrigin: 'athlete-client',
    sourceSessionSchemaVersion: 3,
    workoutId,
    ownerUid: uid,
    startedAt: new Date(completedAt.getTime() - 3600000),
    completedAt,
    note: '',
    exercises: [{ exerciseId: 'synthetic-exercise', sets: [] }],
  };
}
async function principal(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return auth.createUser({ email, password });
  }
}
async function client(name, email) {
  const clientApp = initializeClientApp({ projectId, apiKey: 'fake' }, name);
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(clientAuth, email, password);
  const db = getClientFirestore(clientApp);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  return db;
}
async function allow(promise, label) {
  try {
    await promise;
  } catch (error) {
    throw new Error(`${label} denied: ${error.message}`, { cause: error });
  }
}
async function deny(promise, label) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly allowed`);
}
