import { randomBytes } from "node:crypto";

import "../shared/date-utils.js";
import { many, one, query, tx } from "./pg.js";

/* Toutes les fonctions qui touchent la base sont asynchrones : PostgreSQL est
   asynchrone. Les helpers purs (validation, nettoyage, calcul) restent
   synchrones et sont utilisés tels quels par l'API. */

export const now = () => new Date().toISOString();

/* Toute date stockée passe par ici : format AAAA-MM-JJ *et* existence réelle
   dans le calendrier (2026-02-30 est refusé). Retourne la date normalisée, ou
   une chaîne vide si la valeur est inexploitable. */
const isoOrEmpty = (v) => globalThis.LCDateUtils.normalizeIsoDate(v);
/* Les champs dont le nom se termine par « date » (ou « birthdate »). */
const DATE_FIELD = /(?:_date|birthdate)$/;

/* ---------- colonnes ajoutées au fil des versions ----------
   Elles font partie du schéma (supabase/schema.sql) et restent listées ici parce
   que le dossier admin s'en sert pour savoir ce qu'il a le droit d'écrire. */
const CONTRACT_MIGRATIONS = [
  // identité du 1er conducteur
  ["d1_birthdate", "TEXT DEFAULT ''"],
  ["d1_nationality", "TEXT DEFAULT ''"],
  ["d1_address", "TEXT DEFAULT ''"],
  ["d1_cin", "TEXT DEFAULT ''"],
  ["d1_cin_date", "TEXT DEFAULT ''"],
  ["d1_passport_date", "TEXT DEFAULT ''"],
  // identité du 2ème conducteur
  ["driver2_birthdate", "TEXT DEFAULT ''"],
  ["driver2_nationality", "TEXT DEFAULT ''"],
  ["driver2_address", "TEXT DEFAULT ''"],
  ["driver2_cin", "TEXT DEFAULT ''"],
  ["driver2_cin_date", "TEXT DEFAULT ''"],
  ["driver2_passport_date", "TEXT DEFAULT ''"],
  // contrat
  ["contract_number", "TEXT DEFAULT ''"],
  // facture
  ["invoice_number", "TEXT DEFAULT ''"],
  ["insurance", "TEXT DEFAULT 'Normale'"],
  ["payment_mode", "TEXT DEFAULT ''"],
  ["observations", "TEXT DEFAULT ''"],
  ["fuel_depart", "TEXT DEFAULT ''"],
  ["fuel_return", "TEXT DEFAULT ''"],
  ["options", "TEXT DEFAULT ''"],
  ["equipment", "TEXT DEFAULT ''"],
];

/* ---------- users ---------- */
export const countUsers = async () => (await one("SELECT COUNT(*)::int AS n FROM users")).n;

export const getUser = (username) => one("SELECT * FROM users WHERE username = $1", [username]);

export const createUser = async (username, passwordHash) => {
  await query("INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3)", [
    username,
    passwordHash,
    now(),
  ]);
};

export const setPassword = (username, passwordHash) =>
  query("UPDATE users SET password_hash = $1 WHERE username = $2", [passwordHash, username]);

export const deleteUser = (username) => query("DELETE FROM users WHERE username = $1", [username]);

/* ---------- véhicules ---------- */
const JSON_FIELDS = ["description", "ideal_for", "gallery", "tiers"];

export function rowToVehicle(row) {
  if (!row) return null;
  const v = { ...row, active: !!row.active, en_service: row.en_service === undefined ? true : !!row.en_service };
  for (const f of JSON_FIELDS) {
    try {
      v[f] = JSON.parse(row[f] || "[]");
    } catch {
      v[f] = [];
    }
  }
  /* La galerie ne contient que des chemins relatifs : les entrées envoyées par
     d'anciennes versions de l'admin étaient des objets. */
  v.gallery = (Array.isArray(v.gallery) ? v.gallery : [])
    .map((p) => (typeof p === "string" ? p : p?.publicPath || p?.storedName || ""))
    .filter(Boolean);
  return v;
}

export async function listVehicles({ includeInactive = true } = {}) {
  const sql = includeInactive
    ? "SELECT * FROM vehicles ORDER BY CASE WHEN sort_order > 0 THEN 0 ELSE 1 END, CASE WHEN sort_order > 0 THEN sort_order ELSE 0 END, lower(name)"
    : "SELECT * FROM vehicles WHERE active = 1 ORDER BY CASE WHEN sort_order > 0 THEN 0 ELSE 1 END, CASE WHEN sort_order > 0 THEN sort_order ELSE 0 END, lower(name)";
  return (await many(sql)).map(rowToVehicle);
}

