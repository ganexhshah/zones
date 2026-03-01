import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let initialized = false;

function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

export function getFirebaseMessaging() {
  const config = getFirebaseConfig();
  if (!config) return null;

  if (!initialized && getApps().length === 0) {
    initializeApp({
      credential: cert(config),
      projectId: config.projectId,
    });
    initialized = true;
  }

  return getMessaging();
}
