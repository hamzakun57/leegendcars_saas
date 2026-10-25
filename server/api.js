import express from "express";
import "../shared/date-utils.js";
import {
  addBlocked, addAttachment, addPayment, clearSignature, computeTotals, countByStatus, countReservations,
  createClient, createMaintenance, createReservation, createSignatureToken, deleteAttachment, deleteBlocked,
  deleteClient, deleteMaintenance, deletePayment, deleteReservation, deleteVehicle, DOSSIER_FIELDS, getClient,
  getDossier, getUser, getVehicle, insertVehicle, isDossierOpen, listAttachments, listBlocked, listClients,
  listMaintenance, listReservations, listVehicles, MAINTENANCE_KINDS, markMaintenanceDone, nextInvoiceNumber,
  saveSignature, setPassword, updateClient, updateMaintenance, updateReservation, updateVehicle, vehicleStats,
} from "./db.js";
import { deletePhoto, deleteStored, DOC_KINDS, MAX_PHOTOS, MAX_REQUEST_BYTES, saveDocument, savePhoto, tailleLot } from "./uploads.js";
import { contractHtml } from "./contract.js";
import { invoiceHtml } from "./invoice.js";
import {
  clearSessionCookie, hashPassword, needsSetup, requireAdmin, setSessionCookie, setupAdmin,
  verifyPassword,
} from "./auth.js";

const RES_STATUSES = ["nouvelle", "confirmee", "annulee", "livree"];
const PAYMENT_METHODS = ["especes", "cb", "virement", "cheque"];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** « Mercedes A-Class » ou « Citroën C3 » -> « mercedes-a-class », « citroen-c3 ». */
const slugify = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
const PHONE_RE = /^\+?[\d\s().-]{6,25}$/;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const isDate = (v) => globalThis.LCDateUtils.isIsoDate(str(v));
const realDate = (v) => globalThis.LCDateUtils.normalizeIsoDate(str(v, 10));
const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) || str(v) === "";

export const api = express.Router();

/* PostgreSQL est asynchrone : chaque handler est une promesse. En Express 4 une
   rejection non rattrapée ne rejoint pas le middleware d'erreur, on la route donc
   explicitement vers next(). */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ============ public: pricing + availability (used by the site) ============ */
/**
 * Forme publique d'un véhicule : le site consomme la base en direct, donc on
 * expose exactement les clés camelCase dont ses gabarits ont besoin.
 */
const publicVehicle = (v) => ({
  id: v.slug,
  slug: v.slug,
  name: v.name,
  tagline: v.tagline || [v.modele, v.transmission].filter(Boolean).join(" · "),
  transmission: v.transmission || "Automatique",
  fuel: v.energie || v.fuel || "Essence",
  doors: v.doors || 5,
  seats: v.seats || 5,
  priceFrom: v.price_from || 0,
  deposit: v.deposit || 0,
  approx: v.approx || 0,
  badge: v.badge || "",
  accent: v.accent || "",
  gallery: v.gallery || [],
  description: v.description || [],
  idealFor: v.ideal_for || [],
  tiers: v.tiers || [],
});

api.get("/vehicles", h(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ vehicles: (await listVehicles({ includeInactive: false })).map(publicVehicle) });
}));

api.get("/pricing", h(async (req, res) => {
  const slug = str(req.query.vehicle);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const seat = int(req.query.babySeat);

  const v = slug ? await getVehicle(slug) : (await listVehicles({ includeInactive: false }))[0];
  if (!v) return res.status(404).json({ error: "Véhicule introuvable" });

  const ms = (isDate(from) && isDate(to) ? new Date(to + "T00:00:00") - new Date(from + "T00:00:00") : 0);
  const days = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86400000)) : 0;

  let daily = v.price_from;
  for (const t of v.tiers) if (days >= t.days) daily = t.price;

  const blocked = (await listBlocked(v.slug)).filter((b) => (!from || b.end_date >= from) && (!to || b.start_date <= to));

  res.json({
    vehicle: v.slug,
    days,
    daily,
    seatTotal: seat * days,
    total: daily * days + seat * days,
    blocked,
    available: blocked.length === 0,
  });
}));

