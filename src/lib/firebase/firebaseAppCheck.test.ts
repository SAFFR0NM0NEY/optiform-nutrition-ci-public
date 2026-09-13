import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { name: '[DEFAULT]' },
  getFirebaseApp: vi.fn(),
  initializeAppCheck: vi.fn(),
  providerSiteKeys: [] as string[],
}));

vi.mock('./firebaseClient', () => ({ getFirebaseApp: mocks.getFirebaseApp }));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class {
    constructor(siteKey: string) {
      mocks.providerSiteKeys.push(siteKey);
    }
  },
}));

async function appCheckModule() {
  return import('./firebaseAppCheck');
}

describe('Firebase Web App Check client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY', ' synthetic-site-key ');
    vi.stubEnv('VITE_ENABLE_FIREBASE_APP_CHECK_DEBUG', 'false');
    mocks.getFirebaseApp.mockReturnValue(mocks.app);
    mocks.initializeAppCheck.mockReturnValue({ app: mocks.app });
    delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  it('initializes exactly once with the configured Enterprise key and auto refresh', async () => {
    const { ensureFirebaseAppCheck } = await appCheckModule();
    await expect(ensureFirebaseAppCheck()).resolves.toEqual({ app: mocks.app });
    await expect(ensureFirebaseAppCheck()).resolves.toEqual({ app: mocks.app });
    expect(mocks.providerSiteKeys).toEqual(['synthetic-site-key']);
    expect(mocks.initializeAppCheck).toHaveBeenCalledOnce();
    expect(mocks.initializeAppCheck).toHaveBeenCalledWith(mocks.app, {
      provider: expect.anything(),
      isTokenAutoRefreshEnabled: true,
    });
  });

  it('fails closed when the public site key or Firebase app is missing', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY', '');
    let module = await appCheckModule();
    await expect(module.ensureFirebaseAppCheck()).rejects.toMatchObject({
      code: 'auth/app-check-configuration-missing',
    });
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY', 'synthetic-site-key');
    mocks.getFirebaseApp.mockReturnValue(null);
    module = await appCheckModule();
    await expect(module.ensureFirebaseAppCheck()).rejects.toMatchObject({
      code: 'auth/app-check-configuration-missing',
    });
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('skips App Check initialization cleanly on the normal DEV emulator path', async () => {
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY', '');
    const { ensureFirebaseAppCheck, shouldBypassFirebaseAppCheck } = await appCheckModule();
    await expect(ensureFirebaseAppCheck()).resolves.toBeNull();
    expect(mocks.getFirebaseApp).not.toHaveBeenCalled();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    expect(shouldBypassFirebaseAppCheck(true, 'true')).toBe(true);
    expect(shouldBypassFirebaseAppCheck(false, 'true')).toBe(false);
    expect(shouldBypassFirebaseAppCheck(true, 'false')).toBe(false);
  });

  it('permits debug mode only in DEV with the explicit true flag', async () => {
    const { shouldEnableFirebaseAppCheckDebug } = await appCheckModule();
    expect(shouldEnableFirebaseAppCheckDebug(true, 'true')).toBe(true);
    expect(shouldEnableFirebaseAppCheckDebug(true, 'false')).toBe(false);
    expect(shouldEnableFirebaseAppCheckDebug(false, 'true')).toBe(false);
    expect(shouldEnableFirebaseAppCheckDebug(false, undefined)).toBe(false);
  });

  it('enables official debug discovery without persisting a token string in Optiform code', async () => {
    vi.stubEnv('VITE_ENABLE_FIREBASE_APP_CHECK_DEBUG', 'true');
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const { ensureFirebaseAppCheck } = await appCheckModule();
    await ensureFirebaseAppCheck();
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    expect(typeof self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('boolean');
    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });
});
