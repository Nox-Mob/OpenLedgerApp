-- v0.1.1 everyday use: transaction templates, recurring drafts (never auto-posted),
-- an org choice between a drafts list and reminders, and budgets scoped to a fund or project.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS recurring_mode text NOT NULL DEFAULT 'drafts'
  CHECK (recurring_mode IN ('drafts','reminder'));

CREATE TABLE public.transaction_templates (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  frequency text CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  next_due date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.transaction_templates TO authenticated;
GRANT ALL ON public.transaction_templates TO service_role;
ALTER TABLE public.transaction_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view templates" ON public.transaction_templates FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY "Writers add templates" ON public.transaction_templates FOR INSERT TO authenticated
  WITH CHECK (public.can_write_org(auth.uid(), org_id));
CREATE POLICY "Writers update templates" ON public.transaction_templates FOR UPDATE TO authenticated
  USING (public.can_write_org(auth.uid(), org_id)) WITH CHECK (public.can_write_org(auth.uid(), org_id));
CREATE TRIGGER transaction_templates_updated_at BEFORE UPDATE ON public.transaction_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.recurring_occurrences (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.transaction_templates(id) DEFERRABLE INITIALLY DEFERRED,
  due_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('posted','skipped')),
  transaction_id uuid REFERENCES public.transactions(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, due_date)
);
GRANT SELECT, INSERT ON public.recurring_occurrences TO authenticated;
GRANT ALL ON public.recurring_occurrences TO service_role;
ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view occurrences" ON public.recurring_occurrences FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY "Writers record occurrences" ON public.recurring_occurrences FOR INSERT TO authenticated
  WITH CHECK (public.can_write_org(auth.uid(), org_id));

CREATE OR REPLACE FUNCTION public.guard_template_refs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.transaction_templates t WHERE t.id = NEW.template_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Template belongs to another organization';
  END IF;
  IF NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.transactions x WHERE x.id = NEW.transaction_id AND x.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Transaction belongs to another organization';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recurring_occurrences_refs BEFORE INSERT ON public.recurring_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.guard_template_refs();