/* ============ public: receive a reservation ============ */
api.post("/reservations", h(async (req, res) => {
  const b = req.body || {};
  const errors = [];

  const first = str(b.firstName, 60);
  const last = str(b.lastName, 60);
  const phone = str(b.phone, 25);
  const licenceNumber = str(b.licenceNumber, 40);
  const licenceDate = str(b.licenceDate, 10);
  const pickup = str(b.pickup, 80);
  const ret = str(b.ret, 80);
  const pickupDate = str(b.pickupDate, 10);
  const returnDate = str(b.returnDate, 10);

  if (!first) errors.push("firstName");
  if (!last) errors.push("lastName");
  if (!PHONE_RE.test(phone) || phone.replace(/\D/g, "").length < 8) errors.push("phone");
  if (!licenceNumber) errors.push("licenceNumber");
  if (!isDate(licenceDate)) errors.push("licenceDate");
  if (!pickup) errors.push("pickup");
  if (!ret) errors.push("ret");
  if (!isDate(pickupDate)) errors.push("pickupDate");
  if (!isDate(returnDate)) errors.push("returnDate");
  if (isDate(pickupDate) && isDate(returnDate) && returnDate < pickupDate) errors.push("returnDate");

  const vehicle = b.vehicleSlug ? await getVehicle(str(b.vehicleSlug, 60)) : null;
  if (b.vehicleSlug && !vehicle) errors.push("vehicleSlug");

  if (errors.length) {
    return res.status(422).json({ error: "Champs invalides", fields: [...new Set(errors)] });
  }

  const seatRate = int(b.babySeat);
  const v = vehicle || (await listVehicles({ includeInactive: false }))[0];

  let days = 0, daily = 0, seatTotal = 0, total = 0;
  if (v) {
    const ms = new Date(returnDate + "T00:00:00") - new Date(pickupDate + "T00:00:00");
    days = Math.max(1, Math.round(ms / 86400000));
    daily = v.price_from;
    for (const t of v.tiers) if (days >= t.days) daily = t.price;
    seatTotal = seatRate * days;
    total = daily * days + seatTotal;
  }

  const summary = [
    `Réservation — ${first} ${last}`,
    `Téléphone : ${str(b.countryCode, 8)} ${phone}`,
    `Permis : ${licenceNumber}${str(b.passport, 40) ? " · Passeport : " + str(b.passport, 40) : ""}`,
    `Véhicule : ${v ? v.name : "—"}`,
    `Prise en charge : ${pickup} le ${pickupDate} à ${str(b.pickupTime, 5)}`,
    `Retour : ${ret} le ${returnDate} à ${str(b.returnTime, 5)}`,
    `Siège bébé : ${seatRate ? seatRate + " MAD/jour" : "non"}`,
    days ? `Estimation : ${days} jour(s) × ${daily} MAD = ${total} MAD` : "",
  ].filter(Boolean).join("\n");

  const saved = await createReservation({
    vehicle_slug: v ? v.slug : "",
    vehicle_name: v ? v.name : "",
    first_name: first,
    last_name: last,
    country_code: str(b.countryCode, 8),
    phone,
    licence_number: licenceNumber,
    licence_date: licenceDate,
    passport: str(b.passport, 40),
    pickup,
    ret,
    pickup_date: pickupDate,
    pickup_time: validTime(b.pickupTime) ? str(b.pickupTime, 5) : "",
    return_date: returnDate,
    return_time: validTime(b.returnTime) ? str(b.returnTime, 5) : "",
    baby_seat: seatRate,
    one_way: pickup !== ret ? 1 : 0,
    days,
    daily,
    seat_total: seatTotal,
    total,
    notes: str(b.notes, 1000),
    summary,
  });

  res.status(201).json({ ok: true, ref: saved.ref, days, daily, seatTotal, total });
}));

/* ============ admin: session ============ */
api.post("/admin/login", h(async (req, res) => {
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password || "");
  const user = await getUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Identifiants incorrects" });
  }
  setSessionCookie(res, username);
  res.json({ ok: true });
}));

api.post("/admin/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get("/admin/me", h(async (req, res) => res.json({ user: req.user, needsSetup: await needsSetup() })));

api.post("/admin/setup", h(async (req, res) => {
  if (!(await needsSetup())) return res.status(409).json({ error: "Déjà configuré" });
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password || "");
  if (username.length < 3) return res.status(422).json({ error: "Identifiant trop court" });
  if (password.length < 8) return res.status(422).json({ error: "Mot de passe : 8 caractères minimum" });
  await setupAdmin(username, password);
  setSessionCookie(res, username);
  res.json({ ok: true });
}));

