import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorState, Spinner } from "@/components/ui/Feedback";
import { getRawDb } from "@/lib/db";
import { flushAll } from "@/lib/flush";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { discardAndSwitchOwner, prepareLocalForUser } from "@/sync/engine";
import { onRemoteChanges, startSync, stopSync, syncNow } from "@/sync/syncService";
import { getProfile, updateProfile } from "@/services/settings";
import { AuthScreen, AuthShell } from "./AuthScreen";
import { VerifyEmailScreen } from "./VerifyEmailScreen";

interface AuthContextValue {
  user: User;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthGate>.");
  return ctx;
}

type LocalState =
  | { kind: "preparing" }
  | { kind: "conflict"; pendingChanges: number }
  | { kind: "ready" }
  | { kind: "error"; error: unknown };

const SIGN_OUT_SYNC_TIMEOUT_MS = 8_000;

function SetupRequired() {
  return (
    <AuthShell>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Settings2 className="size-4" aria-hidden /> Firebase is not configured
        </div>
        <p className="text-muted">
          Copy <code className="rounded bg-surface-2 px-1">.env.example</code> to <code className="rounded bg-surface-2 px-1">.env.local</code>,
          fill in your Firebase project's web app settings, then restart StudyOS. See the README for step-by-step setup.
        </p>
      </div>
    </AuthShell>
  );
}

function ConflictScreen({ pendingChanges, onDiscard, onSignOut }: { pendingChanges: number; onDiscard: () => void; onSignOut: () => void }) {
  return (
    <AuthShell>
      <h2 className="mb-2 text-base font-semibold">Another account has unsynced changes</h2>
      <p className="text-sm leading-relaxed text-muted">
        This computer holds {pendingChanges} change{pendingChanges === 1 ? "" : "s"} from a different StudyOS account that haven't been uploaded
        yet. Sign out and sign in with that account while online to keep them, or discard them to continue.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" onClick={onSignOut}>
          Sign out
        </Button>
        <Button variant="danger" onClick={onDiscard}>
          Discard their changes and continue
        </Button>
      </div>
    </AuthShell>
  );
}

/** Renders children only for a signed-in user whose local data is ready; drives sync for that user. */
export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [local, setLocal] = useState<LocalState>({ kind: "preparing" });
  const [attempt, setAttempt] = useState(0);
  // The cloud only accepts verified accounts; reloading the user doesn't fire onAuthStateChanged.
  const [verifiedNow, setVerifiedNow] = useState(false);
  const verified = !!user && (user.emailVerified || verifiedNow);
  useEffect(() => {
    setVerifiedNow(false);
  }, [user?.uid]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return onAuthStateChanged(getFirebaseAuth(), setUser);
  }, []);

  const activate = useCallback(
    async (u: User) => {
      const { createFirestoreRemote } = await import("@/sync/firestoreRemote");
      // Seed the local profile name from the account on first use.
      const profile = await getProfile();
      if (!profile.displayName && u.displayName) await updateProfile({ displayName: u.displayName });
      client.clear();
      startSync(createFirestoreRemote(u.uid));
      setLocal({ kind: "ready" });
    },
    [client],
  );

  useEffect(() => {
    if (!user || !verified) {
      stopSync();
      return;
    }
    let cancelled = false;
    setLocal({ kind: "preparing" });
    void (async () => {
      try {
        const res = await prepareLocalForUser(await getRawDb(), user.uid);
        if (cancelled) return;
        if (res.status === "conflict") setLocal({ kind: "conflict", pendingChanges: res.pendingChanges });
        else await activate(user);
      } catch (error) {
        if (!cancelled) setLocal({ kind: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, verified, activate, attempt]);

  // Refresh every screen when the cloud delivers changes from another device.
  useEffect(() => onRemoteChanges(() => void client.invalidateQueries()), [client]);

  const signOut = useCallback(async () => {
    // Save open notes, then upload outstanding edits, but never block sign-out on a slow network.
    await flushAll();
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, SIGN_OUT_SYNC_TIMEOUT_MS))]);
    stopSync();
    client.clear();
    await firebaseSignOut(getFirebaseAuth());
  }, [client]);

  if (!isFirebaseConfigured) return <SetupRequired />;
  if (user === undefined) return <Spinner label="Starting StudyOS…" />;
  if (user === null) return <AuthScreen />;
  if (!verified) return <VerifyEmailScreen user={user} onVerified={() => setVerifiedNow(true)} onSignOut={() => void firebaseSignOut(getFirebaseAuth())} />;
  if (local.kind === "preparing") return <Spinner label="Loading your data…" />;
  if (local.kind === "error") return <ErrorState error={local.error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (local.kind === "conflict")
    return (
      <ConflictScreen
        pendingChanges={local.pendingChanges}
        onSignOut={() => void firebaseSignOut(getFirebaseAuth())}
        onDiscard={() =>
          void (async () => {
            await discardAndSwitchOwner(await getRawDb(), user.uid);
            await activate(user);
          })()
        }
      />
    );

  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>;
}
