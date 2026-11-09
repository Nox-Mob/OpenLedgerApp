// Reusable /invite/<token> page (SHARED-SPEC §4.3):
//   1. get_invitation → show the organization, role and app;
//   2. signed out → sign in or sign up (hub when hosted), returning here;
//   3. accept_invitation (an explicit click: a link alone never joins anyone);
//   4. if the invitation is for THIS app, run the app's follow-up hook
//      (e.g. board.on_invitation_accepted), which applies app_payload.
// An invitation for a different app is sent to that app's invitation page
// *before* accepting, so step 4 always runs in the app that owns it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { APP_NAMES } from "../apps";
import { suiteUrls, type AppId, type SuiteUrls } from "../supabase/hosted";
import { setCurrentOrg } from "../supabase/org";
import { AlertIcon, CheckIcon, MailIcon } from "./icons";

export type InvitationInfo = {
  org_name: string;
  role: "admin" | "member" | "viewer" | null;
  app: string | null;
  email: string | null;
  status: "pending" | "used" | "expired" | "revoked";
};

export type AcceptedInvitation = {
  id: string;
  org_id: string;
  role: string | null;
  app: string | null;
  app_payload: Record<string, unknown>;
};

export type InvitationRoute =
  { kind: "here" } | { kind: "redirect"; url: string } | { kind: "elsewhere"; appName: string };

/** Where an invitation should be accepted, from this app's point of view. */
export function invitationRoute(
  invitationApp: string | null,
  thisApp: AppId,
  token: string,
  urls: SuiteUrls,
): InvitationRoute {
  if (!invitationApp || invitationApp === thisApp) return { kind: "here" };
  const target = urls[invitationApp as AppId];
  if (target) return { kind: "redirect", url: `${target}/invite/${encodeURIComponent(token)}` };
  return { kind: "elsewhere", appName: APP_NAMES[invitationApp as AppId] ?? invitationApp };
}

const ROLE: Record<string, string> = { admin: "an admin", member: "a member", viewer: "a viewer" };

export function invitationSummary(inv: InvitationInfo): string {
  if (inv.role)
    return `You've been invited to join ${inv.org_name} as ${ROLE[inv.role] ?? inv.role}.`;
  const app = APP_NAMES[inv.app as AppId] ?? inv.app ?? "an app";
  return `You've been invited to ${inv.org_name} in ${app}.`;
}

const UNAVAILABLE: Record<Exclude<InvitationInfo["status"], "pending">, [string, string]> = {
  used: [
    "This invitation has already been used",
    "Each invitation works once. If it was yours, sign in to continue.",
  ],
  expired: [
    "This invitation has expired",
    "Invitations last 14 days. Ask whoever invited you to send a new one.",
  ],
  revoked: ["This invitation was cancelled", "Ask whoever invited you to send a new one."],
};

type State =
  | { step: "loading" }
  | { step: "invalid" }
  | { step: "unavailable"; info: InvitationInfo }
  | { step: "elsewhere"; info: InvitationInfo; appName: string }
  | { step: "redirecting"; info: InvitationInfo }
  | { step: "signin"; info: InvitationInfo }
  | { step: "ready"; info: InvitationInfo; email: string | null }
  | { step: "accepting"; info: InvitationInfo; email: string | null }
  | { step: "followup-failed"; info: InvitationInfo; accepted: AcceptedInvitation; message: string }
  | { step: "done"; info: InvitationInfo; accepted: AcceptedInvitation }
  | { step: "error"; info: InvitationInfo | null; message: string };