-- Budgets: optional fund or project scope. One row per account, period and scope.
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS fund_id uuid REFERENCES public.funds(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_org_id_account_id_period_type_period_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS budgets_scope_key ON public.budgets (
  org_id, account_id, period_type, period_start,
  coalesce(fund_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE OR REPLACE FUNCTION public.guard_budget_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.fund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.funds f WHERE f.id = NEW.fund_id AND f.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Fund belongs to another organization';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Project belongs to another organization';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budgets_scope_guard BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_scope();

-- audited_write may now save templates and recurring history.
CREATE OR REPLACE FUNCTION public.audited_write(
  p_org uuid,
  p_ops jsonb,
  p_audit jsonb,
  p_user uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_user uuid;
  o jsonb;
  t text;
  op text;
  vals jsonb;
  m jsonb;
  inl jsonb;
  cols text;
  setl text;
  wherel text;
  n int;
  results jsonb := '[]'::jsonb;
  recorded jsonb := '[]'::jsonb;
  allowed text[] := ARRAY[
    'organizations','accounts','budgets','user_roles','org_invites','reconciliations',
    'entries','bank_transactions','import_batches','import_profiles','pledges','pledge_payments','funds',
    'categories','tags','projects','period_closes',
    'transaction_templates','recurring_occurrences'
  ];
BEGIN
  v_user := CASE WHEN v_service THEN p_user ELSE auth.uid() END;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'audited_write needs at least one change';
  END IF;
  IF p_audit IS NULL OR p_audit = 'null'::jsonb THEN
    RAISE EXCEPTION 'audited_write needs a history entry';
  END IF;

  FOR o IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    t := o->>'table';
    op := o->>'op';
    IF NOT (t = ANY (allowed)) THEN
      RAISE EXCEPTION 'Table % is not writable here', t;
    END IF;
    IF t = 'entries' AND (op <> 'update' OR (SELECT array_agg(k) FROM jsonb_object_keys(o->'values') k) <> ARRAY['reconciliation_id']) THEN
      RAISE EXCEPTION 'Entries can only change their statement check';
    END IF;
    IF t = 'organizations' AND op = 'delete' THEN
      RAISE EXCEPTION 'Organizations are deleted separately';
    END IF;

    m := coalesce(o->'match', '{}'::jsonb);
    inl := coalesce(o->'in', '{}'::jsonb);
    IF t = 'organizations' THEN
      m := m || jsonb_build_object('id', p_org);
    ELSIF t <> 'entries' THEN
      m := m || jsonb_build_object('org_id', p_org);
    END IF;

    IF op = 'insert' THEN
      vals := o->'values';
      IF jsonb_typeof(vals) = 'object' THEN vals := jsonb_build_array(vals); END IF;
      IF vals IS NULL OR jsonb_array_length(vals) = 0 THEN
        results := results || jsonb_build_array(jsonb_build_object('count', 0));
        CONTINUE;
      END IF;
      SELECT jsonb_agg(e || CASE WHEN t = 'organizations' THEN jsonb_build_object('id', p_org)
                                 ELSE jsonb_build_object('org_id', p_org) END)
        INTO vals FROM jsonb_array_elements(vals) e;
      SELECT string_agg(quote_ident(k), ', ') INTO cols FROM jsonb_object_keys(vals->0) k;
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) %s',
        t, cols, cols, t,
        CASE WHEN o->>'conflict' = 'nothing' THEN 'ON CONFLICT DO NOTHING' ELSE '' END
      ) USING vals;
      GET DIAGNOSTICS n = ROW_COUNT;
      recorded := recorded || jsonb_build_array(jsonb_build_object(
        'table', t, 'op', op, 'values', vals, 'rows', n));
    ELSIF op IN ('update', 'delete') THEN
      SELECT string_agg(x, ' AND ') INTO wherel FROM (
        SELECT format('t.%I IS NOT DISTINCT FROM mm.%I', k, k) AS x FROM jsonb_object_keys(m) k
        UNION ALL
        SELECT format('t.%I::text IN (SELECT jsonb_array_elements_text($3->%L))', k, k)
          FROM jsonb_object_keys(inl) k
      ) s;
      IF wherel IS NULL THEN RAISE EXCEPTION 'A change needs a filter'; END IF;
      IF op = 'update' THEN
        vals := o->'values';
        SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO setl FROM jsonb_object_keys(vals) k;
        IF setl IS NULL THEN RAISE EXCEPTION 'An update needs values'; END IF;
        EXECUTE format(
          'UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) r, jsonb_populate_record(NULL::public.%I, $2) mm WHERE %s',
          t, setl, t, t, wherel
        ) USING vals, m, inl;
        GET DIAGNOSTICS n = ROW_COUNT;
      ELSE
        vals := NULL;
        EXECUTE format(
          'DELETE FROM public.%I t USING jsonb_populate_record(NULL::public.%I, $2) mm WHERE %s',
          t, t, wherel
        ) USING NULL::jsonb, m, inl;
        GET DIAGNOSTICS n = ROW_COUNT;
      END IF;
      recorded := recorded || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'table', t, 'op', op, 'values', vals, 'match', m,
        'in', nullif(inl, '{}'::jsonb), 'rows', n)));
    ELSE
      RAISE EXCEPTION 'Unknown change type %', op;
    END IF;

    IF n < coalesce((o->>'min_rows')::int, 0) THEN
      RAISE EXCEPTION '%', coalesce(o->>'min_rows_message', 'The record was not found or was already changed')
        USING ERRCODE = 'P0002';
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('count', n));
  END LOOP;

  IF NOT v_service AND NOT public.is_org_member(v_user, p_org) THEN
    RAISE EXCEPTION 'Not a member of this organization' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('openledgerapp.audited_ops', recorded::text, true);
  PERFORM set_config('openledgerapp.audited_write', 'on', true);
  PERFORM public.audit_append_in_write(p_org, v_user, p_audit);
  PERFORM set_config('openledgerapp.audited_write', 'off', true);
  PERFORM set_config('openledgerapp.audited_ops', '', true);
  RETURN results;
END;
$$;

