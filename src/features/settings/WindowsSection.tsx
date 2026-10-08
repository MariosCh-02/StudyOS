import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SelectField } from "@/components/ui/Field";
import { qk } from "@/hooks/queries";
import { isTauri } from "@/lib/native";
import { setSetting, type SettingsMap } from "@/services/settings";
import { setFocusShortcut } from "./DesktopIntegration";
import { Section } from "./Section";

export function WindowsSection({ settings }: { settings: SettingsMap }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  if (!isTauri()) return null;

  const change = async (key: "closeToTray" | "focusShortcut", value: "on" | "off") => {
    setError(null);
    try {
      // Register first so a shortcut taken by another program isn't saved as "on".
      if (key === "focusShortcut") await setFocusShortcut(value === "on");
      await setSetting(key, value);
      await client.invalidateQueries({ queryKey: qk.settings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Section title="Windows" description="How StudyOS behaves on your desktop.">
      <div className="grid max-w-xl grid-cols-2 gap-3">
        <SelectField
          label="When I close the window"
          value={settings.closeToTray}
          onChange={(e) => void change("closeToTray", e.target.value as "on" | "off")}
          options={[
            { value: "on", label: "Keep running in the tray" },
            { value: "off", label: "Quit StudyOS" },
          ]}
          hint="In the tray, reminders and the study timer keep working. Quit from the tray icon's menu."
        />
        <SelectField
          label="Ctrl+Shift+S opens StudyOS"
          value={settings.focusShortcut}
          onChange={(e) => void change("focusShortcut", e.target.value as "on" | "off")}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On, from any program" },
          ]}
          hint="While on, other programs can't use Ctrl+Shift+S (often “Save As”)."
        />
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Section>
  );
}