export const getVehicle = async (slug) => rowToVehicle(await one("SELECT * FROM vehicles WHERE slug = $1", [slug]));

/* Colonnes que l'admin peut écrire. L'ordre ne sert qu'à la lisibilité. */
const VEHICLE_FIELDS = [
  "slug", "name", "modele", "tagline", "matricule_ww", "matricule", "couleur",
  "kilometrage", "transmission", "energie", "fuel", "doors", "seats",
  "puissance_fiscale", "climatisation", "categorie", "date_circulation",
  "price_from", "deposit", "approx", "badge", "accent",
  "description", "ideal_for", "gallery", "tiers", "active", "en_service", "sort_order",
];

const INT_FIELDS = new Set(["doors", "seats", "price_from", "deposit", "approx", "kilometrage", "puissance_fiscale", "sort_order"]);
const BOOL_FIELDS = new Set(["active", "en_service"]);
const JSON_FIELDS_SET = new Set(["description", "ideal_for", "gallery", "tiers"]);

const num = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** Ne garde que les clés connues, avec le bon type pour chacune. */
function cleanVehicleInput(input = {}) {
  const out = {};
  for (const key of VEHICLE_FIELDS) {
    if (input[key] === undefined) continue;
    let v = input[key];
    if (BOOL_FIELDS.has(key)) v = v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
    else if (INT_FIELDS.has(key)) v = num(v, 0);
    else if (JSON_FIELDS_SET.has(key)) v = JSON.stringify(Array.isArray(v) ? v : []);
    else v = String(v ?? "").trim().slice(0, key === "accent" || key === "description" ? 2000 : 300);
    out[key] = v;
  }
  return out;
}

export async function insertVehicle(input) {
  const v = cleanVehicleInput(input);
  if (!v.slug || !v.name) throw new Error("slug et name requis");
  const cols = Object.keys(v);
  const values = [...cols.map((c) => v[c]), now(), now()];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  await query(
    `INSERT INTO vehicles (${cols.join(", ")}, created_at, updated_at) VALUES (${placeholders}, $${cols.length + 1}, $${cols.length + 2})`,
    values
  );
  return getVehicle(v.slug);
}

export async function updateVehicle(slug, input) {
  const cur = await one("SELECT * FROM vehicles WHERE slug = $1", [slug]);
  if (!cur) return null;
  const v = cleanVehicleInput(input);
  delete v.slug; // le slug d'origine sert de cible ; le nouveau est géré ci-dessous
  if (!Object.keys(v).length) return getVehicle(slug);

  const keys = Object.keys(v);
  const newSlug = input.slug && input.slug !== slug ? cleanVehicleInput({ slug: input.slug }).slug : null;

  await tx(async (t) => {
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    await t.query(
      `UPDATE vehicles SET ${sets}, updated_at = $${keys.length + 1} WHERE slug = $${keys.length + 2}`,
      [...keys.map((k) => v[k]), now(), slug]
    );
    if (newSlug) {
      /* Le renommage touche aussi les réservations et indisponibilités qui pointent
         sur l'ancien slug : sans transaction, une coupure laisserait des orphelins. */
      await t.query("UPDATE vehicles SET slug = $1 WHERE slug = $2", [newSlug, slug]);
      await t.query("UPDATE reservations SET vehicle_slug = $1 WHERE vehicle_slug = $2", [newSlug, slug]);
      await t.query("UPDATE blocked_dates SET vehicle_slug = $1 WHERE vehicle_slug = $2", [newSlug, slug]);
      await t.query("UPDATE maintenance SET vehicle_slug = $1 WHERE vehicle_slug = $2", [newSlug, slug]);
    }
  });

  return getVehicle(newSlug || slug);
}

export async function deleteVehicle(slug) {
  const used = (await one("SELECT COUNT(*)::int AS n FROM reservations WHERE vehicle_slug = $1", [slug])).n;
  if (used > 0) return { ok: false, reason: "used", reservations: used };
  await query("DELETE FROM vehicles WHERE slug = $1", [slug]);
  return { ok: true };
}

/* ---------- indisponibilités ---------- */
export const listBlocked = (slug) =>
  slug
    ? many("SELECT * FROM blocked_dates WHERE vehicle_slug = $1 ORDER BY start_date", [slug])
    : many("SELECT * FROM blocked_dates ORDER BY start_date");

