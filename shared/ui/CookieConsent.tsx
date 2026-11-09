// Cookie banner and settings for every suite app (GDPR + ePrivacy). Render
// once in the root layout:
//   <CookieConsent policyHref={isHosted() ? hubUrl("/cookies") : "/cookies"} />
// - Shown at the bottom until the visitor chooses; one choice covers the suite.
// - "Accept all" and "Reject non-essential" are equally easy; nothing optional
//   is on by default. Required cookies have no switch.
// - Reopen any time with openCookieSettings() (user menu, footer link).
// Renders nothing on the server: the choice lives in a cookie the browser reads,
// so there's no flash or hydration mismatch.
import { useEffect, useId, useRef, useState } from "react";
import {
  CONSENT_EVENT,
  COOKIES,
  OPEN_SETTINGS_EVENT,
  getConsent,
  saveConsent,
  type Consent,
  type ConsentCategory,
} from "../consent";
import { syncThemeWithConsent } from "../theme";
import { CloseIcon, CookieIcon } from "./icons";
import { useFocusTrap } from "./useFocusTrap";

const CATEGORIES: { id: ConsentCategory; title: string; text: string }[] = [
  {
    id: "necessary",
    title: "Required",
    text: "Needed for the apps to work: keeping you signed in, remembering your organization and remembering these choices. They can't be switched off.",
  },
  {
    id: "preferences",
    title: "Preferences",
    text: "Remember choices you make, like the light or dark theme, across visits and across the OpenAppHub apps. Without them, your choice lasts until you close the browser.",
  },
];

const btn =
  "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
// Accept and reject look the same on purpose: neither choice is nudged.
const choiceBtn = `${btn} border border-input bg-card text-foreground shadow-sm hover:bg-accent`;
const primaryBtn = `${btn} bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`;

export function CookieConsent({
  policyHref,
  privacyHref,
}: {
  /** The cookie policy page (hosted: hubUrl("/cookies")). */
  policyHref: string;
  privacyHref?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConsent(getConsent());
    syncThemeWithConsent();
    const onOpen = () => setSettingsOpen(true);
    const onChange = (e: Event) => setConsent((e as CustomEvent<Consent>).detail);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
      window.removeEventListener(CONSENT_EVENT, onChange);
    };
  }, []);

  function choose(preferences: boolean) {
    saveConsent({ preferences });
    syncThemeWithConsent();
    setSettingsOpen(false);
  }

  if (!mounted) return null;
  return (
    <>
      {consent === null && !settingsOpen ? (
        <Banner
          policyHref={policyHref}
          onAccept={() => choose(true)}
          onReject={() => choose(false)}
          onChoose={() => setSettingsOpen(true)}
        />
      ) : null}
      {settingsOpen ? (
        <Settings
          initial={consent}
          policyHref={policyHref}
          {...(privacyHref ? { privacyHref } : {})}
          onSave={choose}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}

function Banner({
  policyHref,
  onAccept,
  onReject,
  onChoose,
}: {
  policyHref: string;
  onAccept: () => void;
  onReject: () => void;
  onChoose: () => void;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg sm:p-5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 gap-3">
          <CookieIcon className="mt-0.5 size-5 text-muted-foreground" />
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">
              Cookies on OpenAppHub
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We use required cookies to keep you signed in and remember your organization. With
              your permission we'll also remember preferences like your theme. No advertising or
              tracking cookies.{" "}
              <a
                href={policyHref}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Cookie policy
              </a>
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            className={`${btn} order-last col-span-2 text-foreground underline-offset-4 hover:underline sm:order-none`}
            onClick={onChoose}
          >
            Choose
          </button>
          <button type="button" className={choiceBtn} onClick={onReject}>
            Reject non-essential
          </button>
          <button type="button" className={choiceBtn} onClick={onAccept}>
            Accept all
          </button>
        </div>
      </div>
    </section>
  );
}

function Settings({
  initial,
  policyHref,
  privacyHref,
  onSave,
  onClose,
}: {
  initial: Consent | null;
  policyHref: string;
  privacyHref?: string;
  onSave: (preferences: boolean) => void;
  onClose: () => void;
}) {
  // Nothing optional is pre-selected: off unless the visitor already said yes.
  const [preferences, setPreferences] = useState(initial?.preferences ?? false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, true, onClose);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-xl border bg-popover text-popover-foreground shadow-lg sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Cookie settings
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose which cookies OpenAppHub may use. Your choice applies to all OpenAppHub apps
              and you can change it at any time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cookie settings"
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mt-4 space-y-3 overflow-y-auto px-5 pb-2">
          {CATEGORIES.map((cat) => {
            const required = cat.id === "necessary";
            const on = required || preferences;
            const names = COOKIES.filter((c) => c.category === cat.id).map((c) => c.name);
            return (
              <div key={cat.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 id={`${titleId}-${cat.id}`} className="text-sm font-semibold">
                    {cat.title}
                  </h3>
                  {required ? (
                    <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                      Always on
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby={`${titleId}-${cat.id}`}
                      onClick={() => setPreferences((p) => !p)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                        on ? "border-primary bg-primary" : "border-input bg-muted"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block size-4 rounded-full shadow-sm transition-transform ${
                          on
                            ? "translate-x-6 bg-primary-foreground"
                            : "translate-x-1 bg-muted-foreground"
                        }`}
                      />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{cat.text}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{names.join(", ")}</p>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">
            Details:{" "}
            <a href={policyHref} className="underline underline-offset-4">
              Cookie policy
            </a>
            {privacyHref ? (
              <>
                {" · "}
                <a href={privacyHref} className="underline underline-offset-4">
                  Privacy policy
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" className={choiceBtn} onClick={() => onSave(false)}>
            Reject non-essential
          </button>
          <button type="button" className={choiceBtn} onClick={() => onSave(true)}>
            Accept all
          </button>
          <button type="button" className={primaryBtn} onClick={() => onSave(preferences)}>
            Save my choices
          </button>
        </div>
      </div>
    </div>
  );
}

/** The cookie list for a cookie policy page (hub /cookies, or a self-hosted app's own page). */
export function CookieTable() {
  return (
    <div className="space-y-8">
      {CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold">
            {cat.title} cookies{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {cat.id === "necessary" ? "(always on)" : "(only with your permission)"}
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{cat.text}</p>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Cookie
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    What it's for
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Kept for
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {COOKIES.filter((c) => c.category === cat.id).map((c) => (
                  <tr key={c.name} className="align-top">
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-2.5">{c.purpose}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{c.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
