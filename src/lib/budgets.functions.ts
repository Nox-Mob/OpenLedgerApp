import { desktopAware } from "@/lib/desktop/bridge";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";
import { createSupabaseRepositories } from "./adapters/supabase";
import { budgetVsActual as budgetVsActualService, saveBudget as saveBudgetService } from "./services/budgets";

// Budgets for the whole organization, one fund or one project. Shared service, so the
// desktop app answers the same calls from its local file.
const isoDate = z.string().regex(/^\d{4}-\d{2}-01$/);
const period = z.enum(["year", "month"]);
const scope = { fundId: z.string().uuid().nullish(), projectId: z.string().uuid().nullish() };

const budgetVsActualCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ orgId: z.string().uuid(), periodType: period, periodStart: isoDate, ...scope })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    return budgetVsActualService(
      createSupabaseRepositories(context.supabase),
      data.orgId,
      data.periodType,
      data.periodStart,
      { fundId: data.fundId ?? null, projectId: data.projectId ?? null },
    );
  });
export const budgetVsActual = desktopAware("budgetVsActual", budgetVsActualCloud);

const saveBudgetCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid(),
        periodType: period,
        periodStart: isoDate,
        amountCents: z.number().int().nullable(), // null clears the budget
        ...scope,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return saveBudgetService(createSupabaseRepositories(context.supabase), {
      ...data,
      userId: context.userId,
    });
  });
export const saveBudget = desktopAware("saveBudget", saveBudgetCloud);
