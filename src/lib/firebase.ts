import { initializeApp, type FirebaseApp } from "firebase/app";
import { indexedDBLocalPersistence, initializeAuth, type Auth } from "firebase/auth";

/**
 * Firebase web configuration, supplied at build time through `.env.local`
 * (see `.env.example`). These values identify the project; they are not
 * secrets. Access control is enforced by Firestore security rules.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error("Firebase is not configured. Add your project settings to .env.local.");
  return (app ??= initializeApp(config));
}

/** Auth with IndexedDB persistence so a signed-in user can open StudyOS offline. */
export function getFirebaseAuth(): Auth {
  return (auth ??= initializeAuth(getApp(), { persistence: indexedDBLocalPersistence }));
}

