import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getFirebaseApp } from './firebaseClient';
import { getFirebaseEmulatorConfig } from './firebaseEmulator';

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  }
}

function appCheckError(code: string) {
  return Object.assign(new Error(code), { code });
}

export function shouldBypassFirebaseAppCheck(isDevelopment: boolean, emulatorFlag: unknown) {
  return isDevelopment && emulatorFlag === 'true';
}

export function shouldEnableFirebaseAppCheckDebug(isDevelopment: boolean, debugFlag: unknown) {
  return isDevelopment && debugFlag === 'true';
}

let appCheckInitialization: Promise<AppCheck | null> | null = null;

async function initializeFirebaseAppCheck() {
  // Validate the complete fail-closed emulator boundary before bypassing production App Check.
  // This also rejects an ambiguous emulator flag before any App Check network initialization.
  if (getFirebaseEmulatorConfig()) return null;

  const siteKey = String(
    import.meta.env.VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY ?? '',
  ).trim();
  if (!siteKey) throw appCheckError('auth/app-check-configuration-missing');

  const app = getFirebaseApp();
  if (!app) throw appCheckError('auth/app-check-configuration-missing');

  if (import.meta.env.DEV) {
    if (
      shouldEnableFirebaseAppCheckDebug(true, import.meta.env.VITE_ENABLE_FIREBASE_APP_CHECK_DEBUG)
    )
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export function ensureFirebaseAppCheck() {
  appCheckInitialization ??= initializeFirebaseAppCheck().catch((error: unknown) => {
    appCheckInitialization = null;
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'auth/app-check-configuration-missing'
    )
      throw error;
    throw appCheckError('auth/app-check-unavailable');
  });
  return appCheckInitialization;
}
