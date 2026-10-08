import { useEffect, useState } from "react";
import { sendEmailVerification, type User } from "firebase/auth";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AuthShell } from "./AuthScreen";

const RESEND_COOLDOWN_S = 60;
const POLL_MS = 5000;

/**
 * Shown after sign-in until the account's email is verified (the cloud rules
 * only accept verified accounts). Checks automatically every few seconds.
 */
export function VerifyEmailScreen({ user, onVerified, onSignOut }: { user: User; onVerified: () => void; onSignOut: () => void }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  /** Reloads the account; refreshes the sign-in token so the cloud sees the verified status. */
  const check = async (manual: boolean) => {
    if (manual) setChecking(true);
    try {
      await user.reload();
      if (user.emailVerified) {
        await user.getIdToken(true);
        onVerified();
      } else if (manual) {
        setMessage({ text: "Not verified yet. Click the link in the email, then try again.", error: true });
      }
    } catch (err) {
      if (manual) setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      if (manual) setChecking(false);
    }
  };

  useEffect(() => {
    const t = setInterval(() => void check(false), POLL_MS);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    setMessage(null);
    try {
      await sendEmailVerification(user);
      setCooldown(RESEND_COOLDOWN_S);
      setMessage({ text: `Sent. Check ${user.email ?? "your inbox"}, including the spam folder.`, error: false });
    } catch (err) {
      const text = err instanceof Error && /too-many-requests/.test(err.message) ? "Too many emails sent. Wait a few minutes and try again." : err instanceof Error ? err.message : String(err);
      setMessage({ text, error: true });
    }
  };

  return (
    <AuthShell>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2 text-base font-semibold">
          <MailCheck className="size-5 text-accent" aria-hidden /> Verify your email
        </div>
        <p className="leading-relaxed text-muted">
          We sent a verification link to <strong className="text-fg">{user.email}</strong>. Open it to activate your account; StudyOS continues automatically once
          you have.
        </p>
        {message && <p className={message.error ? "rounded-md bg-danger-soft px-3 py-2 text-danger" : "rounded-md bg-success-soft px-3 py-2 text-success"}>{message.text}</p>}
        <div className="mt-2 flex flex-col gap-2">
          <Button variant="primary" loading={checking} onClick={() => void check(true)}>
            I've verified my email
          </Button>
          <Button disabled={cooldown > 0} onClick={() => void resend()}>
            {cooldown > 0 ? `Resend email (${cooldown} s)` : "Resend email"}
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            Use a different account
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
