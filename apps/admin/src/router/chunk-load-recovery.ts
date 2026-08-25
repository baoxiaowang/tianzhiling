import type { RouteLocationNormalized, Router } from 'vue-router';

const CHUNK_LOAD_RELOAD_KEY = 'tzl-admin:chunk-load-reload-target';

const CHUNK_LOAD_ERROR_PATTERNS = [
  'chunkloaderror',
  'loading chunk',
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
];

export const isChunkLoadError = (error: unknown) => {
  const details =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error ?? '');

  const normalizedDetails = details.toLowerCase();
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) =>
    normalizedDetails.includes(pattern)
  );
};

const getRecoveryTarget = (to?: RouteLocationNormalized) => {
  if (to?.fullPath?.startsWith('/')) {
    return to.fullPath;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

const readReloadTarget = () => {
  try {
    return window.sessionStorage.getItem(CHUNK_LOAD_RELOAD_KEY);
  } catch (_error) {
    return null;
  }
};

const writeReloadTarget = (target: string) => {
  try {
    window.sessionStorage.setItem(CHUNK_LOAD_RELOAD_KEY, target);
  } catch (_error) {
    // Reload recovery still works when session storage is unavailable.
  }
};

const clearReloadTarget = () => {
  try {
    window.sessionStorage.removeItem(CHUNK_LOAD_RELOAD_KEY);
  } catch (_error) {
    // There is nothing else to clean up when session storage is unavailable.
  }
};

export const installChunkLoadRecovery = (router: Router) => {
  router.onError((error, to) => {
    if (!isChunkLoadError(error)) {
      return;
    }

    const target = getRecoveryTarget(to);
    if (readReloadTarget() === target) {
      clearReloadTarget();
      return;
    }

    writeReloadTarget(target);
    window.location.replace(target);
  });

  router.afterEach(() => {
    clearReloadTarget();
  });
};