/* ============ admin: dashboard ============ */
api.get("/admin/stats", requireAdmin, h(async (_req, res) => {
  const byStatus = await countByStatus();
  const all = await listVehicles();
  res.json({
    total: await countReservations(),
    nouvelles: byStatus.nouvelle || 0,
    confirmees: byStatus.confirmee || 0,
    annulees: byStatus.annulee || 0,
    livrees: byStatus.livree || 0,
    vehicles: all.length,
    activeVehicles: (await listVehicles({ includeInactive: false })).length,
  });
}));

/* ============ admin: statistiques ============ */
/* Rendement par voiture sur une période. Sans dates, l'historique complet. */
api.get("/admin/stats/vehicles", requireAdmin, h(async (req, res) => {
  const from = isDate(str(req.query.from, 10)) ? str(req.query.from, 10) : undefined;
  const to = isDate(str(req.query.to, 10)) ? str(req.query.to, 10) : undefined;
  if (from && to && to < from) {
    return res.status(422).json({ error: "La fin de période doit être après le début." });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await vehicleStats({ from, to }));
}));

/* ============ admin: maintenance ============ */
/* Vignette, assurance, vidange… Une entrée = une échéance à tenir. */
api.get("/admin/maintenance", requireAdmin, h(async (req, res) => {
  const slug = str(req.query.vehicle, 80);
  const kind = str(req.query.kind, 40);
  const items = await listMaintenance({ slug: slug || undefined, kind: kind || undefined });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    items,
    kinds: MAINTENANCE_KINDS,
    compte: {
      retard: items.filter((m) => m.statut === "retard").length,
      bientot: items.filter((m) => m.statut === "bientot").length,
      ok: items.filter((m) => m.statut === "ok").length,
    },
  });
}));

api.post("/admin/maintenance", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  const slug = str(b.vehicle_slug, 80);
  if (!(await getVehicle(slug))) return res.status(422).json({ error: "Véhicule inconnu" });
  if (!isDate(str(b.due_date, 10))) return res.status(422).json({ error: "Date d'échéance invalide (AAAA-MM-JJ)" });

  /* Un type inconnu n'est pas refusé : il est simplement créé, avec la durée
     par défaut du type le plus proche ou 0 (pas de report automatique). */
  const kind = slugify(str(b.kind, 40)) || "autre";
  const preset = MAINTENANCE_KINDS.find((k) => k.id === kind);
  const item = await createMaintenance({
    vehicle_slug: slug,
    kind,
    label: str(b.label, 80),
    due_date: str(b.due_date, 10),
    period_days: b.period_days === undefined ? (preset?.jours ?? 0) : int(b.period_days),
    period_km: int(b.period_km),
    notes: str(b.notes, 500),
  });
  if (!item) return res.status(422).json({ error: "Échéance invalide" });
  res.status(201).json({ ok: true, item });
}));

api.patch("/admin/maintenance/:id", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (b.due_date !== undefined && !isDate(str(b.due_date, 10))) {
    return res.status(422).json({ error: "Date d'échéance invalide (AAAA-MM-JJ)" });
  }
  const item = await updateMaintenance(int(req.params.id), {
    kind: b.kind !== undefined ? slugify(str(b.kind, 40)) || "autre" : undefined,
    label: b.label !== undefined ? str(b.label, 80) : undefined,
    due_date: b.due_date !== undefined ? str(b.due_date, 10) : undefined,
    period_days: b.period_days !== undefined ? int(b.period_days) : undefined,
    period_km: b.period_km !== undefined ? int(b.period_km) : undefined,
    notes: b.notes !== undefined ? str(b.notes, 500) : undefined,
  });
  if (!item) return res.status(404).json({ error: "Entrée introuvable" });
  res.json({ ok: true, item });
}));

/** L'opération a été réalisée : on date et on reprogramme la prochaine échéance. */
api.post("/admin/maintenance/:id/done", requireAdmin, h(async (req, res) => {
  const item = await markMaintenanceDone(int(req.params.id), {
    cost: int(req.body?.cost),
    km: int(req.body?.km),
    note: req.body?.note === undefined ? undefined : str(req.body.note, 500),
  });
  if (!item) return res.status(404).json({ error: "Entrée introuvable" });
  res.json({ ok: true, item });
}));

