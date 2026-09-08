import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth as clientAuthFor,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore as clientDbFor,
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
  throw new Error('Demo emulators required.');
setLogLevel('silent');
const app = getApps()[0] ?? initializeApp({ projectId }),
  auth = getAuth(app),
  admin = getFirestore(app),
  password = 'Test-password-123';
const owner = await principal('staff-owner@example.invalid'),
  manager = await principal('staff-manager@example.invalid'),
  assistant = await principal('staff-assistant@example.invalid'),
  outsider = await principal('staff-outsider@example.invalid');
const ownerDb = await client('staff-owner', owner.email),
  managerDb = await client('staff-manager', manager.email),
  assistantDb = await client('staff-assistant', assistant.email),
  outsiderDb = await client('staff-outsider', outsider.email);
const gymId = 'P41ASTAFFGYM0001',
  inviteCode = 'P41ASTAFFJNV0001',
  staffId = 'P41ASTAFFMEM0001',
  now = new Date();
await admin.doc(`gymBusinessControls/${gymId}`).set({
  schemaVersion: 1,
  contractVersion: 'gym-business-v1',
  gymId,
  ownerUid: owner.uid,
  currentInviteCode: 'P41AMEMBERJNV001',
  createdAt: now,
  updatedAt: now,
});
await admin.doc(`gymBusinessProfiles/${gymId}`).set({
  schemaVersion: 1,
  contractVersion: 'gym-business-v1',
  gymId,
  displayName: 'Synthetic Gym',
  description: '',
  status: 'active',
  platformStatus: 'active',
  createdAt: now,
  updatedAt: now,
});
await deny(
  setDoc(doc(outsiderDb, 'gymStaffInvites', inviteCode), staffInvite()),
  'non-owner invite create',
);
await deny(
  setDoc(doc(ownerDb, 'gymStaffInvites', inviteCode), { ...staffInvite(), role: 'admin' }),
  'invalid staff role',
);
await deny(
  setDoc(doc(ownerDb, 'gymStaffInvites', inviteCode), {
    ...staffInvite(),
    role: 'assistant',
    capabilities: ['gym-profile-edit'],
  }),
  'assistant elevated capability',
);
await deny(
  setDoc(doc(ownerDb, 'gymStaffInvites', inviteCode), {
    ...staffInvite(),
    createdAt: new Date(now.getTime() + 60000),
  }),
  'client-dated invite',
);
await deny(
  setDoc(doc(ownerDb, 'gymStaffInvites', inviteCode), {
    ...staffInvite(),
    expiresAt: new Date(now.getTime() + 8 * 86400000),
  }),
  'overlong invite',
);
await allow(
  setDoc(doc(ownerDb, 'gymStaffInvites', inviteCode), {
    ...staffInvite(),
    createdAt: serverTimestamp(),
  }),
  'owner staff invite',
);
await allow(getDoc(doc(managerDb, 'gymStaffInvites', inviteCode)), 'exact staff invite preview');
await deny(getDocs(query(collection(managerDb, 'gymStaffInvites'))), 'staff invite browsing');
await deny(attemptJoin(ownerDb, owner.uid, 'AAAAAAAAAAAAAAAA'), 'owner accepting own invite');
await deny(
  attemptJoin(managerDb, manager.uid, staffId, { includeHistory: false }),
  'staff join without history',
);
await deny(
  attemptJoin(managerDb, manager.uid, staffId, { includeIndex: false }),
  'staff join without index',
);
await deny(
  attemptJoin(managerDb, manager.uid, staffId, { acceptInvite: false }),
  'staff join without accepting invite',
);
await allow(attemptJoin(managerDb, manager.uid, staffId), 'valid staff join');
const membershipPath = `gymStaffMemberships/${gymId}/staffMembers/${manager.uid}`;
const membership = (await getDoc(doc(managerDb, membershipPath))).data();
assert.equal(membership.revision, 1);
assert.equal(membership.cycle, 1);
await deny(
  updateDoc(doc(managerDb, membershipPath), {
    capabilities: ['gym-stations-manage'],
    revision: 2,
    updatedAt: serverTimestamp(),
  }),
  'staff self capability edit',
);
await deny(
  setDoc(doc(managerDb, 'gymStaffInvites', '5555555555555555'), {
    ...staffInvite(),
    code: '5555555555555555',
    createdAt: serverTimestamp(),
  }),
  'manager staff-team delegation',
);
await allow(
  updateDoc(doc(managerDb, 'gymBusinessProfiles', gymId), {
    displayName: 'Managed Gym',
    description: 'Updated.',
    updatedAt: serverTimestamp(),
  }),
  'manager profile capability',
);
await deny(
  updateDoc(doc(managerDb, 'gymBusinessProfiles', gymId), {
    status: 'paused',
    updatedAt: serverTimestamp(),
  }),
  'staff gym status',
);
await admin.doc('exercises/back-squat').set({ source: 'system', status: 'published' });
await allow(
  setDoc(doc(managerDb, 'gymAnnouncements', gymId, 'items', 'a1'), announcement()),
  'staff announcement capability',
);
await allow(
  setDoc(doc(managerDb, 'gymStations', '6666666666666666'), station()),
  'staff station capability',
);
await deny(
  getDoc(doc(managerDb, `gymMemberships/${gymId}/members/${outsider.uid}`)),
  'staff private member control',
);
await deny(
  getDoc(doc(managerDb, `gymMemberDirectoryControls/${gymId}/entries/7777777777777777`)),
  'staff UID mapping',
);
for (const path of [
  `athletes/${outsider.uid}`,
  `athletes/${outsider.uid}/completedWorkouts/w1`,
  `athletes/${outsider.uid}/programEnrollments/p1`,
  `athletes/${outsider.uid}/nutritionEntries/n1`,
  `athletes/${outsider.uid}/wellnessEntries/w1`,
  `athletes/${outsider.uid}/measurements/m1`,
  `athletes/${outsider.uid}/progressPhotos/p1`,
  `athletes/${outsider.uid}/notifications/n1`,
  `coachRelationships/r1`,
]) {
  await admin.doc(path).set({ ownerUid: outsider.uid, secret: true });
  await deny(getDoc(doc(managerDb, path)), `staff athlete isolation ${path}`);
}
await deny(
  updateDoc(doc(managerDb, `gymMemberships/${gymId}/members/${outsider.uid}`), {
    status: 'removed',
  }),
  'staff member removal',
);
const assistantCode = '8888888888888888';
await allow(
  setDoc(doc(ownerDb, 'gymStaffInvites', assistantCode), {
    ...staffInvite(),
    code: assistantCode,
    role: 'assistant',
    capabilities: ['gym-announcements-manage'],
    createdAt: serverTimestamp(),
  }),
  'assistant invite',
);
await allow(
  attemptJoin(assistantDb, assistant.uid, '9999999999999999', {
    code: assistantCode,
    role: 'assistant',
    capabilities: ['gym-announcements-manage'],
  }),
  'assistant join',
);
await deny(
  setDoc(doc(assistantDb, 'gymStations', 'BBBBBBBBBBBBBBBB'), station('BBBBBBBBBBBBBBBB')),
  'staff without station capability',
);
await deny(
  updateDoc(doc(assistantDb, 'gymBusinessProfiles', gymId), {
    displayName: 'No',
    updatedAt: serverTimestamp(),
  }),
  'staff without profile capability',
);
await deny(attemptEnd(managerDb, membership, 'left', false), 'staff leave missing history');
await allow(attemptEnd(managerDb, membership, 'left', true), 'valid staff leave');
await deny(
  setDoc(doc(managerDb, 'gymAnnouncements', gymId, 'items', 'a2'), announcement('a2')),
  'authority lost immediately',
);
console.log(
  'P41A staff rules verified: owner-only team administration, capability ceilings, atomic audit history, operational separation and athlete isolation passed.',
);
process.exit(0);

