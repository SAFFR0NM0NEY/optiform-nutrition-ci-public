import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { getMessaging, type Messaging } from 'firebase/messaging';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirebaseEmulatorConfig } from './firebaseEmulator';

export const firebaseBrowserConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
} satisfies FirebaseOptions;

export const isFirebaseConfigured = Object.values(firebaseBrowserConfig).every(Boolean);

let firestoreDb: Firestore | null = null;
let firestoreEmulatorConnected = false;
let firebaseAuth: Auth | null = null;
let authPersistence: Promise<void> | null = null;
let authEmulatorConnected = false;
let firebaseStorage: FirebaseStorage | null = null;
let storageEmulatorConnected = false;
let firebaseFunctions: Functions | null = null;
let firebaseMessaging: Messaging | null = null;
let functionsEmulatorConnected = false;

export function getFirebaseApp(): FirebaseApp | null {
  // Validate emulator mode even when the ordinary hosted configuration is incomplete. A local
  // acceptance request must fail loudly instead of degrading into an unconfigured/hosted client.
  getFirebaseEmulatorConfig();

  if (!isFirebaseConfigured) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseBrowserConfig);
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseAuth ??= getAuth(app);
  const emulator = getFirebaseEmulatorConfig();
  if (emulator && !authEmulatorConnected) {
    connectAuthEmulator(firebaseAuth, `http://${emulator.auth.authority}`, {
      disableWarnings: true,
    });
    authEmulatorConnected = true;
  }
  authPersistence ??= setPersistence(firebaseAuth, browserLocalPersistence);
  return firebaseAuth;
}

export async function ensureFirebaseAuthPersistence() {
  getFirebaseAuth();
  await authPersistence;
}

export function getFirebaseDb(): Firestore | null {
  const app = getFirebaseApp();

  if (!app) {
    return null;
  }

  firestoreDb ??= getFirestore(app);
  const emulator = getFirebaseEmulatorConfig();
  if (emulator && !firestoreEmulatorConnected) {
    connectFirestoreEmulator(firestoreDb, emulator.firestore.hostname, emulator.firestore.port);
    firestoreEmulatorConnected = true;
  }
  return firestoreDb;
}

export function getFirebaseStorage(): FirebaseStorage | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseStorage ??= getStorage(app);
  const emulator = getFirebaseEmulatorConfig();
  if (emulator && !storageEmulatorConnected) {
    connectStorageEmulator(firebaseStorage, emulator.storage.hostname, emulator.storage.port);
    storageEmulatorConnected = true;
  }
  return firebaseStorage;
}

export function getFirebaseFunctions(): Functions | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseFunctions ??= getFunctions(app, 'africa-south1');
  const emulator = getFirebaseEmulatorConfig();
  if (emulator && !functionsEmulatorConnected) {
    connectFunctionsEmulator(
      firebaseFunctions,
      emulator.functions.hostname,
      emulator.functions.port,
    );
    functionsEmulatorConnected = true;
  }
  return firebaseFunctions;
}

export function getFirebaseMessaging(): Messaging | null {
  const app = getFirebaseApp();
  if (!app || typeof window === 'undefined') return null;
  // Firebase has no local Messaging emulator. Keep it disabled in acceptance mode rather than
  // allowing a local browser session to initialize a hosted messaging/installations path.
  if (getFirebaseEmulatorConfig()) return null;
  firebaseMessaging ??= getMessaging(app);
  return firebaseMessaging;
}
