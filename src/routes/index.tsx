import { createFileRoute, redirect } from "@tanstack/react-router";
import { desktopEntryRedirect } from "@/lib/desktop/entry-redirect";

// No landing page: everyone arrives through OpenAppHub (hosted) or the sign-in page
// (self-hosted). "/" opens the dashboard; its sign-in check sends signed-out visitors to
// /auth. The desktop app goes to its own start page first.
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    await desktopEntryRedirect();
    throw redirect({ to: "/ledger" });
  },
});
