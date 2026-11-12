// Nitro plugin: the self-hosted app's email sender (S-16), on the Worker's cron trigger.
// Add a trigger to your Worker (wrangler: "triggers": { "crons": ["*/5 * * * *"] }).
// Hosted builds have no trigger, and runLedgerEmail does nothing when hosted.
import { definePlugin } from "nitro";
import { runLedgerEmail } from "../src/lib/email.server";
import { runLedgerAutomation } from "../src/lib/automation.server";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async ({ env }: { env: Record<string, unknown> }) => {
    const strings: Record<string, string | undefined> = {
      ...(process.env as Record<string, string>),
    };
    for (const [k, v] of Object.entries(env ?? {})) if (typeof v === "string") strings[k] = v;
    try {
      const result = await runLedgerEmail(strings);
      if (result && (result.sent || result.failed || result.retried))
        console.log("email", JSON.stringify(result));
    } catch (error) {
      console.error("email", error);
    }
    // Self-hosted: this app's queued workflow actions (S-25). Hosted, the hub asks for them.
    if (import.meta.env["VITE_HOSTED"] !== "true") {
      try {
        const result = await runLedgerAutomation(strings);
        if (result && (result.done || result.failed))
          console.log("automation", JSON.stringify(result));
      } catch (error) {
        console.error("automation", error);
      }
    }
  });
});
