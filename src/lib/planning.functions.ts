// Templates, recurring drafts, diagnostics and first-run progress. Each one does auth +
// assertCan, then calls a shared service (desktop answers the same names locally).
import { desktopAware } from "@/lib/desktop/bridge";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";
import { createSupabaseRepositories } from "./adapters/supabase";
import * as tpl from "./services/templates";
import {
  diagnostics as runDiagnostics,
  getSetupProgress as setupProgressService,
} from "./services/diagnostics";
import { FREQUENCIES } from "./domain/templates";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const orgIn = z.object({ orgId: uuid });

const listTemplatesCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    return createSupabaseRepositories(context.supabase).templates.list(data.orgId);
  });
export const listTemplates = desktopAware("listTemplates", listTemplatesCloud);

export const templateSchema = z.object({
  orgId: uuid,
  id: uuid.optional(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  lines: z
    .array(
      z.object({
        accountId: uuid,
        amountCents: z.number().int(),
        projectId: uuid.nullish(),
        fundId: uuid.nullish(),
        memo: z.string().max(500).nullish(),
      }),
    )
    .min(2),
  frequency: z.enum(FREQUENCIES as [string, ...string[]]).nullable(),
  nextDue: isoDate.nullable(),
  active: z.boolean().optional(),
});

const saveTemplateCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => templateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return tpl.saveTemplate(createSupabaseRepositories(context.supabase), {
      ...data,
      frequency: data.frequency as tpl.SaveTemplateInput["frequency"],
      userId: context.userId,
    });
  });
export const saveTemplate = desktopAware("saveTemplate", saveTemplateCloud);

const archiveTemplateCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid, id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return tpl.archiveTemplate(
      createSupabaseRepositories(context.supabase),
      data.orgId,
      context.userId,
      data.id,
    );
  });
export const archiveTemplate = desktopAware("archiveTemplate", archiveTemplateCloud);

const listDueCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid, today: isoDate }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    return tpl.listDue(createSupabaseRepositories(context.supabase), data.orgId, data.today);
  });
export const listDue = desktopAware("listDue", listDueCloud);

const dueIn = z.object({ orgId: uuid, templateId: uuid, dueDate: isoDate });

const postDueCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => dueIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return tpl.postDue(createSupabaseRepositories(context.supabase), {
      ...data,
      userId: context.userId,
    });
  });
export const postDue = desktopAware("postDue", postDueCloud);

const skipDueCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => dueIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return tpl.skipDue(createSupabaseRepositories(context.supabase), {
      ...data,
      userId: context.userId,
    });
  });
export const skipDue = desktopAware("skipDue", skipDueCloud);

const setRecurringModeCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ orgId: uuid, mode: z.enum(["drafts", "reminder"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    return tpl.setRecurringMode(
      createSupabaseRepositories(context.supabase),
      data.orgId,
      context.userId,
      data.mode,
    );
  });
export const setRecurringMode = desktopAware("setRecurringMode", setRecurringModeCloud);

const getDiagnosticsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "close_books");
    return runDiagnostics(createSupabaseRepositories(context.supabase), data.orgId);
  });
export const getDiagnostics = desktopAware("getDiagnostics", getDiagnosticsCloud);

const getSetupProgressCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    return setupProgressService(createSupabaseRepositories(context.supabase), data.orgId);
  });
export const getSetupProgress = desktopAware("getSetupProgress", getSetupProgressCloud);
