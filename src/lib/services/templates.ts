// Templates and recurring drafts. Nothing posts on its own: a person posts or skips
// each due date. Posting uses the key recurring:<template>:<date>, so a double click
// or two people at once still make one transaction.
import type { Id, IsoDate } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { newId } from "@/lib/domain/ledger";
import {
  dueDates,
  nextDate,
  occurrenceKey,
  templateProblem,
  type Frequency,
  type RecurringMode,
  type TemplateLine,
  type TransactionTemplate,
} from "@/lib/domain/templates";
import { postTransaction } from "./ledger";

export interface SaveTemplateInput {
  orgId: Id;
  userId: Id;
  id?: Id | undefined;
  name: string;
  description: string;
  lines: TemplateLine[];
  frequency: Frequency | null;
  nextDue: IsoDate | null;
  active?: boolean | undefined;
}

export async function saveTemplate(repos: Repositories, input: SaveTemplateInput) {
  const problem = templateProblem(input);
  if (problem) throw new Error(`${problem} Nothing was saved.`);
  const accounts = await repos.accounts.getMany(
    input.orgId,
    input.lines.map((l) => l.accountId),
  );
  const known = new Set(accounts.map((a) => a.id));
  if (input.lines.some((l) => !known.has(l.accountId)))
    throw new Error("A line uses an account that isn't in these books. Nothing was saved.");
  const existing = input.id ? await repos.templates.get(input.orgId, input.id) : null;
  const t: TransactionTemplate = {
    id: existing?.id ?? newId(),
    orgId: input.orgId,
    name: input.name.trim(),
    description: input.description.trim(),
    lines: input.lines,
    frequency: input.frequency,
    nextDue: input.frequency ? input.nextDue : null,
    active: input.active ?? true,
  };
  await repos.templates.save(t, {
    orgId: input.orgId,
    userId: input.userId,
    action: existing ? "template.updated" : "template.created",
    entity: "template",
    entityId: t.id,
    after: { name: t.name, frequency: t.frequency, nextDue: t.nextDue, active: t.active },
  });
  return { id: t.id };
}

export async function archiveTemplate(repos: Repositories, orgId: Id, userId: Id, id: Id) {
  const t = await repos.templates.get(orgId, id);
  if (!t) throw new Error("Template not found.");
  await repos.templates.save(
    { ...t, active: false },
    { orgId, userId, action: "template.archived", entity: "template", entityId: id },
  );
  return { ok: true };
}

export interface DueItem {
  templateId: Id;
  templateName: string;
  description: string;
  dueDate: IsoDate;
  totalCents: number;
}

/** Due dates not yet posted or skipped, oldest first. */
export async function listDue(repos: Repositories, orgId: Id, today: IsoDate) {
  const [templates, occ, mode] = await Promise.all([
    repos.templates.list(orgId),
    repos.templates.occurrences(orgId),
    repos.templates.getMode(orgId),
  ]);
  const done = new Set(occ.map((o) => `${o.templateId}:${o.dueDate}`));
  const items: DueItem[] = [];
  for (const t of templates)
    for (const d of dueDates(t, today))
      if (!done.has(`${t.id}:${d}`))
        items.push({
          templateId: t.id,
          templateName: t.name,
          description: t.description,
          dueDate: d,
          totalCents: t.lines.filter((l) => l.amountCents > 0).reduce((a, l) => a + l.amountCents, 0),
        });
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { mode, items };
}

function nextAfter(t: TransactionTemplate, dueDate: IsoDate): IsoDate | null {
  if (!t.frequency) return null;
  const anchor = Number((t.nextDue ?? dueDate).slice(8, 10));
  const n = nextDate(t.frequency, dueDate, anchor);
  return t.nextDue && t.nextDue > n ? t.nextDue : n;
}

/** Posts one due date as a real transaction (all ledger rules apply), then records it. */
export async function postDue(
  repos: Repositories,
  input: { orgId: Id; userId: Id; templateId: Id; dueDate: IsoDate },
) {
  const t = await repos.templates.get(input.orgId, input.templateId);
  if (!t) throw new Error("Template not found. Nothing was recorded.");
  const posted = await postTransaction(repos, {
    orgId: input.orgId,
    userId: input.userId,
    transactionDate: input.dueDate,
    postedDate: null,
    description: t.description,
    source: "manual",
    entries: t.lines.map((l) => ({
      accountId: l.accountId,
      amountCents: l.amountCents,
      projectId: l.projectId ?? null,
      fundId: l.fundId ?? null,
      memo: l.memo ?? null,
    })),
    idempotencyKey: occurrenceKey(t.id, input.dueDate),
  });
  await repos.templates.recordOccurrence(
    {
      id: newId(),
      orgId: input.orgId,
      templateId: t.id,
      dueDate: input.dueDate,
      status: "posted",
      transactionId: posted.id,
    },
    nextAfter(t, input.dueDate),
    {
      orgId: input.orgId,
      userId: input.userId,
      action: "template.posted",
      entity: "template",
      entityId: t.id,
      after: { dueDate: input.dueDate, transactionId: posted.id },
    },
  );
  return { id: posted.id, duplicate: posted.duplicate ?? false };
}

export async function skipDue(
  repos: Repositories,
  input: { orgId: Id; userId: Id; templateId: Id; dueDate: IsoDate },
) {
  const t = await repos.templates.get(input.orgId, input.templateId);
  if (!t) throw new Error("Template not found.");
  const changed = await repos.templates.recordOccurrence(
    {
      id: newId(),
      orgId: input.orgId,
      templateId: t.id,
      dueDate: input.dueDate,
      status: "skipped",
      transactionId: null,
    },
    nextAfter(t, input.dueDate),
    {
      orgId: input.orgId,
      userId: input.userId,
      action: "template.skipped",
      entity: "template",
      entityId: t.id,
      after: { dueDate: input.dueDate },
    },
  );
  return { ok: true, changed };
}

export async function setRecurringMode(
  repos: Repositories,
  orgId: Id,
  userId: Id,
  mode: RecurringMode,
) {
  await repos.templates.setMode(orgId, mode, {
    orgId,
    userId,
    action: "update",
    entity: "organization",
    entityId: orgId,
    after: { recurringMode: mode },
  });
  return { ok: true };
}
