// The outside services the suite runs on (SHARED-SPEC §10.4). Shown on every app's About page next
// to the open-source packages, so people can see who handles what. Keep it in step with the Privacy
// Policy and docs/architecture.md.
export type Service = {
  name: string;
  what: string;
  url: string;
};

export const SERVICES: Service[] = [
  {
    name: "Cloudflare",
    what: "Runs the apps (Workers), serves the website, protects it from attacks, and counts visits on openapphub.org (Web Analytics, no cookies).",
    url: "https://www.cloudflare.com/",
  },
  {
    name: "Supabase",
    what: "The database, sign-in and file storage.",
    url: "https://supabase.com/",
  },
  {
    name: "Stripe",
    what: "Subscription payments, and card payments an organization takes in OpenCharterApp with its own Stripe account.",
    url: "https://stripe.com/",
  },
  {
    name: "Resend",
    what: "Sends the suite's email.",
    url: "https://resend.com/",
  },
  {
    name: "Google",
    what: "Sign in with Google, if you choose it.",
    url: "https://developers.google.com/identity",
  },
  {
    name: "GitHub",
    what: "Keeps the source code and runs the automated tests.",
    url: "https://github.com/",
  },
];
