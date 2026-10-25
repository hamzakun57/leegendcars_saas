-- ============================================================================
-- Leegend Cars — opérations qui doivent rester atomiques
-- ============================================================================
-- Appelées par le navigateur (et plus par le serveur), ces fonctions sont
-- définies en SECURITY INVOKER : elles s'exécutent avec les droits de
-- l'appelant, donc les règles RLS s'appliquent toujours. L'admin peut les
-- appeler, un visiteur non connecté non — il n'y a même pas de policy pour lui.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Numérotation des factures : F2026-0001
-- L'incrément se fait en base ; deux factures ouvertes au même instant ne
-- peuvent pas obtenir le même numéro.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_number() RETURNS text
  LANGUAGE plpgsql AS $$
DECLARE
  annee  int;
  numero int;
  agence uuid;
BEGIN
  agence := public.current_agency_id();
  IF agence IS NULL THEN
    RAISE EXCEPTION 'Agence invalide ou accès non autorisé' USING ERRCODE = '42501';
  END IF;
  annee := EXTRACT(YEAR FROM now())::int;
  INSERT INTO counters (agency_id, name, value) VALUES (agence, 'invoice:' || annee, 1)
    ON CONFLICT (agency_id, name) DO UPDATE SET value = counters.value + 1
  RETURNING value INTO numero;
  RETURN 'F' || annee || '-' || lpad(numero::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Total versé d'un dossier : toujours dérivé des règlements, jamais saisi.
-- Une reservation_id sans règlement rend 0 au lieu de lever une exception.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_paid(p_reservation bigint) RETURNS integer
  LANGUAGE plpgsql AS $$
DECLARE
  somme int;
BEGIN
  SELECT COALESCE(SUM(amount), 0)::int INTO somme FROM payments WHERE reservation_id = p_reservation;
  UPDATE reservations
     SET total_paid = somme,
         updated_at  = now() at time zone 'utc'
   WHERE id = p_reservation;
  RETURN somme;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rendement par véhicule sur une période.
-- Même calcul que la version serveur (server/db.js, vehicleStats) : seules les
-- réservations confirmées et livrées comptent comme chiffre d'affaires, la
-- période porte sur la date de prise en charge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_stats(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
  RETURNS TABLE (
    slug          text,
    name          text,
    active        integer,
    rentals       integer,
    jours         integer,
    ca            integer,
    encaisse      integer,
    annulees      integer,
    nouvelles     integer,
    jours_bloques integer
  )
  LANGUAGE sql STABLE AS $$
    WITH bornes AS (
      SELECT COALESCE(p_from, DATE '0001-01-01') AS d1,
             COALESCE(p_to,   DATE '9999-12-31') AS d2
    ),
    bornes_txt AS (
      SELECT d1::text AS d1, d2::text AS d2 FROM bornes
    )
    SELECT
      v.slug,
      v.name,
      v.active,
      count(*) FILTER (WHERE r.status IN ('confirmee','livree'))::int AS rentals,
      coalesce(sum(r.days) FILTER (WHERE r.status IN ('confirmee','livree')), 0)::int AS jours,
      coalesce(sum(r.total + r.extra_fee) FILTER (WHERE r.status IN ('confirmee','livree')), 0)::int AS ca,
      coalesce(sum(r.total_paid) FILTER (WHERE r.status IN ('confirmee','livree')), 0)::int AS encaisse,
      count(*) FILTER (WHERE r.status = 'annulee')::int  AS annulees,
      count(*) FILTER (WHERE r.status = 'nouvelle')::int AS nouvelles,
      COALESCE((
        SELECT sum((LEAST(b.end_date, t.d2)::date - GREATEST(b.start_date, t.d1)::date) + 1)::int
          FROM blocked_dates b, bornes_txt t
         WHERE b.vehicle_slug = v.slug AND b.end_date >= t.d1 AND b.start_date <= t.d2
      ), 0)::int AS jours_bloques
    FROM vehicles v
    LEFT JOIN reservations r
           ON r.vehicle_slug = v.slug
          AND COALESCE(NULLIF(r.pickup_date, ''), r.created_at) BETWEEN (SELECT d1 FROM bornes_txt) AND (SELECT d2 FROM bornes_txt)
    GROUP BY v.slug, v.name, v.active
    ORDER BY ca DESC, rentals DESC, v.name;
  $$;

-- ---------------------------------------------------------------------------
-- Marquer une opération de maintenance comme faite.
-- Réutilise les règles de validation mises en place pour la table (durée de
-- cycle, bornes de dates) sans les dupliquer côté navigateur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_maintenance_done(
  p_id          bigint,
  p_cost        integer DEFAULT 0,
  p_km          integer DEFAULT 0,
  p_note        text    DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  cycle int;
  jour  date := now() at time zone 'utc';
BEGIN
  SELECT period_days INTO cycle FROM maintenance WHERE id = p_id;
  IF cycle IS NULL THEN
    RAISE EXCEPTION 'Entrée de maintenance introuvable';
  END IF;

  UPDATE maintenance
     SET last_done_at = jour,
         last_cost    = GREATEST(COALESCE(p_cost, 0), 0),
         last_km      = CASE WHEN COALESCE(p_km, 0) > 0 THEN p_km ELSE last_km END,
         due_date     = CASE WHEN cycle > 0 THEN (jour + cycle)::text ELSE due_date END,
         notes        = COALESCE(NULLIF(TRIM(p_note), ''), notes),
         updated_at   = now() at time zone 'utc'
   WHERE id = p_id;
END;
$$;

-- Les fonctions sont utilisables par le rôle authentifié (donc soumis à RLS).
-- Elles restent fermées au rôle anon, qui n'aurait aucun moyen de s'en servir.
GRANT EXECUTE ON FUNCTION public.next_invoice_number()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_paid(bigint)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_stats(date, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_maintenance_done(bigint, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                  TO anon, authenticated;
