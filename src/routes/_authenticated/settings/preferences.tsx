import { OrgPending } from "@/components/AppShell";
import { showError } from "@/lib/show-error";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useOrgContext } from "@/hooks/use-org-context";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TutorialToggle } from "@/components/Tutorial";
import { TermSliders } from "@/components/TermSliders";
import { setMyTermOverrides } from "@/lib/org.functions";
import type { TermOverrides } from "@/lib/terminology";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
  head: () => ({
    meta: [
      { title: "Your Preferences - OpenLedgerApp" },
      {
        name: "description",
        content: "Personal display preferences that only affect what you see.",
      },
      { property: "og:title", content: "Your Preferences - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Personal display preferences that only affect what you see.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PreferencesSettings,
});

function PreferencesSettings() {
  const { org, userOverrides } = useOrgContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TermOverrides | null>(null);
  const [saving, setSaving] = useState(false);
  if (!org) return <OrgPending inShell={false} />;
  const orgLevel = org.terminology ?? "simplest";
  const orgOverrides: TermOverrides = org.termOverrides ?? {};

  async function save() {
    setSaving(true);
    try {
      await setMyTermOverrides({ data: { termOverrides: draft ?? {} } });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      setDraft(null);
      toast.success("Your wording saved");
    } catch (e) {
      showError(e, "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <TutorialToggle orgId={org.id} />
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Your preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose what each term is called on your screens. This only affects what you see. Reports
          and PDF exports always use the{" "}
          <Link to="/settings" className="text-primary underline underline-offset-2">
            organization's wording
          </Link>
          .
        </p>
        <div className="mt-4">
          <TermSliders
            orgType={org.orgType}
            base={(k) => orgOverrides[k as keyof TermOverrides] ?? orgLevel}
            value={draft ?? userOverrides}
            onChange={setDraft}
            resetLabel="Use organization default"
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={save} disabled={draft === null || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={() => setDraft({})}>
            Reset all to organization defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
