import { desktopAware } from "@/lib/desktop/bridge";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEGAL_VERSIONS, missingLegalDocuments, type LegalDocumentType } from "./legal";

const hosted = () => import.meta.env["VITE_HOSTED"] === "true";

/**
 * H-07: hosted, OpenAppHub asked for the Terms and Privacy Policy at sign-up, so OpenLedgerApp
 * doesn't ask again (public.hub_accepted_terms). Its own not-advice notice still shows once.
 */
async function hubAcceptedTerms(supabase: {
  schema: (s: string) => { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };
}) {
  if (!hosted()) return false;
  const { data, error } = await supabase.schema("public").rpc("hub_accepted_terms");
  return !error && data === true;
}

const getLegalStatusCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_acceptances")
      .select("document_type, version")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const accepted = (data ?? []).map((row) => ({
      documentType: row.document_type,
      version: row.version,
    }));
    let missing: LegalDocumentType[] = missingLegalDocuments(accepted);
    const viaHub =
      missing.some((d) => d !== "non_advice") &&
      (await hubAcceptedTerms(context.supabase as never));
    if (viaHub) missing = missing.filter((d) => d === "non_advice");
    return { missing, viaHub };
  });
export const getLegalStatus = desktopAware("getLegalStatus", getLegalStatusCloud);

const acceptCurrentLegalDocumentsCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ terms: z.boolean(), privacy: z.boolean(), nonAdvice: z.literal(true) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    // Terms and privacy: agreed here, or (hosted) already accepted in OpenAppHub. Only what the
    // person agreed to here is recorded: the not-advice notice always, the terms when asked here.
    const agreedHere = data.terms && data.privacy;
    if (!agreedHere && !(await hubAcceptedTerms(context.supabase as never)))
      throw new Error("Please agree to the Terms of Service and the Privacy Policy.");
    const rows = [
      ...(agreedHere
        ? [
            { user_id: context.userId, document_type: "terms", version: LEGAL_VERSIONS.terms },
            { user_id: context.userId, document_type: "privacy", version: LEGAL_VERSIONS.privacy },
          ]
        : []),
      {
        user_id: context.userId,
        document_type: "non_advice",
        version: LEGAL_VERSIONS.non_advice,
      },
    ];
    const { error } = await context.supabase
      .from("legal_acceptances")
      // cloud-only-write: per-user or service record, not organization books
      .upsert(rows, { onConflict: "user_id,document_type,version", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const acceptCurrentLegalDocuments = desktopAware(
  "acceptCurrentLegalDocuments",
  acceptCurrentLegalDocumentsCloud,
);
