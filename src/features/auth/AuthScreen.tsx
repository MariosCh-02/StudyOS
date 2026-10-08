import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { getFirebaseAuth } from "@/lib/firebase";
import { authErrorMessage } from "./authErrors";

type Mode = "signIn" | "signUp" | "reset";

const MIN_PASSWORD = 8;

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <GraduationCap className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">StudyOS</h1>
            <p className="text-sm text-muted">Your Personal Academic Operating System</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6">{children}</div>
      </div>
    </div>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) return setError("Enter your email address.");
    if (mode !== "reset" && !password) return setError("Enter your password.");
    if (mode === "signUp" && password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);

    setBusy(true);
    const auth = getFirebaseAuth();
    try {
      if (mode === "signIn") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else if (mode === "signUp") {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
        // Verification is informative only; failure must not block sign-up.
        await sendEmailVerification(cred.user).catch(() => undefined);
      } else {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice("If an account exists for this email, a reset link is on its way.");
        setMode("signIn");
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create your account" : "Reset your password";

  return (
    <AuthShell>
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5" noValidate>
        {mode === "signUp" && <TextField label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        <TextField label="Email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "reset" && (
          <TextField
            label="Password"
            type="password"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={mode === "signUp" ? `At least ${MIN_PASSWORD} characters` : undefined}
          />
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">{notice}</p>}
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
          {mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create account" : "Send reset link"}
        </Button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2 text-[13px] text-muted">
        {mode === "signIn" && (
          <>
            <button type="button" className="hover:text-fg" onClick={() => switchMode("reset")}>
              Forgot your password?
            </button>
            <p>
              New to StudyOS?{" "}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("signUp")}>
                Create an account
              </button>
            </p>
          </>
        )}
        {mode !== "signIn" && (
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("signIn")}>
            Back to sign in
          </button>
        )}
      </div>
    </AuthShell>
  );
}
