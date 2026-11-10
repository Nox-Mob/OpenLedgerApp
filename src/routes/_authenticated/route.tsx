import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isHosted, loginRedirect } from "@shared/supabase/hosted";
import { LegalGate } from "@/components/LegalGate";
import { DEMO_EMAIL, demoAllowedHere } from "@/lib/demo";
import { isDesktop, LOCAL_USER_ID } from "@/lib/edition";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Desktop: the person at the computer owns the local books, so there is no sign-in.
    if (isDesktop()) return { user: { id: LOCAL_USER_ID, email: null } };
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // Hosted: sign in once in OpenAppHub and come back here.
      if (isHosted()) throw redirect({ href: loginRedirect(window.location.href) });
      throw redirect({ to: "/auth" });
    }
    // The shared sample account is for development/preview only.
    if (data.user.email?.toLowerCase() === DEMO_EMAIL && !demoAllowedHere()) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    return { user: { id: data.user.id, email: data.user.email ?? null } };
  },
  component: () =>
    isDesktop() ? (
      <Outlet />
    ) : (
      <LegalGate>
        <Outlet />
      </LegalGate>
    ),
});