api.delete("/admin/maintenance/:id", requireAdmin, h(async (req, res) => {
  await deleteMaintenance(int(req.params.id));
  res.json({ ok: true });
}));

/* ============ admin: reservations ============ */
api.get("/admin/reservations", requireAdmin, h(async (req, res) => {
  const status = RES_STATUSES.includes(str(req.query.status, 20)) ? str(req.query.status, 20) : null;
  const q = str(req.query.q, 60);
  const rows = await listReservations({ status, q, limit: int(req.query.limit) || 200, offset: int(req.query.offset) || 0 });
  res.json({
    reservations: rows.map((r) => ({
      ...r,
      ...computeTotals(r),
      dossierOpen: isDossierOpen(r),
    })),
  });
}));

api.get("/admin/reservations/:id", requireAdmin, h(async (req, res) => {
  const d = await getDossier(int(req.params.id));
  if (!d) return res.status(404).json({ error: "Réservation introuvable" });
  res.json({ reservation: d });
}));

api.patch("/admin/reservations/:id", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const patch = {};
  const b = req.body || {};

  if (b.status !== undefined) {
    const s = str(b.status, 20);
    if (!RES_STATUSES.includes(s)) return res.status(422).json({ error: "Statut invalide" });
    patch.status = s;
  }
  // Ces deux champs arrivent en objet : str() les transformerait en "[object Object]".
  for (const k of ["options", "equipment"]) {
    if (b[k] !== undefined) patch[k] = b[k] && typeof b[k] === "object" ? b[k] : {};
  }
  for (const k of DOSSIER_FIELDS) {
    if (k === "options" || k === "equipment") continue;
    if (b[k] !== undefined) patch[k] = str(b[k], 1000);
  }

  const updated = await updateReservation(id, patch);
  if (!updated) return res.status(404).json({ error: "Réservation introuvable" });
  res.json({ ok: true, reservation: await getDossier(id) });
}));

/* ---------- règlements ---------- */
api.post("/admin/reservations/:id/payments", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const d = await getDossier(id);
  if (!d) return res.status(404).json({ error: "Réservation introuvable" });
  if (!d.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant d'enregistrer un règlement." });
  }
  const amount = int(req.body?.amount);
  if (amount <= 0) return res.status(422).json({ error: "Montant invalide" });
  const payments = await addPayment(id, {
    amount,
    method: PAYMENT_METHODS.includes(str(req.body?.method, 20)) ? str(req.body.method, 20) : "especes",
    paid_at: str(req.body?.paid_at, 10),
    note: str(req.body?.note, 200),
  });
  res.status(201).json({ ok: true, payments, reservation: await getDossier(id) });
}));

api.delete("/admin/payments/:id", requireAdmin, h(async (req, res) => {
  if (!(await deletePayment(int(req.params.id)))) return res.status(404).json({ error: "Règlement introuvable" });
  res.json({ ok: true });
}));

/* ---------- pièces jointes ---------- */
api.post("/admin/reservations/:id/attachments", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const d = await getDossier(id);
  if (!d) return res.status(404).json({ error: "Réservation introuvable" });
  if (!d.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant d'ajouter une pièce jointe." });
  }
  const kind = DOC_KINDS.includes(str(req.body?.kind, 20)) ? str(req.body.kind, 20) : "piece";
  const name = str(req.body?.name, 120);
  const files = Array.isArray(req.body?.files) ? req.body.files : [];

  /* Refus global avant tout enregistrement : la plateforme (Netlify) coupe les
     requêtes trop lourdes sans message exploitable, et l'agent comprendrait
     mal un échec à mi-parcours. */
  if (tailleLot(files) > MAX_REQUEST_BYTES) {
    return res.status(413).json({
      error: `Envoi trop lourd (max ${Math.round(MAX_REQUEST_BYTES / 1048576)} Mo de fichiers par envoi). Réduisez le nombre ou la taille des pièces.`,
    });
  }

  const errors = [];
  for (const dataUrl of files.slice(0, 6)) {
    try {
      const saved = await saveDocument(dataUrl, kind);
      await addAttachment(id, { kind, stored_name: saved.storedName, original_name: name || "document", mime: saved.mime, size: saved.size });
    } catch (e) {
      errors.push(e.message);
    }
  }
  const attachments = await listAttachments(id);
  if (!attachments.length && errors.length) return res.status(422).json({ error: errors.join(" ; ") });
  res.status(201).json({ ok: true, attachments, warnings: errors });
}));

