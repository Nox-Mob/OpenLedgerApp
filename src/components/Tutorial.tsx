import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { GraduationCap, X } from "lucide-react";
import { useTutorial } from "@/hooks/use-tutorial";
import { nextStep, TUTORIAL_STEPS } from "@/lib/tutorial";

/** Small guided-tour card shown on every page while the tutorial is on. */
export function TutorialPanel({ orgId }: { orgId: string }) {
  const { state, mark, setEnabled } = useTutorial(orgId);
  const [open, setOpen] = useState(true);
  if (!state?.enabled) return null;
  const step = nextStep(state);
  const doneCount = TUTORIAL_STEPS.filter((s) => state.steps[s.key]).length;

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg hover:bg-accent"
      >
        <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" /> Tutorial
      </button>
    );

  return (
    <aside
      aria-label="Tutorial"
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" />
          {step?.part === "routine" ? "Your routine" : "Getting started"}
          <span className="text-xs font-normal text-muted-foreground">
            {doneCount} of {TUTORIAL_STEPS.length}
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Minimize tutorial"
          className="rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {step ? (
        <>
          <h2 className="mt-3 font-display text-base font-semibold">{step.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to={step.to}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {step.cta}
            </Link>
            <button
              onClick={() => mark(step.key, "done")}
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
            >
              Done
            </button>
            <button
              onClick={() => mark(step.key, "skipped")}
              className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm">You've finished the tutorial. Nice work.</p>
          <button
            onClick={() => setEnabled(false)}
            className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            Turn off the tutorial
          </button>
        </>
      )}
    </aside>
  );
}

/** On/off switch plus restart, used in Settings, Your preferences. */
export function TutorialToggle({ orgId }: { orgId: string }) {
  const { state, setEnabled, restart } = useTutorial(orgId);
  if (!state) return null;
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">Tutorial</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A short guided tour: getting started (accounts, starting balances, first transaction,
        bank file, statement check) and the routine after that (weekly, monthly, yearly).
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Show the tutorial
        </label>
        <button
          onClick={restart}
          className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
