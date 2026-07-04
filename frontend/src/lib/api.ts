const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error('Missing VITE_API_BASE_URL environment variable.');
}

interface ApiFetchOptions extends RequestInit {
  /** JWT to send as `Authorization: Bearer <token>`. Omit for unauthenticated calls. */
  accessToken?: string;
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { accessToken, headers, ...rest } = options;

  return fetch(`${apiBaseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
}