api.delete("/admin/attachments/:id", requireAdmin, h(async (req, res) => {
  const stored = await deleteAttachment(int(req.params.id));
  if (!stored) return res.status(404).json({ error: "Pièce jointe introuvable" });
  await deleteStored(stored);
  res.json({ ok: true });
}));

/* ---------- contrat / facture (HTML imprimable) ---------- */
api.get("/admin/reservations/:id/contract", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const r = await getDossier(id);
  if (!r) return res.status(404).json({ error: "Réservation introuvable" });
  if (!r.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant de générer le contrat." });
  }
  /* Le n° de contrat EST la référence de la réservation : il bouge avec elle et
     le client retrouve son contrat par le même numéro que sa réservation. */
  if (r.contract_number !== r.ref) {
    await updateReservation(id, { contract_number: r.ref });
  }
  const fresh = await getDossier(id);
  const vehicle = fresh.vehicle_slug ? await getVehicle(fresh.vehicle_slug) : null;
  const content = contractHtml(fresh, vehicle);
  if (req.headers.accept && req.headers.accept.includes("text/html") && !req.headers["sec-fetch-dest"]?.includes("empty")) {
    res.type("html").send(content);
  } else {
    res.json({ ok: true, __html: content, __type: "html" });
  }
}));

api.get("/admin/reservations/:id/invoice", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const r = await getDossier(id);
  if (!r) return res.status(404).json({ error: "Réservation introuvable" });
  if (!r.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant de générer la facture." });
  }
  if (!r.invoice_number) {
    await updateReservation(id, { invoice_number: await nextInvoiceNumber() });
  }
  const fresh = await getDossier(id);
  const vehicle = fresh.vehicle_slug ? await getVehicle(fresh.vehicle_slug) : null;
  const content = invoiceHtml(fresh, vehicle);
  if (req.headers.accept && req.headers.accept.includes("text/html") && !req.headers["sec-fetch-dest"]?.includes("empty")) {
    res.type("html").send(content);
  } else {
    res.json({ ok: true, __html: content, __type: "html" });
  }
}));

/* ---------- signature client ---------- */
/* Le lien se compose avec l'origin de la requête : il faut que le serveur soit
   joignable à l'adresse que l'agent va envoyer au client. */
const publicOrigin = (req) => {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
};

/** Crée le lien de signature à distance et renvoie son URL. */
api.post("/admin/reservations/:id/signature/link", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const r = await getDossier(id);
  if (!r) return res.status(404).json({ error: "Réservation introuvable" });
  if (!r.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant de demander une signature." });
  }
  if (!r.contract_number) {
    await updateReservation(id, { contract_number: r.ref });
  }
  const token = await createSignatureToken(id);
  if (!token) return res.status(500).json({ error: "Impossible de créer le lien." });
  res.json({ token, url: `${publicOrigin(req)}/sign/${token}`, status: "pending" });
}));

/** Signature saisie par le client devant l'agent (pas de jeton). */
api.post("/admin/reservations/:id/signature", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  const r = await getDossier(id);
  if (!r) return res.status(404).json({ error: "Réservation introuvable" });
  if (!r.dossierOpen) {
    return res.status(409).json({ error: "Confirmez la réservation avant d'enregistrer une signature." });
  }
  const signature = String(req.body?.signature || "");
  const name = String(req.body?.name || "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "Indiquez le nom du signataire." });
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 2_000_000) {
    return res.status(400).json({ error: "Signature invalide." });
  }
  const fresh = await saveSignature(id, { data: signature, name, mode: "onsite", keepToken: false });
  res.json({ ok: true, signatureSignedAt: fresh.signatureSignedAt, signatureName: fresh.signatureName });
}));

api.delete("/admin/reservations/:id/signature", requireAdmin, h(async (req, res) => {
  const id = int(req.params.id);
  if (!(await getDossier(id))) return res.status(404).json({ error: "Réservation introuvable" });
  await clearSignature(id);
  res.json({ ok: true });
}));

