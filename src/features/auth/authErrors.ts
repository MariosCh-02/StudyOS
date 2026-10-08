/** Maps Firebase Auth error codes to plain-language messages. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-email": "Enter your email address.",
  "auth/missing-password": "Enter your password.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "Email or password is incorrect.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Choose a stronger password (at least 8 characters).",
  "auth/password-does-not-meet-requirements": "Password doesn't meet the project's password policy.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "No internet connection. Signing in for the first time requires internet.",
  "auth/operation-not-allowed": "Email/password sign-in isn't enabled in the Firebase project.",
  "auth/configuration-not-found": "Firebase Authentication isn't set up for this project yet.",
};

export function authErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
  return MESSAGES[code] ?? (err instanceof Error ? err.message : "Something went wrong. Please try again.");
}
