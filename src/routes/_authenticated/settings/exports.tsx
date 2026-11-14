import { OrgPending } from "@/components/AppShell";
import { showError } from "@/lib/show-error";
import { errorMessage } from "@/lib/errors";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  checkBackupFile,
  exportBackup,
  exportTransactions,
  getInstallFingerprint,
  restoreBackup,
} from "@/lib/backup.functions";
import { setStoredOrgId } from "@/lib/current-org";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/exports")({
  head: () => ({
    meta: [
      { title: "Exports and backup - OpenLedgerApp" },
      { name: "description", content: "Download your books as spreadsheets or a full backup." },
      { property: "og:title", content: "Exports and backup - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Download your books as spreadsheets or a full backup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExportsPage,
});

const btn =
  "rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50";

function ExportsPage() {
  const { org } = useOrgContext();
  const [busy, setBusy] = useState<string | null>(null);
  if (!org) return <OrgPending inShell={false} />;
  const isAdmin = org.role === "admin";

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showError(e, "Export failed", "No file was created.");
    } finally {
      setBusy(null);
    }
  }

  async function transactions(kind: "csv" | "xlsx") {
    const ex = await import("@/lib/export");
    const rows = await exportTransactions({ data: { orgId: org!.id } });
    const sheet = {
      name: "Transactions",
      rows: [
        [
          "Date",
          "Description",
          "Status",
          "Source",
          "Account",
          "Account type",
          "Debit",
          "Credit",
          "Category",
          "Project",
          "Fund",
          "Memo",
        ],
        ...rows.map((r) => [
          r.date,
          r.description,
          r.status,
          r.source,
          r.account,
          r.accountType,
          ex.centsToNumber(r.debitCents),
          ex.centsToNumber(r.creditCents),
          r.category,
          r.project,
          r.fund,
          r.memo,
        ]),
      ],
    };
    const base = ex.safeFileName(`${org!.name}-transactions`);
    if (kind === "csv") ex.downloadCsv(sheet, `${base}.csv`);
    else await ex.downloadXlsx([sheet], `${base}.xlsx`, org!.currency);
  }

  async function backup() {
    const ex = await import("@/lib/export");
    const data = await exportBackup({ data: { orgId: org!.id } });
    ex.downloadJson(
      data,
      `${ex.safeFileName(org!.name)}-backup-${data.manifest.exportedAt.slice(0, 10)}.json`,
    );
    toast.success("Backup downloaded");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Transactions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every transaction line, including voided ones, with debit and credit columns. Text that
          looks like a spreadsheet formula is made safe.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            className={btn}
            disabled={!!busy}
            onClick={() => run("csv", () => transactions("csv"))}
          >
            {busy === "csv" ? "Preparing…" : "Download CSV"}
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() => run("xlsx", () => transactions("xlsx"))}
          >
            {busy === "xlsx" ? "Preparing…" : "Download Excel"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Reports can be exported as CSV, Excel or PDF from the Reports page. Spreadsheets are for
          reading only and can't be restored; use a full backup for that.
        </p>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Full backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One file with everything in this organization: accounts, transactions, bank imports,
          statement checks, funds, pledges, budgets, members and history. Keep it somewhere safe.
          The file is signed by this server, so any change to it is detected.
        </p>
        <div className="mt-4">
          <button
            className={btn}
            disabled={!!busy || !isAdmin}
            onClick={() => run("backup", backup)}
          >
            {busy === "backup" ? "Preparing…" : "Download backup"}
          </button>
          {!isAdmin && (
            <p className="mt-2 text-xs text-muted-foreground">Only admins can download a backup.</p>
          )}
        </div>
      </section>

      <RestoreSection />
    </div>
  );
}

type Check = Awaited<ReturnType<typeof checkBackupFile>>;

function RestoreSection() {
  const { org } = useOrgContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const qc = useQueryClient();
  const fp = useQuery({
    queryKey: ["install-fingerprint"],
    queryFn: () => getInstallFingerprint(),
  });
  const [text, setText] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setCheck(null);
    setError(null);
    setConfirm("");
    setText(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return setError("The backup file is larger than 25 MB.");
    setBusy(true);
    try {
      const t = await file.text();
      setCheck(await checkBackupFile({ data: { text: t } }));
      setText(t);
    } catch (e) {
      setError(errorMessage(e, "This backup can't be restored."));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!text || !check || !org) return;
    setBusy(true);
    try {
      const r = await restoreBackup({ data: { orgId: org.id, text, confirmName: confirm } });
      toast.success(`Restored into "${r.name}"`);
      await qc.invalidateQueries();
      setStoredOrgId(r.orgId);
      setCheck(null);
      setText(null);
    } catch (e) {
      showError(e, "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">Restore a backup</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A backup is restored into {org?.name ?? "this organization"}, while its books are still
        empty (no accounts or transactions). Books that already have entries are never changed. To
        restore next to books you already keep, make a new organization first and restore there.
        Files that were edited after they were downloaded are refused, and every transaction is
        checked again. It all happens in one step: if anything goes wrong, nothing is saved. Other
        members are not copied; invite them again.
      </p>
      {fp.data?.fingerprint && (
        <p className="mt-2 text-xs text-muted-foreground">
          This install's fingerprint: <span className="font-mono">{fp.data.fingerprint}</span>
        </p>
      )}
      <p className="mt-4 text-sm font-medium">Backup file</p>
      <input
        ref={fileInput}
        id="backup-file"
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label="Backup file"
        className="sr-only"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
          <FileUp aria-hidden="true" />
          {fileName ? "Choose another backup" : "Choose backup file"}
        </Button>
        <span className="min-w-0 break-all text-sm" aria-live="polite">
          {fileName ?? "No file selected"}
        </span>
      </div>
      {busy && !check && <p className="mt-3 text-sm text-muted-foreground">Checking…</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {check && (
        <div className="mt-4 space-y-3 rounded-md border p-4 text-sm">
          <p>
            <span className="font-semibold">{check.orgName}</span>, created{" "}
            {new Date(check.exportedAt).toLocaleString()}
          </p>
          {check.sameInstall ? (
            <p>Signed by this install. The file is unchanged.</p>
          ) : (
            <p className="font-medium">
              Signed by another install (fingerprint{" "}
              <span className="font-mono">{check.installFingerprint}</span>). The file is unchanged
              since that install signed it. Make sure the fingerprint matches the install you
              expect. The restored organization will be labeled as coming from another install.
            </p>
          )}
          <p className="text-muted-foreground">
            {check.counts["accounts"] ?? 0} accounts, {check.counts["transactions"] ?? 0}{" "}
            transactions, {check.counts["bank_transactions"] ?? 0} bank rows,{" "}
            {check.counts["audit_log"] ?? 0} history entries.
          </p>
          <label className="block font-medium" htmlFor="confirm-name">
            Organization name to confirm
          </label>
          <p
            id="restore-confirm-name"
            className="w-fit max-w-full break-words rounded-md border border-primary bg-accent px-4 py-3 font-mono text-lg font-semibold text-accent-foreground select-all"
          >
            {check.orgName}
          </p>
          <input
            id="confirm-name"
            aria-describedby="restore-confirm-name"
            autoComplete="off"
            placeholder="Enter the organization name"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2"
          />
          <div>
            <Button
              className="h-auto min-h-9 whitespace-normal text-left"
              disabled={busy || confirm.trim() !== check.orgName.trim()}
              onClick={restore}
            >
              {busy ? "Restoring…" : `Restore into ${org?.name ?? "this organization"}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
