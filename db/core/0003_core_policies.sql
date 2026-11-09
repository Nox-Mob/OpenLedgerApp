-- OpenAppHub core: row level security policies (SHARED-SPEC §3.2).
-- Idempotent: drop if exists, then create. Writes not listed here go through
-- the definer functions in 0002 (create_organization, accept_invitation, …).

-- organizations: read if member; no direct writes.
drop policy if exists "organizations: members read" on public.organizations;
create policy "organizations: members read" on public.organizations
  for select to authenticated
  using (public.is_member(id));

-- memberships: members read; owner/admin change roles (never to or from
-- owner); owner/admin remove others, anyone can leave; the owner can't be removed.
drop policy if exists "memberships: members read" on public.memberships;
create policy "memberships: members read" on public.memberships
  for select to authenticated
  using (public.is_member(org_id));

drop policy if exists "memberships: owner/admin change roles" on public.memberships;
create policy "memberships: owner/admin change roles" on public.memberships
  for update to authenticated
  using (public.has_role(org_id, '{owner,admin}'::public.org_role[]) and role <> 'owner')
  with check (public.has_role(org_id, '{owner,admin}'::public.org_role[]) and role <> 'owner');

drop policy if exists "memberships: remove or leave" on public.memberships;
create policy "memberships: remove or leave" on public.memberships
  for delete to authenticated
  using (
    role <> 'owner'
    and (public.has_role(org_id, '{owner,admin}'::public.org_role[]) or user_id = auth.uid())
  );

-- profiles: own row, or someone you share an org with; update own row.
drop policy if exists "profiles: read own or shared org" on public.profiles;
create policy "profiles: read own or shared org" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_org(id));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- invitations: owner/admin read; writes through functions.
drop policy if exists "invitations: owner/admin read" on public.invitations;
create policy "invitations: owner/admin read" on public.invitations
  for select to authenticated
  using (public.has_role(org_id, '{owner,admin}'::public.org_role[]));

-- instance_settings: any signed-in user reads.
drop policy if exists "instance_settings: signed-in read" on public.instance_settings;
create policy "instance_settings: signed-in read" on public.instance_settings
  for select to authenticated
  using (true);
