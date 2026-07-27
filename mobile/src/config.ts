import Constants from 'expo-constants';

/**
 * Base URL of the Exam Platform API.
 *
 * Override without touching code by setting EXPO_PUBLIC_API_URL, e.g.
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:5000 npx expo start
 *
 * Note for physical devices: "localhost" points at the phone itself, so use
 * your computer's LAN IP when running the backend locally.
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL;

const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

/**
 * The live Exam Platform API, used when nothing else is configured. This is
 * the same backend the existing web app talks to, so the built app works out
 * of the box with no setup.
 *
 * Note: the endpoint helpers already prefix paths with `/api`, so this is the
 * host only — do not include a trailing `/api`.
 */
const DEFAULT_API_URL = 'https://exam-backend-1-gbh3.onrender.com';

export const API_BASE_URL = (fromEnv || fromExtra || DEFAULT_API_URL).replace(/\/+$/, '');

export const APP_NAME = 'MAC Multimedia Exams';
