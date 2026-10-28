// Guided tutorial content and on/off state. Saved on this device per organization, so it
// works the same in the cloud and the desktop app. Read only after hydration (useEffect).
export interface TutorialStep {
  key: string;
  part: "start" | "routine";
  title: string;
  body: string;
  to: string;
  cta: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    key: "accounts",
    part: "start",
    title: "Pick your accounts",
    body: "Accounts are the buckets your money sits in or moves through: checking, savings, donations, rent. Turn on the ones you use.",
    to: "/settings/accounts",
    cta: "Choose accounts",
  },
  {
    key: "opening",
    part: "start",
    title: "Add starting balances",
    body: "Enter what each bank account held on the day you start. Everything after builds on this number.",
    to: "/accounts",
    cta: "Add starting balances",
  },
  {
    key: "first_tx",
    part: "start",
    title: "Record your first transaction",
    body: "Every transaction moves money from one account to another. Increases always equal decreases, and the app checks it for you.",
    to: "/transactions/new",
    cta: "New transaction",
  },
  {
    key: "import",
    part: "start",
    title: "Bring in a bank statement",
    body: "Import the file your bank gives you (CSV, OFX or QFX). Each row can be turned into a transaction in one click.",
    to: "/import",
    cta: "Import a bank file",
  },
  {
    key: "check",
    part: "start",
    title: "Check against the statement",
    body: "Tick off each line that appears on your bank statement. When the difference is zero, your books match the bank.",
    to: "/reconcile",
    cta: "Start a statement check",
  },
  {
    key: "weekly",
    part: "routine",
    title: "Each week: record what happened",
    body: "Add new transactions or import the latest bank file. Use templates for things that repeat, like rent or payroll.",
    to: "/templates",
    cta: "Open templates",
  },
  {
    key: "monthly",
    part: "routine",
    title: "Each month: check and close",
    body: "Finish the statement check for every bank account, then close the month so nothing in it can change by accident.",
    to: "/settings/close",
    cta: "Close the month",
  },
  {
    key: "yearly",
    part: "routine",
    title: "Each year: review and share",
    body: "Print the board package for the year, look over budgets against actuals, then close the year.",
    to: "/reports",
    cta: "Open reports",
  },
];

export type StepState = "done" | "skipped";
export interface TutorialState {
  enabled: boolean;
  steps: Record<string, StepState>;
}

const key = (orgId: string) => `openledgerapp:tutorial:${orgId}`;
export const TUTORIAL_EVENT = "openledgerapp:tutorial";

export function readTutorial(orgId: string): TutorialState {
  try {
    const raw = localStorage.getItem(key(orgId));
    if (raw) {
      const v = JSON.parse(raw) as Partial<TutorialState>;
      return { enabled: v.enabled ?? true, steps: v.steps ?? {} };
    }
  } catch {
    // Storage unavailable or corrupt: fall back to the default.
  }
  return { enabled: true, steps: {} };
}

export function writeTutorial(orgId: string, s: TutorialState) {
  localStorage.setItem(key(orgId), JSON.stringify(s));
  window.dispatchEvent(new Event(TUTORIAL_EVENT));
}

/** First step that is neither done nor skipped, or null when the tour is finished. */
export function nextStep(s: TutorialState): TutorialStep | null {
  return TUTORIAL_STEPS.find((t) => !s.steps[t.key]) ?? null;
}
