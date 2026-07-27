import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

const TOKEN_KEY = '@exam_token';
const USER_KEY = '@exam_user';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeMany([TOKEN_KEY, USER_KEY]);
}

export async function saveUser(user: unknown): Promise<void> {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function loadUser<T>(): Promise<T | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

/** Session-expiry hook wired up by AuthContext so a 401 logs the user out. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function request<T>(
  path: string,
  { method = 'GET', body, auth = true, timeoutMs = 20000 }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Request timed out. Check your connection.', 0);
    }
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  clearTimeout(timer);

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth && onUnauthorized) onUnauthorized();
    throw new ApiError(data?.message || `Request failed (${res.status})`, res.status);
  }

  return data as T;
}

/**
 * A file ready for multipart upload.
 *
 * - On web this is a real browser `File` (from a file input).
 * - On React Native it is the `{ uri, name, type }` descriptor returned by
 *   the document picker.
 *
 * The two are NOT interchangeable — `uploadFile` branches on platform and
 * rejects the wrong shape instead of silently uploading nothing.
 */
export type UploadableFile = File | { uri: string; name: string; type: string };

/**
 * True in the browser (web build). Deliberately NOT `Platform.OS === 'web'`:
 * this module is imported directly under Node by scripts/smoke-test.mjs,
 * where importing react-native would crash the whole API layer.
 */
const isWeb = typeof document !== 'undefined';

function isBrowserFile(file: UploadableFile): file is File {
  return typeof Blob !== 'undefined' && file instanceof Blob;
}

/** Multipart upload used by the bulk question importer. */
export async function uploadFile<T>(
  path: string,
  file: UploadableFile,
  field = 'file'
): Promise<T> {
  const token = await getToken();
  const form = new FormData();

  if (isWeb) {
    // Browsers need a real Blob/File part. Appending the RN-style
    // { uri, name, type } object here would serialize it as "[object
    // Object]" and the server would receive an empty, silent upload.
    if (!isBrowserFile(file)) {
      throw new ApiError('Web uploads require a browser File.', 0);
    }
    form.append(field, file, file.name);
  } else {
    // React Native's FormData expects the { uri, name, type } descriptor for
    // file parts; a browser File has no readable local uri on native.
    if (isBrowserFile(file)) {
      throw new ApiError('Native uploads require a { uri, name, type } file.', 0);
    }
    form.append(field, {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.message || `Upload failed (${res.status})`, res.status);
  }
  return data as T;
}
