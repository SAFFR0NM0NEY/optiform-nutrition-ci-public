import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
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
let firebaseAuth: Auth | null = null;
let authPersistence: Promise<void> | null = null;
let authEmulatorConnected = false;
let firebaseStorage: FirebaseStorage | null = null;
let storageEmulatorConnected = false;
let firebaseFunctions: Functions | null = null;
let firebaseMessaging: Messaging | null = null;
let functionsEmulatorConnected = false;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseBrowserConfig);
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseAuth ??= getAuth(app);
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
    !authEmulatorConnected
  ) {
    connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
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
  return firestoreDb;
}

export function getFirebaseStorage(): FirebaseStorage | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseStorage ??= getStorage(app);
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
    !storageEmulatorConnected
  ) {
    connectStorageEmulator(firebaseStorage, '127.0.0.1', 9199);
    storageEmulatorConnected = true;
  }
  return firebaseStorage;
}

export function getFirebaseFunctions(): Functions | null {
  const app = getFirebaseApp();
  if (!app) return null;
  firebaseFunctions ??= getFunctions(app, 'africa-south1');
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
    !functionsEmulatorConnected
  ) {
    connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001);
    functionsEmulatorConnected = true;
  }
  return firebaseFunctions;
}

export function getFirebaseMessaging(): Messaging | null {
  const app = getFirebaseApp();
  if (!app || typeof window === 'undefined') return null;
  firebaseMessaging ??= getMessaging(app);
  return firebaseMessaging;
}