export async function addBlocked(b) {
  const row = await one(
    "INSERT INTO blocked_dates (vehicle_slug, start_date, end_date, reason, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [b.vehicle_slug, b.start_date, b.end_date, b.reason || "", now()]
  );
  return row.id;
}

export const deleteBlocked = (id) => query("DELETE FROM blocked_dates WHERE id = $1", [id]);

/* ---------- réservations ---------- */
const RES_COLUMNS = [
  "vehicle_slug", "vehicle_name", "first_name", "last_name", "country_code", "phone",
  "licence_number", "licence_date", "passport", "pickup", "ret",
  "pickup_date", "pickup_time", "return_date", "return_time",
  "baby_seat", "one_way", "days", "daily", "seat_total", "total", "notes", "summary",
];

/* Champs modifiables depuis l'admin une fois la réservation confirmée. */
export const DOSSIER_FIELDS = [
  "created_by", "client_id", "commercial", "agency", "kms_depart", "kms_return", "distance_km",
  "delivery_type", "extra_fee_label", "extra_fee", "internal_notes",
  "driver2_first_name", "driver2_last_name", "driver2_phone",
  "driver2_licence", "driver2_licence_date",
  ...CONTRACT_MIGRATIONS.map(([name]) => name),
  "notes", "status", "pickup", "ret", "pickup_date", "pickup_time", "return_date", "return_time",
];

/* Colonnes numériques : une valeur manquante y vaut 0, partout ailleurs "". */
const RES_NUM_COLUMNS = new Set(["baby_seat", "one_way", "days", "daily", "seat_total", "total"]);

export async function createReservation(r) {
  const ref = makeRef();
  const values = [
    ref,
    ...RES_COLUMNS.map((c) => r[c] ?? (RES_NUM_COLUMNS.has(c) ? 0 : "")),
    now(),
    now(),
  ];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  await query(
    `INSERT INTO reservations (ref, status, ${RES_COLUMNS.join(", ")}, created_at, updated_at)
     VALUES ($1, 'nouvelle', ${RES_COLUMNS.map((_, i) => `$${i + 2}`).join(", ")}, $${values.length - 1}, $${values.length})`,
    values
  );
  return getReservationByRef(ref);
}

export const getReservation = (id) => one("SELECT * FROM reservations WHERE id = $1", [id]);

export const getReservationByRef = (ref) => one("SELECT * FROM reservations WHERE ref = $1", [ref]);

export async function listReservations({ status, q, limit = 200, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = $1");
    params.push(status);
  }
  if (q) {
    /* SQLite ignorait la casse sur LIKE ; PostgreSQL est sensible, d'où ILIKE
       pour garder exactement le même comportement de recherche. */
    params.push(`%${q}%`);
    const i = params.length;
    where.push(
      `(first_name ILIKE $${i} OR last_name ILIKE $${i} OR phone ILIKE $${i} OR ref ILIKE $${i} OR vehicle_name ILIKE $${i})`
    );
  }
  params.push(limit, offset);
  const sql =
    "SELECT * FROM reservations" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return many(sql, params);
}

export const countReservations = async () => (await one("SELECT COUNT(*)::int AS n FROM reservations")).n;

export async function countByStatus() {
  const rows = await many("SELECT status, COUNT(*)::int AS n FROM reservations GROUP BY status");
  return rows.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
}

export async function updateReservation(id, patch) {
  const cur = await getReservation(id);
  if (!cur) return null;
  const allowed = new Set([...RES_COLUMNS, ...DOSSIER_FIELDS]);
  /* Une date invalide est ignorée plutôt qu'écrite : elle partirait sur le contrat. */
  const keys = Object.keys(patch).filter(
    (k) => allowed.has(k) && (!DATE_FIELD.test(k) || isoOrEmpty(patch[k]))
  );
  if (!keys.length) return cur;
  const INT = new Set(["kms_depart", "kms_return", "distance_km", "extra_fee", "total_paid"]);
  const BOOL_JSON = new Set(["options", "equipment"]);
  const values = keys.map((k) => {
    if (INT.has(k)) return Number(patch[k]) || 0;
    if (BOOL_JSON.has(k)) return JSON.stringify(patch[k] && typeof patch[k] === "object" ? patch[k] : {});
    if (DATE_FIELD.test(k)) return isoOrEmpty(patch[k]);
    return patch[k];
  });

  // Le statut et l'horodatage de confirmation restent cohérents entre eux.
  if (patch.status && patch.status !== cur.status) {
    if (["confirmee", "livree"].includes(patch.status) && !cur.confirmed_at) {
      values.push(now());
      keys.push("confirmed_at");
    }
    if (patch.status === "annulee") {
      await query("DELETE FROM payments WHERE reservation_id = $1", [id]);
    }
  }
  values.push(now());
  keys.push("updated_at");
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  await query(
    `UPDATE reservations SET ${sets.join(", ")} WHERE id = $${values.length + 1}`,
    [...values, id]
  );
  return getReservation(id);
}