api.delete("/admin/reservations/:id", requireAdmin, h(async (req, res) => {
  await deleteReservation(int(req.params.id));
  res.json({ ok: true });
}));

/* ============ admin: vehicles ============ */
api.get("/admin/vehicles", requireAdmin, h(async (_req, res) => {
  res.json({ vehicles: await listVehicles() });
}));

/** N'accepte qu'un chemin relatif sûr : ces valeurs finissent dans <img src>. */
const SAFE_IMAGE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;
const isSafeImagePath = (p) =>
  typeof p === "string" && p.length < 300 && !p.includes("://") && !p.startsWith("/") && SAFE_IMAGE_PATH.test(p);

/** La galerie ne contient que des chemins relatifs, jamais des objets. */
const photoPath = (p) => (typeof p === "string" ? p : p?.publicPath || p?.storedName || "");

/** Transforme les photos base64 en fichiers et renvoie la galerie complète. */
async function buildGallery(body, current = []) {
  const kept = Array.isArray(body.keepPhotos) ? body.keepPhotos.filter(isSafeImagePath) : null;
  /* Les galleries plus anciennes peuvent contenir des objets (retour de
     savePhoto) : on ne manipule que des chemins. */
  const currentPaths = current.map(photoPath).filter(Boolean);

  // Invariant : tout fichier de l'ancienne galerie absent de la nouvelle est
  // supprimé du stockage, que le client l'ait retiré explicitement ou non.
  const target = kept ? kept.slice(0, 20) : currentPaths.slice();
  const gone = new Set([
    ...currentPaths.filter((p) => !target.includes(p)),
    ...(Array.isArray(body.removePhotos) ? body.removePhotos.map(photoPath).filter(Boolean) : []),
  ]);
  for (const p of gone) await deletePhoto(p);

  const gallery = target.slice();
  const errors = [];
  if (body.keepPhotos && kept.length !== body.keepPhotos.length) {
    errors.push("certains chemins de photo ont été ignorés (format non autorisé)");
  }
  const ajoutees = Array.isArray(body.photos) ? body.photos : [];
  if (tailleLot(ajoutees) > MAX_REQUEST_BYTES) {
    return { gallery, errors: [...errors, `Photos trop lourdes (max ${Math.round(MAX_REQUEST_BYTES / 1048576)} Mo par envoi)`] };
  }
  for (const dataUrl of ajoutees.slice(0, MAX_PHOTOS)) {
    try {
      gallery.push(photoPath(await savePhoto(dataUrl)));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { gallery: gallery.slice(0, MAX_PHOTOS), errors };
}

api.post("/admin/vehicles", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name, 80)) return res.status(422).json({ error: "Nom requis" });
  /* Slug facultatif : s'il est absent on le déduit du nom, et une saisie
     imparfaite (majuscule, espace, accent) est corrigée au lieu d'être refusée. */
  let slug = slugify(str(b.slug, 80)) || slugify(str(b.name, 80));
  if (!SLUG_RE.test(slug)) return res.status(422).json({ error: "Slug invalide (minuscules, chiffres, tirets)" });
  if (await getVehicle(slug)) return res.status(409).json({ error: "Ce slug existe déjà" });

  const { gallery, errors } = await buildGallery(b);
  const vehicle = await insertVehicle({ ...b, slug, gallery, price_from: int(b.price_from), deposit: int(b.deposit) });
  res.status(201).json({ ok: true, vehicle, warnings: errors });
}));

api.put("/admin/vehicles/:slug", requireAdmin, h(async (req, res) => {
  const slug = str(req.params.slug, 80);
  const b = req.body || {};
  const existing = await getVehicle(slug);
  if (!existing) return res.status(404).json({ error: "Véhicule introuvable" });
  if (b.slug && !SLUG_RE.test(str(b.slug, 80))) return res.status(422).json({ error: "Slug invalide" });

  const { gallery, errors } = await buildGallery(b, existing.gallery);
  const vehicle = await updateVehicle(slug, {
    ...b,
    gallery,
    price_from: int(b.price_from),
    deposit: int(b.deposit),
  });
  if (!vehicle) return res.status(404).json({ error: "Véhicule introuvable" });
  res.json({ ok: true, vehicle, warnings: errors });
}));

