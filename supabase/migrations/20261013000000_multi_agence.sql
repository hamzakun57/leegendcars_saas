-- SaaS multi-agences : le projet Supabase doit être dédié à la copie SaaS.
-- Les lignes déjà présentes sont rattachées au tenant historique Leegend Cars;
-- aucune donnée n'est importée depuis un autre projet par cette migration.

CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agency_memberships (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_membership_default
  ON public.agency_memberships(user_id) WHERE is_default AND active;
CREATE INDEX IF NOT EXISTS idx_agency_memberships_user
  ON public.agency_memberships(user_id, active);

INSERT INTO public.agencies (slug, name, settings)
VALUES (
  'leegend-cars',
  'Leegend Cars',
  '{"brand":"Leegend Cars","city":"Maroc"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.agency_memberships (agency_id, user_id, role, active, is_default)
SELECT a.id,
       p.id,
       CASE WHEN p.role = 'admin' THEN 'owner' ELSE 'agent' END,
       true,
       NOT EXISTS (
         SELECT 1
           FROM public.agency_memberships m
          WHERE m.user_id = p.id AND m.active AND m.is_default
       )
  FROM public.admin_accounts p
 CROSS JOIN public.agencies a
 WHERE a.slug = 'leegend-cars'
ON CONFLICT (agency_id, user_id) DO NOTHING;

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.blocked_dates ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS agency_id uuid;
ALTER TABLE public.counters ADD COLUMN IF NOT EXISTS agency_id uuid;

UPDATE public.vehicles SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;
UPDATE public.blocked_dates SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;
UPDATE public.reservations SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;
UPDATE public.payments p SET agency_id = r.agency_id FROM public.reservations r WHERE p.reservation_id = r.id AND p.agency_id IS NULL;
UPDATE public.attachments a SET agency_id = r.agency_id FROM public.reservations r WHERE a.reservation_id = r.id AND a.agency_id IS NULL;
UPDATE public.maintenance SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;
UPDATE public.clients SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;
UPDATE public.counters SET agency_id = (SELECT id FROM public.agencies WHERE slug = 'leegend-cars') WHERE agency_id IS NULL;

ALTER TABLE public.vehicles ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.blocked_dates ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.reservations ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.attachments ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.maintenance ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.clients ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.counters ALTER COLUMN agency_id SET NOT NULL;

ALTER TABLE public.blocked_dates DROP CONSTRAINT IF EXISTS blocked_dates_vehicle_slug_fkey;
ALTER TABLE public.maintenance DROP CONSTRAINT IF EXISTS maintenance_vehicle_slug_fkey;
ALTER TABLE public.blocked_dates DROP CONSTRAINT IF EXISTS blocked_dates_vehicle_tenant_fkey;
ALTER TABLE public.maintenance DROP CONSTRAINT IF EXISTS maintenance_vehicle_tenant_fkey;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_tenant_vehicle_fkey;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_pkey;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_pkey PRIMARY KEY (agency_id, slug);

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_ref_key;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_agency_ref_key;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_agency_ref_key UNIQUE (agency_id, ref);

ALTER TABLE public.counters DROP CONSTRAINT IF EXISTS counters_pkey;
ALTER TABLE public.counters ADD CONSTRAINT counters_pkey PRIMARY KEY (agency_id, name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.reservations'::regclass
       AND conname = 'reservations_agency_id_id_key'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_agency_id_id_key UNIQUE (agency_id, id);
  END IF;
END;
$$;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_agency_id_fkey;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.blocked_dates DROP CONSTRAINT IF EXISTS blocked_dates_vehicle_tenant_fkey;
ALTER TABLE public.blocked_dates ADD CONSTRAINT blocked_dates_vehicle_tenant_fkey
  FOREIGN KEY (agency_id, vehicle_slug) REFERENCES public.vehicles(agency_id, slug) ON DELETE CASCADE;
ALTER TABLE public.maintenance DROP CONSTRAINT IF EXISTS maintenance_vehicle_tenant_fkey;
ALTER TABLE public.maintenance ADD CONSTRAINT maintenance_vehicle_tenant_fkey
  FOREIGN KEY (agency_id, vehicle_slug) REFERENCES public.vehicles(agency_id, slug) ON DELETE CASCADE;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_agency_id_fkey;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_agency_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_agency_id_fkey;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_agency_id_fkey;
ALTER TABLE public.clients ADD CONSTRAINT clients_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.maintenance DROP CONSTRAINT IF EXISTS maintenance_agency_id_fkey;
ALTER TABLE public.maintenance ADD CONSTRAINT maintenance_agency_id_fkey
  FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_tenant_reservation_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_tenant_reservation_fkey
  FOREIGN KEY (agency_id, reservation_id) REFERENCES public.reservations(agency_id, id) ON DELETE CASCADE;
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_tenant_reservation_fkey;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_tenant_reservation_fkey
  FOREIGN KEY (agency_id, reservation_id) REFERENCES public.reservations(agency_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vehicles_agency ON public.vehicles(agency_id, active, sort_order);
CREATE INDEX IF NOT EXISTS idx_blocked_agency ON public.blocked_dates(agency_id, vehicle_slug, start_date);
CREATE INDEX IF NOT EXISTS idx_reservations_agency ON public.reservations(agency_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_agency ON public.payments(agency_id, reservation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_agency ON public.attachments(agency_id, reservation_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_agency ON public.maintenance(agency_id, due_date);
CREATE INDEX IF NOT EXISTS idx_clients_agency ON public.clients(agency_id, last_name);

UPDATE public.reservations SET vehicle_slug = NULL WHERE vehicle_slug = '';
ALTER TABLE public.reservations ALTER COLUMN vehicle_slug DROP NOT NULL;
ALTER TABLE public.reservations ALTER COLUMN vehicle_slug DROP DEFAULT;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_tenant_client_fkey;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_agency_id_id_key;
ALTER TABLE public.clients ADD CONSTRAINT clients_agency_id_id_key UNIQUE (agency_id, id);
UPDATE public.reservations SET client_id = NULL WHERE client_id = 0;
ALTER TABLE public.reservations ALTER COLUMN client_id TYPE bigint USING client_id::bigint;
ALTER TABLE public.reservations ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_tenant_client_fkey;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_tenant_client_fkey
  FOREIGN KEY (agency_id, client_id) REFERENCES public.clients(agency_id, id);
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_tenant_vehicle_fkey;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_tenant_vehicle_fkey
  FOREIGN KEY (agency_id, vehicle_slug) REFERENCES public.vehicles(agency_id, slug);

CREATE OR REPLACE FUNCTION public.current_agency_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  headers jsonb;
  requested_id uuid;
  requested_slug text;
  result uuid;
BEGIN
  BEGIN
    headers := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
  EXCEPTION WHEN others THEN
    headers := '{}'::jsonb;
  END;

  IF auth.uid() IS NOT NULL THEN
    BEGIN
      requested_id := NULLIF(headers ->> 'x-agency-id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      requested_id := NULL;
    END;

    IF requested_id IS NOT NULL THEN
      SELECT m.agency_id INTO result
        FROM public.agency_memberships m
       WHERE m.user_id = auth.uid()
         AND m.agency_id = requested_id
         AND m.active;
    ELSE
      SELECT m.agency_id INTO result
        FROM public.agency_memberships m
       WHERE m.user_id = auth.uid()
         AND m.active
       ORDER BY m.is_default DESC, m.created_at, m.agency_id
       LIMIT 1;
    END IF;
    RETURN result;
  END IF;

  requested_slug := lower(trim(headers ->> 'x-agency-slug'));
  IF requested_slug IS NULL OR requested_slug = '' THEN
    RETURN NULL;
  END IF;
  SELECT a.id INTO result
    FROM public.agencies a
   WHERE a.slug = requested_slug AND a.active;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_agency_member(p_agency uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agency_memberships m
     WHERE m.user_id = auth.uid()
       AND m.agency_id = p_agency
       AND m.active
       AND (p_roles IS NULL OR m.role = ANY(p_roles))
  );
$$;

REVOKE ALL ON FUNCTION public.current_agency_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_agency_member(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_agency_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_agency_member(uuid, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_current_agency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  current_id uuid := public.current_agency_id();
BEGIN
  IF current_id IS NULL THEN
    RAISE EXCEPTION 'Agence invalide ou accès non autorisé' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.agency_id := current_id;
  ELSIF NEW.agency_id IS DISTINCT FROM OLD.agency_id OR OLD.agency_id IS DISTINCT FROM current_id THEN
    RAISE EXCEPTION 'Le tenant d''une donnée ne peut pas être modifié' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles','blocked_dates','reservations','payments','attachments','maintenance','clients','counters'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_assign_current_agency ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_assign_current_agency BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assign_current_agency()',
      t
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_agency_member(public.current_agency_id(), ARRAY['owner','admin']);
$$;

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_memberships ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agencies' LOOP
    EXECUTE format('DROP POLICY %I ON public.agencies', p.policyname);
  END LOOP;
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agency_memberships' LOOP
    EXECUTE format('DROP POLICY %I ON public.agency_memberships', p.policyname);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "agencies_public_or_member" ON public.agencies;
CREATE POLICY "agencies_public_or_member" ON public.agencies
  FOR SELECT TO anon, authenticated
  USING (active AND (id = public.current_agency_id() OR public.is_agency_member(id)));
DROP POLICY IF EXISTS "agencies_admin_update" ON public.agencies;
CREATE POLICY "agencies_admin_update" ON public.agencies
  FOR UPDATE TO authenticated
  USING (public.is_agency_member(id, ARRAY['owner','admin']))
  WITH CHECK (public.is_agency_member(id, ARRAY['owner','admin']));
DROP POLICY IF EXISTS "agency_memberships_read" ON public.agency_memberships;
CREATE POLICY "agency_memberships_read" ON public.agency_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_agency_member(agency_id, ARRAY['owner','admin']));
DROP POLICY IF EXISTS "agency_memberships_manage" ON public.agency_memberships;
CREATE POLICY "agency_memberships_manage" ON public.agency_memberships
  FOR ALL TO authenticated
  USING (public.is_agency_member(agency_id, ARRAY['owner','admin']))
  WITH CHECK (public.is_agency_member(agency_id, ARRAY['owner','admin']));

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles','blocked_dates','reservations','payments','attachments','maintenance','clients','counters'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY "tenant_admin_access" ON public.%I FOR ALL TO authenticated USING (agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)) WITH CHECK (agency_id = public.current_agency_id() AND public.is_agency_member(agency_id))',
      t
    );
  END LOOP;
END;
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' LOOP
    EXECUTE format('DROP POLICY %I ON public.users', p.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "tenant_public_read" ON public.vehicles
  FOR SELECT TO anon
  USING (agency_id = public.current_agency_id() AND active = 1);
CREATE POLICY "tenant_public_read" ON public.blocked_dates
  FOR SELECT TO anon
  USING (agency_id = public.current_agency_id());
CREATE POLICY "tenant_public_reservation" ON public.reservations
  FOR INSERT TO anon
  WITH CHECK (agency_id = public.current_agency_id() AND status = 'nouvelle');

DROP POLICY IF EXISTS "lire son propre profil" ON public.admin_accounts;
CREATE POLICY "lire son propre profil" ON public.admin_accounts
  FOR SELECT TO authenticated
  USING (id = auth.uid());
DROP POLICY IF EXISTS "ecrire les profils" ON public.admin_accounts;
CREATE POLICY "ecrire les profils" ON public.admin_accounts
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.forcer_reservation_nouvelle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.agency_id := public.current_agency_id();
  IF NEW.agency_id IS NULL THEN
    RAISE EXCEPTION 'Agence publique invalide' USING ERRCODE = '42501';
  END IF;
  NEW.created_at := now() at time zone 'utc';
  NEW.updated_at := now() at time zone 'utc';
  NEW.status := 'nouvelle';
  NEW.confirmed_at := '';
  NEW.contract_number := '';
  NEW.invoice_number := '';
  NEW.total_paid := 0;
  NEW.signature_data := '';
  NEW.signature_status := '';
  NEW.signature_token := '';
  NEW.signature_name := '';
  NEW.signature_mode := '';
  NEW.signature_signed_at := '';
  NEW.created_by := '';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_nouvelle ON public.reservations;
CREATE TRIGGER trg_reservation_nouvelle
  BEFORE INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.forcer_reservation_nouvelle();

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.storage_agency_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  dossiers text[] := storage.foldername(p_name);
  valeur text;
BEGIN
  valeur := CASE WHEN dossiers[1] = 'photos' THEN dossiers[3] ELSE dossiers[2] END;
  IF valeur IS NULL OR valeur !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN valeur::uuid;
END;
$$;

DROP POLICY IF EXISTS "photos de flotte lisibles par tous" ON storage.objects;
DROP POLICY IF EXISTS "photos de flotte ecrits par le service" ON storage.objects;
DROP POLICY IF EXISTS "SaaS photos public read" ON storage.objects;
DROP POLICY IF EXISTS "SaaS photos member insert" ON storage.objects;
DROP POLICY IF EXISTS "SaaS photos member update" ON storage.objects;
DROP POLICY IF EXISTS "SaaS photos member delete" ON storage.objects;
DROP POLICY IF EXISTS "SaaS uploads member select" ON storage.objects;
DROP POLICY IF EXISTS "SaaS uploads member insert" ON storage.objects;
DROP POLICY IF EXISTS "SaaS uploads member update" ON storage.objects;
DROP POLICY IF EXISTS "SaaS uploads member delete" ON storage.objects;

CREATE POLICY "SaaS photos public read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'photos');
CREATE POLICY "SaaS photos member insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'photos'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS photos member update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'photos'
    AND public.is_agency_member(public.storage_agency_id(name))
  )
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'photos'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS photos member delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'photos'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS uploads member select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'uploads'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS uploads member insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'uploads'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS uploads member update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'uploads'
    AND public.is_agency_member(public.storage_agency_id(name))
  )
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'uploads'
    AND public.is_agency_member(public.storage_agency_id(name))
  );
CREATE POLICY "SaaS uploads member delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'uploads'
    AND public.is_agency_member(public.storage_agency_id(name))
  );

CREATE OR REPLACE FUNCTION public.next_invoice_number() RETURNS text
  LANGUAGE plpgsql AS $$
DECLARE
  annee int;
  numero int;
  agence uuid := public.current_agency_id();
BEGIN
  IF agence IS NULL THEN
    RAISE EXCEPTION 'Agence invalide ou accès non autorisé' USING ERRCODE = '42501';
  END IF;
  annee := EXTRACT(YEAR FROM now())::int;
  INSERT INTO public.counters (agency_id, name, value)
  VALUES (agence, 'invoice:' || annee, 1)
  ON CONFLICT (agency_id, name) DO UPDATE SET value = public.counters.value + 1
  RETURNING value INTO numero;
  RETURN 'F' || annee || '-' || lpad(numero::text, 4, '0');
END;
$$;