/* ---------- dossier : totaux, règlements, pièces jointes ---------- */

/** Recalcule les totaux affichés dans le dossier (TTC, versé, reste). */
export function computeTotals(r) {
  const extra = r.extra_fee || 0;
  const ttc = (r.total || 0) + extra;
  const paid = r.total_paid || 0;
  return {
    extraFee: extra,
    totalTTC: ttc,
    totalPaid: paid,
    reste: ttc - paid,
  };
}

const LOCKED_STATUSES = ["confirmee", "livree"];

export const isDossierOpen = (r) => LOCKED_STATUSES.includes(r?.status);

/** Réservation enrichie : totaux, règlements, pièces, et l'état métier. */
export async function getDossier(id) {
  const r = await getReservation(id);
  if (!r) return null;
  const payments = await many(
    "SELECT * FROM payments WHERE reservation_id = $1 ORDER BY paid_at DESC, id DESC",
    [id]
  );
  const attachments = await many(
    "SELECT * FROM attachments WHERE reservation_id = $1 ORDER BY id DESC",
    [id]
  );

  const parseJson = (v) => {
    try { return JSON.parse(v || "{}"); } catch { return {}; }
  };
  const jsonish = parseJson(r.options);
  const equip = parseJson(r.equipment);

  /* Le mode de paiement affiché est celui du dernier règlement, avec la valeur
     saisie au dossier en repli (le modèle imprime « Espèce » par défaut). */
  const paymentMode = r.payment_mode || payments[0]?.method || "especes";
  const PAY_LABEL = { especes: "Espèce", cb: "Carte bancaire", virement: "Virement", cheque: "Chèque" };

  return {
    ...r,
    options: {
      radio: "radio" in jsonish ? !!jsonish.radio : !!r.baby_seat === false,
      gps: "gps" in jsonish ? !!jsonish.gps : false,
      babySeat: "babySeat" in jsonish ? !!jsonish.babySeat : !!r.baby_seat,
      climatiseur: "climatiseur" in jsonish ? !!jsonish.climatiseur : true,
    },
    equipment: {
      batterie: !!equip.batterie,
      outils: !!equip.outils,
      retroExt: !!equip.retroExt,
      feux: !!equip.feux,
      galerie: !!equip.galerie,
      posteRadio: "posteRadio" in equip ? !!equip.posteRadio : true,
      pressuSecours: !!equip.pressuSecours,
      alarmeCigare: !!equip.alarmeCigare,
    },
    paymentMode,
    paymentModeLabel: PAY_LABEL[paymentMode] || paymentMode,
    insurance: r.insurance || "Normale",
    contractNumber: r.contract_number || r.ref,
    invoiceNumber: r.invoice_number || "",
    /* Signature client : 'pending' = lien envoyé, 'signed' = signature enregistrée. */
    signatureStatus: r.signature_status || "",
    signatureName: r.signature_name || "",
    signatureMode: r.signature_mode || "",
    signatureSignedAt: r.signature_signed_at || "",
    signatureRequestedAt: r.signature_requested_at || "",
    signatureData: r.signature_data || "",
    signatureSigned: !!r.signature_data,
    kmDone: r.kms_depart && r.kms_return ? Math.max(0, r.kms_return - r.kms_depart) : 0,
    ...computeTotals(r),
    payments,
    attachments,
    dossierOpen: isDossierOpen(r),
  };
}

export async function addPayment(reservationId, p) {
  const res = await getReservation(reservationId);
  if (!res) return null;
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(p.paid_at || "") ? p.paid_at : now().slice(0, 10);
  await query(
    "INSERT INTO payments (reservation_id, amount, method, paid_at, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [reservationId, p.amount || 0, p.method || "especes", paidAt, p.note || "", now()]
  );
  await recalcPaid(reservationId);
  return listPayments(reservationId);
}

