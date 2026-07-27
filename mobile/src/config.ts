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

export const API_BASE_URL = (fromEnv || fromExtra || 'http://localhost:5000').replace(/\/$/, '');

export const APP_NAME = 'MAC Multimedia Exams';
