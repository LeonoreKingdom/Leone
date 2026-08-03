function csrfToken() {
  return document.cookie.split('; ').find((item) => item.startsWith('leone_csrf='))?.split('=')[1] ?? '';
}

export async function api(path, options = {}) {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { 'x-csrf-token': decodeURIComponent(csrfToken()) } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}