/** Le total versé est toujours dérivé des règlements : jamais saisi en double. */
export async function recalcPaid(reservationId) {
  const { n } = await one("SELECT COALESCE(SUM(amount), 0)::int AS n FROM payments WHERE reservation_id = $1", [reservationId]);
  await query("UPDATE reservations SET total_paid = $1, updated_at = $2 WHERE id = $3", [n, now(), reservationId]);
  return n;
}

export const listPayments = (id) =>
  many("SELECT * FROM payments WHERE reservation_id = $1 ORDER BY paid_at DESC, id DESC", [id]);

export async function deletePayment(paymentId) {
  const row = await one("SELECT reservation_id FROM payments WHERE id = $1", [paymentId]);
  if (!row) return false;
  await query("DELETE FROM payments WHERE id = $1", [paymentId]);
  await recalcPaid(row.reservation_id);
  return true;
}

export const listAttachments = (id) =>
  many("SELECT * FROM attachments WHERE reservation_id = $1 ORDER BY id DESC", [id]);

export async function addAttachment(reservationId, a) {
  await query(
    "INSERT INTO attachments (reservation_id, kind, stored_name, original_name, mime, size, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [reservationId, a.kind || "piece", a.stored_name, a.original_name, a.mime || "", a.size || 0, now()]
  );
  return listAttachments(reservationId);
}

export async function deleteAttachment(attachmentId) {
  const row = await one("SELECT stored_name FROM attachments WHERE id = $1", [attachmentId]);
  if (!row) return false;
  await query("DELETE FROM attachments WHERE id = $1", [attachmentId]);
  return row.stored_name;
}

export const deleteReservation = (id) => query("DELETE FROM reservations WHERE id = $1", [id]);

/* ---------- statistiques : rendement par véhicule ---------- */

const RECU = "('confirmee','livree')";

/**
 * Rendement de chaque voiture sur une période, filtrée sur la date de prise en
 * charge (et non la date de saisie : une location de mars doit compter dans
 * mars, même reçue en février).
 *
 * Seules les réservations confirmées et livrées comptent comme du chiffre
 * d'affaires. Les annulées et les demandes en attente sont comptées à part :
 * elles expliquent un écart sans fausser le chiffre gagné.
 */
export async function vehicleStats({ from = "0000-01-01", to = "9999-12-31" } = {}) {
  const bornes = [from, to];

  const lignes = await many(
    `SELECT v.slug, v.name, v.active,
            count(*) FILTER (WHERE r.status IN ${RECU})::int                          AS rentals,
            coalesce(sum(r.days) FILTER (WHERE r.status IN ${RECU}), 0)::int          AS jours,
            coalesce(sum(r.total + r.extra_fee) FILTER (WHERE r.status IN ${RECU}), 0)::int AS ca,
            coalesce(sum(r.total_paid) FILTER (WHERE r.status IN ${RECU}), 0)::int     AS encaisse,
            count(*) FILTER (WHERE r.status = 'annulee')::int                         AS annulees,
            count(*) FILTER (WHERE r.status = 'nouvelle')::int                        AS nouvelles
       FROM vehicles v
       LEFT JOIN reservations r
              ON r.vehicle_slug = v.slug
             AND COALESCE(NULLIF(r.pickup_date, ''), r.created_at) BETWEEN $1 AND $2
      GROUP BY v.slug, v.name, v.active
      ORDER BY ca DESC, rentals DESC, v.name`,
    bornes
  );

  /* Jours d'indisponibilité déclarés sur la période : ils servent de dénominateur
     au taux d'occupation (jours loués / jours loués + jours bloqués). */
  const bloques = new Map(
    (
      await many(
        `SELECT vehicle_slug,
                coalesce(sum((LEAST(end_date, $2)::date - GREATEST(start_date, $1)::date) + 1), 0)::int AS jours
           FROM blocked_dates
          WHERE end_date >= $1 AND start_date <= $2
          GROUP BY vehicle_slug`,
        bornes
      )
    ).map((r) => [r.vehicle_slug, r.jours])
  );

  const global = lignes.reduce(
    (acc, r) => ({
      rentals: acc.rentals + r.rentals,
      jours: acc.jours + r.jours,
      ca: acc.ca + r.ca,
      encaisse: acc.encaisse + r.encaisse,
      annulees: acc.annulees + r.annulees,
      nouvelles: acc.nouvelles + r.nouvelles,
    }),
    { rentals: 0, jours: 0, ca: 0, encaisse: 0, annulees: 0, nouvelles: 0 }
  );
  global.reste = global.ca - global.encaisse;
  global.prixMoyen = global.jours ? Math.round(global.ca / global.jours) : 0;

  const vehicles = lignes.map((r) => {
    const bloque = bloques.get(r.slug) || 0;
    const base = r.jours + bloque;
    return {
      slug: r.slug,
      name: r.name,
      active: r.active,
      rentals: r.rentals,
      jours: r.jours,
      ca: r.ca,
      encaisse: r.encaisse,
      reste: r.ca - r.encaisse,
      prixMoyen: r.jours ? Math.round(r.ca / r.jours) : 0,
      part: global.ca ? Math.round((r.ca / global.ca) * 1000) / 10 : 0,
      annulees: r.annulees,
      nouvelles: r.nouvelles,
      joursBloques: bloque,
      /* Une voiture sans aucune location n'a pas de rendement : 0 plutôt que NaN. */
      occupation: base ? Math.round((r.jours / base) * 100) : 0,
    };
  });

  return { from, to, global, vehicles };
}

