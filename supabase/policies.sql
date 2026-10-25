-- ============================================================================
-- Leegend Cars — sécurité de l'accès direct depuis le navigateur
-- ============================================================================
-- Dans cette architecture, le navigateur parle directement à Supabase avec la
-- clé « anon », qui est publique par nature. La clé « service_role » n'est
-- utilisée que par les Edge Functions.
-- La seule barrière est donc ce fichier : chaque règle doit être écrite en
-- pensant à ce qu'un visiteur NON connecté pourrait tenter.
--
-- Rappel : RLS est déjà activée sur toutes les tables (supabase/schema.sql).
-- Une table sans policy est donc inaccessible à tout le monde, y compris
-- l'admin authentifié.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Qui est administrateur ?
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_accounts (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin',
  full_name  TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;

/* SECURITY DEFINER : sans cela, lire admin_accounts pour savoir si on est admin
   déclencherait à son tour RLS, et la fonction ne renverrait jamais rien. */
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM admin_accounts
      WHERE id = auth.uid() AND role = 'admin'
    );
  $$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

/* Un utilisateur authentifié peut lire sa propre ligne : c'est ce qui permet à
   l'interface de savoir s'il a le droit d'afficher le back-office. */
DROP POLICY IF EXISTS "lire son propre profil" ON admin_accounts;
CREATE POLICY "lire son propre profil" ON admin_accounts
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Empêcher un visiteur de se nommer lui-même admin
-- ---------------------------------------------------------------------------
-- Sans cette règle, n'importe qui s'inscrit pourrait s'ajouter le rôle admin
-- avec la clé anon. Seul un service de confiance (le rôle postgres, c'est-à-dire
-- nos Edge Functions via la clé service_role) peut écrire dans cette table.
DROP POLICY IF EXISTS "ecrire les profils" ON admin_accounts;
CREATE POLICY "ecrire les profils" ON admin_accounts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- La table reste fermée à anon : aucune policy ne la mentionne.

-- ---------------------------------------------------------------------------
-- 3. Flotte : catalogue public en lecture, administration complète
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "lire la flotte active" ON vehicles;
CREATE POLICY "lire la flotte active" ON vehicles
  FOR SELECT TO anon, authenticated
  USING (active = 1);

DROP POLICY IF EXISTS "admin gere la flotte" ON vehicles;
CREATE POLICY "admin gere la flotte" ON vehicles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Réservations
-- ---------------------------------------------------------------------------
-- Un visiteur peut envoyer une demande : c'est le seul écrit qu'il a le droit
-- de faire, et il ne peut ensuite rien relire.
DROP POLICY IF EXISTS "envoyer une demande" ON reservations;
CREATE POLICY "envoyer une demande" ON reservations
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'nouvelle');

-- Aucune policy SELECT/UPDATE/DELETE pour anon : une demande envoyée n'est
-- relisible par personne d'autre que l'administrateur.

DROP POLICY IF EXISTS "admin gere les reservations" ON reservations;
CREATE POLICY "admin gere les reservations" ON reservations
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

/* Le client ne contrôle pas tout ce qu'il envoie : ces champs sont forcés.
   Sans cela, une clé anon compromise permettrait de fabriquer une réservation
   « confirmée » avec un numéro de facture et un montant encaissé. */
CREATE OR REPLACE FUNCTION public.forcer_reservation_nouvelle() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
  BEGIN
    NEW.created_at    := now() at time zone 'utc';
    NEW.updated_at    := now() at time zone 'utc';
    NEW.status        := 'nouvelle';
    NEW.confirmed_at  := '';
    NEW.contract_number := '';
    NEW.invoice_number  := '';
    NEW.total_paid      := 0;
    NEW.signature_data  := '';
    NEW.signature_status := '';
    NEW.signature_token := '';
    NEW.signature_name  := '';
    NEW.signature_mode  := '';
    NEW.signature_signed_at := '';
    NEW.created_by   := '';
    RETURN NEW;
  END;
  $$;

DROP TRIGGER IF EXISTS trg_reservation_nouvelle ON reservations;
CREATE TRIGGER trg_reservation_nouvelle
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION public.forcer_reservation_nouvelle();

-- ---------------------------------------------------------------------------
-- 5. Données strictement internes
-- ---------------------------------------------------------------------------
-- Clients, règlements, pièces jointes, suivi de maintenance, indisponibilités
-- et compteurs : aucune policy pour anon, accès complet à l'admin seulement.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','payments','attachments','maintenance','blocked_dates','counters','users'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'admin gere ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      'admin gere ' || t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Contrôle final
-- ---------------------------------------------------------------------------
-- Toutes les tables métier doivent avoir RLS active…
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','vehicles','blocked_dates','reservations','payments','attachments',
    'counters','clients','maintenance','admin_accounts'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- …et aucune table ne doit être accessible au rôle anon sans y être
-- explicitement autorisée. pg_policies.roles est un tableau de « name » :
-- on le unfold pour comparer. On liste ce qui existe, ça se relit d'un coup
-- d'œil — seules vehicles et reservations doivent apparaître.
SELECT c.relname AS ecriture_anon_autorisee
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   AND EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname
        AND p.cmd IN ('INSERT','UPDATE','DELETE','ALL')
        AND EXISTS (SELECT 1 FROM unnest(p.roles) AS r WHERE r::text IN ('anon','public'))
   )
 ORDER BY 1;
