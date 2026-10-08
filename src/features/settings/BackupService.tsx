import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@/lib/native";
import { runAutoBackup } from "@/services/backupFiles";

const FIRST_CHECK_MS = 60_000; // after start-up work (and the first sync) has settled
const CHECK_MS = 60 * 60_000;

/** Makes the daily automatic backup while StudyOS is running. Renders nothing. */
export function BackupService() {
  const client = useQueryClient();
  useEffect(() => {
    if (!isTauri()) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        if (await runAutoBackup()) await client.invalidateQueries({ queryKey: ["backups"] });
      } catch (err) {
        // A failed automatic backup must never interrupt studying; it is retried next hour.
        console.warn("Automatic backup failed:", err);
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(() => void check(), FIRST_CHECK_MS);
    const timer = setInterval(() => void check(), CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [client]);
  return null;
}