/* ---------- maintenance : vignettes, assurance, vidanges… ---------- */

/**
 * Types de suivi proposés. « jours » est la durée par défaut proposée quand on
 * coche « Fait » : une vidange se reprogramme six mois plus tard, une vignette
 * un an. 0 = pas de report automatique (on laisse l'échéance telle quelle).
 * La liste n'est pas fermée : l'admin peut créer un type à la volée.
 */
export const MAINTENANCE_KINDS = [
  { id: "vignette", label: "Vignette", jours: 365 },
  { id: "assurance", label: "Assurance", jours: 365 },
  { id: "controle", label: "Contrôle technique", jours: 365 },
  { id: "vidange", label: "Vidange", jours: 180 },
  { id: "revision", label: "Révision", jours: 365 },
  { id: "filtres", label: "Filtres", jours: 365 },
  { id: "freins", label: "Freins", jours: 365 },
  { id: "pneus", label: "Pneus", jours: 365 },
  { id: "autre", label: "Autre", jours: 0 },
];

/** Jours avant échéance : négatif si la date est dépassée. */
const daysUntil = (iso, today) =>
  Math.round((new Date(`${iso}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Seuils d'affichage : en retard, puis dû sous 30 jours. */
export const MAINTENANCE_SOON_DAYS = 30;

/** rows = maintenance + nom du véhicule + état calculé. */
function rowToMaintenance(row) {
  if (!row) return null;
  const today = now().slice(0, 10);
  const jours = row.due_date ? daysUntil(row.due_date, today) : null;
  const kind = MAINTENANCE_KINDS.find((k) => k.id === row.kind);
  return {
    ...row,
    vehicle_name: row.vehicle_name || row.vehicle_slug,
    kind_label: kind?.label || row.label || row.kind,
    jours,
    /* Sans date exploitable on ne prétend rien : ni retard, ni échéance proche. */
    statut: jours === null ? "inconnu" : jours < 0 ? "retard" : jours <= MAINTENANCE_SOON_DAYS ? "bientot" : "ok",
  };
}

const MAINT_SELECT = `SELECT m.*, v.name AS vehicle_name FROM maintenance m
                        LEFT JOIN vehicles v ON v.slug = m.vehicle_slug`;

export function listMaintenance({ slug, kind } = {}) {
  const where = [];
  const params = [];
  /* Les indices de placeholders suivent la position réelle dans params : un
     $2 en dur casse dès qu'un seul filtre est fourni. */
  if (slug) { params.push(slug); where.push(`m.vehicle_slug = $${params.length}`); }
  if (kind) { params.push(kind); where.push(`m.kind = $${params.length}`); }
  /* Les échéances les plus proches d'abord : ce qui est en retard remonte tout seul. */
  const sql = `${MAINT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY m.due_date NULLS LAST, v.name, m.kind`;
  return many(sql, params).then((rows) => rows.map(rowToMaintenance));
}

export const getMaintenance = async (id) =>
  rowToMaintenance(await one(`${MAINT_SELECT} WHERE m.id = $1`, [Number(id)]));

/** Ne conserve que les champs connus, aux bons types. */
function cleanMaintenanceInput(input = {}) {
  const out = {};
  if (input.vehicle_slug !== undefined) out.vehicle_slug = String(input.vehicle_slug ?? "").trim().slice(0, 80);
  if (input.kind !== undefined) {
    out.kind = String(input.kind ?? "autre").trim().toLowerCase().slice(0, 40) || "autre";
  }
  if (input.label !== undefined) out.label = String(input.label ?? "").trim().slice(0, 80);
  if (input.due_date !== undefined) out.due_date = isoOrEmpty(input.due_date);
  if (input.period_days !== undefined) out.period_days = Math.min(3650, Math.max(0, num(input.period_days, 0)));
  if (input.period_km !== undefined) out.period_km = Math.min(1000000, Math.max(0, num(input.period_km, 0)));
  if (input.last_cost !== undefined) out.last_cost = Math.max(0, num(input.last_cost, 0));
  if (input.notes !== undefined) out.notes = String(input.notes ?? "").trim().slice(0, 500);
  return out;
}

export async function createMaintenance(input) {
  const data = cleanMaintenanceInput(input);
  if (!data.vehicle_slug || !data.due_date) return null;
  const row = await one(
    `INSERT INTO maintenance (vehicle_slug, kind, label, due_date, period_days, period_km, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      data.vehicle_slug,
      data.kind ?? "autre",
      data.label ?? "",
      data.due_date,
      data.period_days ?? 0,
      data.period_km ?? 0,
      data.notes ?? "",
      now(),
      now(),
    ]
  );
  return getMaintenance(row.id);
}

export async function updateMaintenance(id, input) {
  const cur = await getMaintenance(id);
  if (!cur) return null;
  const data = cleanMaintenanceInput(input);
  delete data.vehicle_slug; // changer de véhicule n'a pas de sens : on recrée l'entrée
  if (!Object.keys(data).length) return cur;
  const keys = Object.keys(data);
  await query(
    `UPDATE maintenance SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
    [...keys.map((k) => data[k]), now(), Number(id)]
  );
  return getMaintenance(id);
}

/**
 * Marque l'opération comme faite : la date du jour devient le dernier jour
 * worked, et l'échéance repart de là si une durée de cycle est définie.
 */
export async function markMaintenanceDone(id, { cost, km, note } = {}) {
  const m = await getMaintenance(id);
  if (!m) return null;
  const jour = now().slice(0, 10);
  const values = [jour, Number(cost) >= 0 ? Number(cost) : m.last_cost, Number(km) > 0 ? Number(km) : m.last_km];
  let sql = `UPDATE maintenance SET last_done_at = $1, last_cost = $2, last_km = $3`;
  let params = values;
  if (m.period_days > 0) {
    sql += `, due_date = $4`;
    params = [...values, addDays(jour, m.period_days)];
  }
  if (note !== undefined && String(note).trim()) {
    sql += `, notes = $${params.length + 1}`;
    params = [...params, String(note).trim().slice(0, 500)];
  }
  sql += `, updated_at = $${params.length + 1} WHERE id = $${params.length + 2}`;
  await query(sql, [...params, now(), Number(id)]);
  return getMaintenance(id);
}

export const deleteMaintenance = (id) => query("DELETE FROM maintenance WHERE id = $1", [Number(id)]);

/* ---------- clients ---------- */

export const CLIENT_FIELDS = [
  "client_type", "last_name", "first_name", "birthdate", "phone", "email", "address",
  "licence_number", "licence_date", "cin", "cin_date", "passport", "passport_date",
  "entry_number", "entry_date", "nationality", "notes",
];

const CLIENT_TYPES = ["particulier", "professionnel", "entreprise"];

const rowToClient = (row) => {
  if (!row) return null;
  return {
    ...row,
    client_type: CLIENT_TYPES.includes(row.client_type) ? row.client_type : "particulier",
    full_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.last_name || "",
  };
};

/** Liste filtrée : nom, prénom, téléphone, email, CIN, passeport, n° d'entrée. */
export async function listClients({ q = "", type = "" } = {}) {
  const where = [];
  const params = [];
  if (type === "particulier" || type === "professionnel" || type === "entreprise") {
    where.push("client_type = $1");
    params.push(type);
  }
  const needle = String(q || "").trim();
  if (needle) {
    /* COLLATE NOCASE n'existe pas en PostgreSQL : lower() fait le même travail. */
    params.push(`%${needle}%`);
    const i = params.length;
    where.push(
      `(last_name ILIKE $${i} OR first_name ILIKE $${i} OR phone ILIKE $${i} OR email ILIKE $${i}
        OR cin ILIKE $${i} OR passport ILIKE $${i} OR licence_number ILIKE $${i} OR entry_number ILIKE $${i})`
    );
  }
  const sql = `SELECT * FROM clients ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY lower(last_name), lower(first_name), id DESC`;
  return (await many(sql, params)).map(rowToClient);
}

export const getClient = async (id) => rowToClient(await one("SELECT * FROM clients WHERE id = $1", [Number(id)]));

export const countClients = async () => (await one("SELECT COUNT(*)::int AS n FROM clients")).n;

/** Ne conserve que les champs connus, en texte, pour éviter d'écrire n'importe quoi. */
function cleanClient(input) {
  const out = {};
  for (const key of CLIENT_FIELDS) {
    if (!(key in input)) continue;
    let v = input[key];
    if (v === null || v === undefined) v = "";
    v = String(v).trim();
    if (key.endsWith("_date") || key === "birthdate") {
      if (v) {
        v = isoOrEmpty(v);
        if (!v) throw new Error("Une date client est invalide. Choisissez-la avec le calendrier.");
      }
    }
    out[key] = v.slice(0, 200);
  }
  if ("client_type" in out && !CLIENT_TYPES.includes(out.client_type)) out.client_type = "particulier";
  return out;
}

export async function createClient(input) {
  const data = cleanClient(input);
  if (!data.last_name) return null;
  const cols = CLIENT_FIELDS.filter((f) => f in data);
  const values = [...cols.map((c) => data[c]), now(), now()];
  const row = await one(
    `INSERT INTO clients (${cols.join(", ")}, created_at, updated_at)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}, $${cols.length + 2})
     RETURNING id`,
    values
  );
  return getClient(row.id);
}

export async function updateClient(id, input) {
  const target = await getClient(id);
  if (!target) return null;
  const data = cleanClient(input);
  const cols = CLIENT_FIELDS.filter((f) => f in data);
  if (!cols.length) return target;
  const values = [...cols.map((c) => data[c]), now(), Number(id)];
  await query(
    `UPDATE clients SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")},
       updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`,
    values
  );
  return getClient(id);
}

export const deleteClient = async (id) =>
  (await query("DELETE FROM clients WHERE id = $1", [Number(id)])).rowCount > 0;

/* ---------- compteurs ---------- */

/** Numérotation des factures, séquence repartant chaque année : F2026-0001.
 *  L'incrément se fait en base : deux factures générées au même instant ne
 *  peuvent pas obtenir le même numéro. */
export async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const { value } = await one(
    `INSERT INTO counters (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [`invoice:${year}`]
  );
  return `F${year}-${String(value).padStart(4, "0")}`;
}

/* ---------- signature client ---------- */

/** Crée (ou réutilise) le jeton du lien de signature à distance. */
export async function createSignatureToken(reservationId) {
  const r = await getReservation(reservationId);
  if (!r) return null;
  if (r.signature_token) return r.signature_token;
  const token = randomBytes(24).toString("base64url");
  await query(
    "UPDATE reservations SET signature_token = $1, signature_status = $2, signature_requested_at = $3, updated_at = $4 WHERE id = $5",
    [token, "pending", now(), now(), reservationId]
  );
  return token;
}

export const getReservationBySignatureToken = (token) =>
  /^[\w-]{20,64}$/.test(token || "")
    ? one("SELECT * FROM reservations WHERE signature_token = $1", [token])
    : Promise.resolve(null);

/** Enregistre la signature : dataUrl = PNG base64, mode = 'onsite' | 'remote'. */
export async function saveSignature(reservationId, { data, name, mode, keepToken }) {
  const r = await getReservation(reservationId);
  if (!r) return null;
  await query(
    `UPDATE reservations
        SET signature_data = $1, signature_name = $2, signature_mode = $3,
            signature_signed_at = $4, signature_status = 'signed',
            signature_token = $5, updated_at = $6
      WHERE id = $7`,
    [data, name || "", mode || "onsite", now(), keepToken ? r.signature_token : "", now(), reservationId]
  );
  return getDossier(reservationId);
}

/** Réinitialise la signature et invalide le lien de signature à distance. */
export async function clearSignature(reservationId) {
  const r = await getReservation(reservationId);
  if (!r) return null;
  await query(
    `UPDATE reservations
        SET signature_data = '', signature_name = '', signature_mode = '',
            signature_signed_at = '', signature_status = '', signature_token = '',
            updated_at = $1
      WHERE id = $2`,
    [now(), reservationId]
  );
  return getDossier(reservationId);
}

function makeRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return "LC-" + s;
}