api.delete("/admin/vehicles/:slug", requireAdmin, h(async (req, res) => {
  const slug = str(req.params.slug, 80);
  const v = await getVehicle(slug);
  const r = await deleteVehicle(slug);
  if (!r.ok) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${r.reservations} réservation(s) liée(s). Désactivez le véhicule à la place.`,
    });
  }
  for (const p of v?.gallery || []) await deletePhoto(p);
  res.json({ ok: true });
}));

/* ============ admin: availability ============ */
api.get("/admin/blocked", requireAdmin, h(async (req, res) => {
  const slug = str(req.query.vehicle, 80);
  res.json({ blocked: await listBlocked(slug || null) });
}));

api.post("/admin/blocked", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  const slug = str(b.vehicle_slug, 80);
  const start = str(b.start_date, 10);
  const end = str(b.end_date, 10);
  if (!(await getVehicle(slug))) return res.status(422).json({ error: "Véhicule inconnu" });
  if (!isDate(start) || !isDate(end)) return res.status(422).json({ error: "Dates invalides (AAAA-MM-JJ)" });
  if (end < start) return res.status(422).json({ error: "La fin doit être après le début" });
  const id = await addBlocked({ vehicle_slug: slug, start_date: start, end_date: end, reason: str(b.reason, 120) });
  res.status(201).json({ ok: true, id });
}));

api.delete("/admin/blocked/:id", requireAdmin, h(async (req, res) => {
  await deleteBlocked(int(req.params.id));
  res.json({ ok: true });
}));

/* ============ admin: création manuelle d'une réservation ============ */
/* Le client peut venir de la fiche Clients (client_id) ou être saisi à la main.
   Les totaux sont recalculés côté serveur à partir du barème du véhicule :
   l'agent ne peut pas envoyer un total fantaisiste. */
api.post("/admin/reservations", requireAdmin, h(async (req, res) => {
  const b = req.body || {};

  const client = int(b.client_id) ? await getClient(int(b.client_id)) : null;
  if (int(b.client_id) && !client) {
    return res.status(422).json({ error: "Fiche client introuvable" });
  }

  const first = str(b.first_name, 60) || client?.first_name || "";
  const last = str(b.last_name, 60) || client?.last_name || "";
  const phone = str(b.phone, 25) || client?.phone || "";
  const licence = str(b.licence_number, 40) || client?.licence_number || "";
  const licenceDate = str(b.licence_date, 10) || client?.licence_date || "";
  const pickup = str(b.pickup, 80);
  const ret = str(b.ret, 80);
  const pickupDate = str(b.pickup_date, 10);
  const returnDate = str(b.return_date, 10);

  const errors = [];
  if (!first) errors.push("Prénom du client");
  if (!last) errors.push("Nom du client");
  if (!licence) errors.push("Numéro de permis");
  if (!isDate(licenceDate)) errors.push("Date du permis");
  if (!pickup) errors.push("Lieu de prise en charge");
  if (!isDate(pickupDate)) errors.push("Date de départ");
  if (!ret) errors.push("Lieu de retour");
  if (!isDate(returnDate)) errors.push("Date de retour");
  if (isDate(pickupDate) && isDate(returnDate) && returnDate < pickupDate) {
    errors.push("la date de retour doit suivre la date de départ");
  }
  const vehicle = b.vehicle_slug ? await getVehicle(str(b.vehicle_slug, 60)) : null;
  if (b.vehicle_slug && !vehicle) errors.push("Véhicule");
  if (errors.length) {
    return res.status(422).json({ error: "Complétez : " + errors.join(", ") + "." });
  }

  let days = 0, daily = 0, seatTotal = 0, total = 0;
  if (vehicle) {
    const ms = new Date(returnDate + "T00:00:00") - new Date(pickupDate + "T00:00:00");
    days = Math.max(1, Math.round(ms / 86400000));
    daily = vehicle.price_from;
    for (const t of vehicle.tiers) if (days >= t.days) daily = t.price;
    seatTotal = int(b.baby_seat) * days;
    total = daily * days + seatTotal;
  }

  const summary = [
    `Réservation saisie par l'agent`,
    `Client : ${first} ${last}`,
    `Téléphone : ${str(b.country_code, 8)} ${phone}`,
    `Permis : ${licence}`,
    `Véhicule : ${vehicle ? vehicle.name : "—"}`,
    `Prise en charge : ${pickup} le ${pickupDate} à ${str(b.pickup_time, 5)}`,
    `Retour : ${ret} le ${returnDate} à ${str(b.return_time, 5)}`,
    days ? `Estimation : ${days} jour(s) × ${daily} MAD = ${total} MAD` : "",
  ].filter(Boolean).join("\n");

  const saved = await createReservation({
    client_id: client ? client.id : 0,
    vehicle_slug: vehicle ? vehicle.slug : "",
    vehicle_name: vehicle ? vehicle.name : "",
    first_name: first,
    last_name: last,
    country_code: str(b.country_code, 8),
    phone,
    licence_number: licence,
    licence_date: licenceDate,
    passport: str(b.passport, 40) || client?.passport || "",
    pickup,
    ret,
    pickup_date: pickupDate,
    pickup_time: validTime(b.pickup_time) ? str(b.pickup_time, 5) : "",
    return_date: returnDate,
    return_time: validTime(b.return_time) ? str(b.return_time, 5) : "",
    baby_seat: int(b.baby_seat),
    one_way: pickup !== ret ? 1 : 0,
    days,
    daily,
    seat_total: seatTotal,
    total,
    notes: str(b.notes, 1000),
    summary,
    created_by: str(b.created_by, 60) || req.user?.username || "",
  });

  const status = ["nouvelle", "confirmee"].includes(str(b.status, 20)) ? str(b.status, 20) : "confirmee";
  /* client_id / created_by sont des colonnes ajoutées par migration : elles ne
     font pas partie de l'INSERT de createReservation, on les écrit ensuite.
     On en profite pour recopier l'identité complète dans le dossier, afin que le
     contrat soit pré-rempli (CIN, adresse, nationalité, dates des documents). */
  await updateReservation(saved.id, {
    client_id: client ? client.id : 0,
    created_by: str(b.created_by, 60) || req.user?.username || "",
    d1_cin: client?.cin || str(b.cin, 40),
    d1_cin_date: realDate(client?.cin_date || b.cin_date),
    d1_nationality: client?.nationality || str(b.nationality, 60),
    d1_address: client?.address || str(b.address, 200),
    d1_birthdate: realDate(client?.birthdate || b.birthdate),
    d1_passport_date: realDate(client?.passport_date || b.passport_date),
    ...(status !== "nouvelle" ? { status } : {}),
  });

  const fresh = await getDossier(saved.id);
  res.status(201).json({ ok: true, reservation: fresh, days, daily, seatTotal, total });
}));

