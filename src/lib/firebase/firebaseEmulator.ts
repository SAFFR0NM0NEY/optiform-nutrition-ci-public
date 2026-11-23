export const FIREBASE_EMULATOR_PROJECT_ID = 'demo-optiform-nutrition';

type EmulatorEndpointName = 'Auth' | 'Firestore' | 'Storage' | 'Functions';

export type FirebaseEmulatorEndpoint = {
  hostname: string;
  port: number;
  authority: string;
};

export type FirebaseEmulatorConfig = {
  projectId: typeof FIREBASE_EMULATOR_PROJECT_ID;
  auth: FirebaseEmulatorEndpoint;
  firestore: FirebaseEmulatorEndpoint;
  storage: FirebaseEmulatorEndpoint;
  functions: FirebaseEmulatorEndpoint;
};

export type FirebaseEmulatorEnvironment = {
  enabled: boolean;
  isDevelopment: boolean;
  projectId: unknown;
  browserHostname: unknown;
  authHost: unknown;
  firestoreHost: unknown;
  storageHost: unknown;
  functionsHost: unknown;
};

function emulatorError(message: string) {
  return new Error(`Firebase emulator safety check failed: ${message}`);
}

function normalizeHostname(value: string) {
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
}

export function isLoopbackHostname(value: unknown) {
  if (typeof value !== 'string') return false;
  const hostname = normalizeHostname(value);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function parseFirebaseEmulatorFlag(value: unknown) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw emulatorError('VITE_USE_FIREBASE_EMULATORS must be exactly true or false.');
}

function parseEndpoint(name: EmulatorEndpointName, value: unknown): FirebaseEmulatorEndpoint {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw emulatorError(`${name} emulator host is required.`);
  if (raw.includes('://')) throw emulatorError(`${name} emulator host must be host:port only.`);

  let parsed: URL;
  try {
    parsed = new URL(`http://${raw}`);
  } catch {
    throw emulatorError(`${name} emulator host is invalid.`);
  }
  if (
    !isLoopbackHostname(parsed.hostname) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw emulatorError(`${name} emulator host must be an explicit loopback host and port.`);
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw emulatorError(`${name} emulator port is invalid.`);

  return {
    hostname: normalizeHostname(parsed.hostname),
    port,
    authority: raw,
  };
}

export function resolveFirebaseEmulatorConfig(
  environment: FirebaseEmulatorEnvironment,
): FirebaseEmulatorConfig | null {
  if (!environment.enabled) return null;
  if (!environment.isDevelopment)
    throw emulatorError('emulator mode is available only in a development build.');
  if (environment.projectId !== FIREBASE_EMULATOR_PROJECT_ID)
    throw emulatorError(`project ID must be exactly ${FIREBASE_EMULATOR_PROJECT_ID}.`);
  if (!isLoopbackHostname(environment.browserHostname))
    throw emulatorError('the browser must be running on localhost or a loopback address.');

  return {
    projectId: FIREBASE_EMULATOR_PROJECT_ID,
    auth: parseEndpoint('Auth', environment.authHost),
    firestore: parseEndpoint('Firestore', environment.firestoreHost),
    storage: parseEndpoint('Storage', environment.storageHost),
    functions: parseEndpoint('Functions', environment.functionsHost),
  };
}

export function getFirebaseEmulatorConfig(): FirebaseEmulatorConfig | null {
  return resolveFirebaseEmulatorConfig({
    enabled: parseFirebaseEmulatorFlag(import.meta.env.VITE_USE_FIREBASE_EMULATORS),
    isDevelopment: import.meta.env.DEV,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    browserHostname: typeof window === 'undefined' ? '' : window.location.hostname,
    authHost: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
    firestoreHost: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST,
    storageHost: import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST,
    functionsHost: import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST,
  });
}

export function isFirebaseEmulatorMode() {
  return getFirebaseEmulatorConfig() !== null;
}
