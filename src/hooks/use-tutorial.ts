import { useCallback, useEffect, useState } from "react";
import {
  readTutorial,
  writeTutorial,
  TUTORIAL_EVENT,
  type StepState,
  type TutorialState,
} from "@/lib/tutorial";

/** Tutorial state for an organization. Null until hydrated (avoids SSR mismatch). */
export function useTutorial(orgId: string | undefined) {
  const [state, setState] = useState<TutorialState | null>(null);
  useEffect(() => {
    if (!orgId) return;
    const load = () => setState(readTutorial(orgId));
    load();
    window.addEventListener(TUTORIAL_EVENT, load);
    return () => window.removeEventListener(TUTORIAL_EVENT, load);
  }, [orgId]);
  const update = useCallback(
    (fn: (s: TutorialState) => TutorialState) => {
      if (!orgId) return;
      writeTutorial(orgId, fn(readTutorial(orgId)));
    },
    [orgId],
  );
  return {
    state,
    setEnabled: (enabled: boolean) => update((s) => ({ ...s, enabled })),
    mark: (stepKey: string, v: StepState) =>
      update((s) => ({ ...s, steps: { ...s.steps, [stepKey]: v } })),
    restart: () => update(() => ({ enabled: true, steps: {} })),
  };
}