function staffInvite() {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-staff-invite-v1',
    code: inviteCode,
    gymId,
    role: 'manager',
    capabilities: [
      'gym-profile-edit',
      'gym-member-invite-manage',
      'gym-member-directory-read',
      'gym-announcements-manage',
      'gym-stations-manage',
    ],
    status: 'active',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 7 * 86400000),
  };
}
function staffMembership(
  uid,
  id,
  code = inviteCode,
  role = 'manager',
  capabilities = staffInvite().capabilities,
) {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-staff-membership-v1',
    historyContractVersion: 'gym-staff-access-history-v1',
    capabilityContractVersion: 'gym-staff-capabilities-v1',
    gymId,
    staffUid: uid,
    staffId: id,
    displayNameSnapshot: 'Synthetic Staff',
    role,
    capabilities,
    status: 'active',
    cycle: 1,
    revision: 1,
    inviteCodeUsed: code,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
function attemptJoin(db, uid, id, options = {}) {
  const code = options.code ?? inviteCode,
    value = staffMembership(uid, id, code, options.role, options.capabilities),
    batch = writeBatch(db);
  batch.set(doc(db, 'gymStaffMemberships', gymId, 'staffMembers', uid), value);
  if (options.includeHistory !== false)
    batch.set(doc(db, 'gymStaffMemberships', gymId, 'staffMembers', uid, 'history', '1'), value);
  if (options.includeIndex !== false)
    batch.set(doc(db, 'gymStaffIndexes', uid, 'items', gymId), {
      schemaVersion: 1,
      contractVersion: 'gym-staff-membership-v1',
      ownerUid: uid,
      gymId,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
  if (options.acceptInvite !== false)
    batch.update(doc(db, 'gymStaffInvites', code), {
      status: 'accepted',
      acceptedAt: serverTimestamp(),
    });
  return batch.commit();
}
function attemptEnd(db, current, status, includeHistory) {
  const value = {
      ...current,
      status,
      revision: current.revision + 1,
      updatedAt: serverTimestamp(),
      endedAt: serverTimestamp(),
    },
    batch = writeBatch(db);
  batch.set(doc(db, 'gymStaffMemberships', gymId, 'staffMembers', current.staffUid), value);
  if (includeHistory)
    batch.set(
      doc(
        db,
        'gymStaffMemberships',
        gymId,
        'staffMembers',
        current.staffUid,
        'history',
        String(value.revision),
      ),
      value,
    );
  batch.update(doc(db, 'gymStaffIndexes', current.staffUid, 'items', gymId), {
    status,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}
function announcement(id = 'a1') {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-announcement-v1',
    gymId,
    announcementId: id,
    title: 'Notice',
    body: 'Plain text.',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
function station(id = '6666666666666666') {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-station-qr-v1',
    stationId: id,
    gymId,
    label: 'Rack',
    exerciseId: 'back-squat',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
async function principal(email) {
  try {
    const user = await auth.getUserByEmail(email);
    return { uid: user.uid, email };
  } catch {
    const user = await auth.createUser({ email, password });
    return { uid: user.uid, email };
  }
}
async function client(name, email) {
  const clientApp = initializeClientApp({ projectId, apiKey: 'fake' }, name),
    clientAuth = clientAuthFor(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(clientAuth, email, password);
  const db = clientDbFor(clientApp),
    [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  return db;
}
async function allow(promise, label) {
  await promise.catch((error) => {
    throw new Error(`${label} denied: ${error.message}`);
  });
}
async function deny(promise, label) {
  await assert.rejects(promise, undefined, `${label} allowed`);
}