export function InvitationPage({
  token,
  app,
  client,
  signInHref,
  continueHref,
  onAccepted,
  urls = suiteUrls(),
  navigate = (url) => window.location.assign(url),
}: {
  token: string;
  app: AppId;
  client: SupabaseClient | null;
  /** Sign-in URL that comes back to `next` (hosted: loginRedirect(next)). */
  signInHref: (next: string) => string;
  /** Where "Continue" goes after joining. */
  continueHref: (accepted: AcceptedInvitation) => string;
  /** The app's follow-up (step 4), only called for invitations with app = this app. */
  onAccepted?: (accepted: AcceptedInvitation, client: SupabaseClient) => Promise<void>;
  urls?: SuiteUrls;
  navigate?: (url: string) => void;
}) {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!client) {
        setState({
          step: "error",
          info: null,
          message: "This site isn't connected to its database.",
        });
        return;
      }
      const { data, error } = await client.rpc("get_invitation", { p_token: token });
      if (cancelled) return;
      const info = (Array.isArray(data) ? data[0] : data) as InvitationInfo | undefined;
      if (error || !info) return setState({ step: "invalid" });
      if (info.status !== "pending") return setState({ step: "unavailable", info });
      const route = invitationRoute(info.app, app, token, urls);
      if (route.kind === "redirect") {
        setState({ step: "redirecting", info });
        navigate(route.url);
        return;
      }
      if (route.kind === "elsewhere")
        return setState({ step: "elsewhere", info, appName: route.appName });
      const { data: auth } = await client.auth.getUser();
      if (cancelled) return;
      if (!auth.user) return setState({ step: "signin", info });
      setState({ step: "ready", info, email: auth.user.email ?? null });
    })();
    return () => {
      cancelled = true;
    };
    // urls/navigate are configuration; re-running on their identity isn't wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, token, app]);

  const runFollowUp = useCallback(
    async (info: InvitationInfo, accepted: AcceptedInvitation) => {
      if (client && onAccepted && accepted.app === app) {
        try {
          await onAccepted(accepted, client);
        } catch (e) {
          setState({
            step: "followup-failed",
            info,
            accepted,
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      if (accepted.role) setCurrentOrg(accepted.org_id);
      setState({ step: "done", info, accepted });
    },
    [client, onAccepted, app],
  );

  async function accept(info: InvitationInfo, email: string | null) {
    if (!client) return;
    setState({ step: "accepting", info, email });
    const { data, error } = await client.rpc("accept_invitation", { p_token: token });
    const accepted = (Array.isArray(data) ? data[0] : data) as AcceptedInvitation | undefined;
    if (error || !accepted) {
      setState({
        step: "error",
        info,
        message: error?.message ?? "The invitation couldn't be accepted.",
      });
      return;
    }
    await runFollowUp(info, accepted);
  }

  const here = () => (typeof window === "undefined" ? `/invite/${token}` : window.location.href);

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-md">
      <InvitationBody
        state={state}
        app={app}
        onAccept={accept}
        onRetryFollowUp={runFollowUp}
        signInUrl={() => signInHref(here())}
        continueHref={continueHref}
      />
    </div>
  );
}

function Heading({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {icon ? (
        <div className="mb-4 grid size-10 place-items-center rounded-full bg-secondary">{icon}</div>
      ) : null}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children ? <div className="mt-2 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

const button =
  "inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60";

function InvitationBody({
  state,
  app,
  onAccept,
  onRetryFollowUp,
  signInUrl,
  continueHref,
}: {
  state: State;
  app: AppId;
  onAccept: (info: InvitationInfo, email: string | null) => void;
  onRetryFollowUp: (info: InvitationInfo, accepted: AcceptedInvitation) => void;
  signInUrl: () => string;
  continueHref: (accepted: AcceptedInvitation) => string;
}) {
  switch (state.step) {
    case "loading":
    case "redirecting":
      return (
        <div role="status" aria-live="polite">
          <Heading
            title={
              state.step === "loading" ? "Checking your invitation…" : "Taking you to the app…"
            }
          />
        </div>
      );
    case "invalid":
      return (
        <Heading
          icon={<AlertIcon className="text-destructive" />}
          title="This invitation link isn't valid"
        >
          Check that you copied the whole link from the email, or ask for a new invitation.
        </Heading>
      );
    case "unavailable": {
      const [title, text] = UNAVAILABLE[state.info.status as keyof typeof UNAVAILABLE];
      return (
        <Heading icon={<AlertIcon className="text-warning" />} title={title}>
          <p>{text}</p>
          <p className="mt-2">Organization: {state.info.org_name}</p>
        </Heading>
      );
    }
    case "elsewhere":
      return (
        <Heading icon={<MailIcon />} title={`Open this invitation in ${state.appName}`}>
          This invitation to {state.info.org_name} is for {state.appName}. Open the link from your
          email there.
        </Heading>
      );
    case "signin":
      return (
        <div className="space-y-5">
          <Heading icon={<MailIcon />} title={invitationSummary(state.info)}>
            {state.info.email ? <>It was sent to {state.info.email}. </> : null}
            Sign in or create an account to accept it.
          </Heading>
          <a href={signInUrl()} className={button}>
            Sign in to accept
          </a>
        </div>
      );
    case "ready":
    case "accepting":
      return (
        <div className="space-y-5">
          <Heading icon={<MailIcon />} title={invitationSummary(state.info)}>
            {state.email ? <>You're signed in as {state.email}.</> : null}
            {state.info.email ? <> The invitation was sent to {state.info.email}.</> : null}
          </Heading>
          <button
            type="button"
            className={button}
            disabled={state.step === "accepting"}
            onClick={() => onAccept(state.info, state.email)}
          >
            {state.step === "accepting" ? "Joining…" : `Join ${state.info.org_name}`}
          </button>
        </div>
      );
    case "followup-failed":
      return (
        <div className="space-y-5">
          <Heading
            icon={<AlertIcon className="text-warning" />}
            title={`You've joined ${state.info.org_name}`}
          >
            <p>
              But setting up your access in {APP_NAMES[app]} didn't finish: {state.message}
            </p>
          </Heading>
          <button
            type="button"
            className={button}
            onClick={() => onRetryFollowUp(state.info, state.accepted)}
          >
            Try again
          </button>
        </div>
      );
    case "done":
      return (
        <div className="space-y-5">
          <Heading
            icon={<CheckIcon className="text-success" />}
            title={`Welcome to ${state.info.org_name}`}
          >
            You've accepted the invitation.
          </Heading>
          <a href={continueHref(state.accepted)} className={button}>
            Continue
          </a>
        </div>
      );
    case "error":
      return (
        <div role="alert">
          <Heading
            icon={<AlertIcon className="text-destructive" />}
            title="We couldn't accept this invitation"
          >
            {state.message}
          </Heading>
        </div>
      );
  }
}
