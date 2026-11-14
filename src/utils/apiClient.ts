let currentCsrfToken = '';
let onSessionExpiredCallback: (() => void) | null = null;

export function setCsrfToken(token: string) {
  currentCsrfToken = token || '';
}

export function getCsrfToken(): string {
  return currentCsrfToken;
}

export function registerSessionExpiredHandler(cb: () => void) {
  onSessionExpiredCallback = cb;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    currentCsrfToken &&
    !headers.has('X-CSRF-Token')
  ) {
    headers.set('X-CSRF-Token', currentCsrfToken);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && onSessionExpiredCallback) {
    const urlStr = typeof input === 'string' ? input : input.toString();
    // Do not trigger session-expired redirect for login/mfa endpoints themselves
    if (
      !urlStr.includes('/api/auth/login') &&
      !urlStr.includes('/api/auth/mfa/verify') &&
      !urlStr.includes('/api/auth/mfa/setup/verify') &&
      !urlStr.includes('/api/auth/me')
    ) {
      onSessionExpiredCallback();
    }
  }

  return response;
}