/* ============ admin: clients ============ */
api.get("/admin/clients", requireAdmin, h(async (req, res) => {
  res.json({ clients: await listClients({ q: str(req.query.q, 80), type: str(req.query.type, 20) }) });
}));

api.get("/admin/clients/:id", requireAdmin, h(async (req, res) => {
  const c = await getClient(int(req.params.id));
  if (!c) return res.status(404).json({ error: "Client introuvable" });
  res.json({ client: c });
}));

api.post("/admin/clients", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.last_name, 80)) return res.status(422).json({ error: "Le nom est obligatoire" });
  const client = await createClient(b);
  if (!client) return res.status(422).json({ error: "Client invalide" });
  res.status(201).json({ ok: true, client });
}));

api.patch("/admin/clients/:id", requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if ("last_name" in b && !str(b.last_name, 80)) {
    return res.status(422).json({ error: "Le nom est obligatoire" });
  }
  const client = await updateClient(int(req.params.id), b);
  if (!client) return res.status(404).json({ error: "Client introuvable" });
  res.json({ ok: true, client });
}));

api.delete("/admin/clients/:id", requireAdmin, h(async (req, res) => {
  if (!(await deleteClient(int(req.params.id)))) return res.status(404).json({ error: "Client introuvable" });
  res.json({ ok: true });
}));

/* ============ admin: password ============ */
api.post("/admin/password", requireAdmin, h(async (req, res) => {
  const current = String(req.body?.current || "");
  const next = String(req.body?.next || "");
  const user = await getUser(req.user.username);
  if (!user || !verifyPassword(current, user.password_hash)) {
    return res.status(401).json({ error: "Mot de passe actuel incorrect" });
  }
  if (next.length < 8) return res.status(422).json({ error: "Mot de passe : 8 caractères minimum" });
  await setPassword(req.user.username, hashPassword(next));
  res.json({ ok: true });
}));