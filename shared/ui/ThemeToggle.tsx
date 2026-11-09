// Light / Dark / System switch. Goes in the user menu (AppShell) and, until that
// exists, the page header. Renders the same on the server and client; the
// selected option is filled in after hydration.
import { useEffect, useState } from "react";
import {
  getThemePreference,
  setThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from "../theme";

const OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  {
    value: "light",
    label: "Light",
    icon: "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  },
  { value: "dark", label: "Dark", icon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" },
  { value: "system", label: "System", icon: "M4 5h16v11H4zM8 20h8M12 16v4" },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPref(getThemePreference());
    return watchSystemTheme();
  }, []);

  function choose(value: ThemePreference) {
    setThemePreference(value);
    setPref(value);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 ${className}`}
    >
      {OPTIONS.map((o) => {
        const selected = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.value === "system" ? "System (follow this device)" : o.label}
            onClick={() => choose(o.value)}
            className={`inline-flex size-7 items-center justify-center rounded-sm transition-colors ${
              selected
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4"
            >
              <path d={o.icon} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
