import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "./api.js";
import { attachUser, needsSetup, requireAdminPage } from "./auth.js";
import { contractHtml } from "./contract.js";
import { getDossier, getReservationBySignatureToken, getVehicle, isDossierOpen, listVehicles, saveSignature } from "./db.js";
import { closeDb } from "./pg.js";
import { seedFleet } from "./seed.js";
import { signPageHtml } from "./signature.js";
import { readStored, STORAGE_MODE } from "./uploads.js";
import { adminShell, loginPage } from "./views.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const app = express();
app.disable("x-powered-by");

/* Derriere un reverse proxy (Render, Railway, Nginx…), req.protocol et
   req.secure ne sont justes qu'en faisant confiance a l'en-tete du proxy :
   sans cela le cookie de session ne serait jamais « secure » en HTTPS et les
   liens de signature seraient generes en http://. */
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

/* Une promesse rejetée dans un handler ne rejoint pas le middleware d'erreur
   d'Express 4 : on la route explicitement vers next(). */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Les photos arrivent en base64 dans le JSON. Ce parseur doit passer AVANT le
   parseur global, sinon une photo de plusieurs Mo serait rejetée en 413.
   body-parser ignore ensuite le corps, déjà décodé (req._body).
   Le plafond annoncé ici reste supérieur à notre limite d'envoi (4 Mo de
   fichiers) : il n'existe que pour absorber le base64 et le reste du JSON. */
app.use("/api/admin/vehicles", express.json({ limit: "6mb" }));
/* Les pièces jointes partent en base64 dans le JSON (max 4 Mo de fichiers par
   envoi, cf. MAX_REQUEST_BYTES) : le JSON dépasse vite la limite générale. */
app.use(/^\/api\/admin\/reservations\/\d+\/attachments$/, express.json({ limit: "6mb" }));
app.use(/^\/api\/admin\/reservations\/\d+\/signature$/, express.json({ limit: "2mb" }));
app.use(/^\/sign\/[\w-]+$/, express.json({ limit: "2mb" }));
app.use(express.json({ limit: "128kb" }));

/* Security headers. The CSP allows only self-hosted assets; Google Fonts is the one external origin. */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join("; ")
  );
  next();
});

app.use(attachUser);

/* ---------- API ---------- */
app.use("/api", api);

/* ---------- admin UI ---------- */
app.get("/admin-assets/login.js", (_req, res) => res.sendFile(join(here, "public", "login.js")));
app.get("/admin-assets/admin.js", (_req, res) => res.sendFile(join(here, "public", "admin.js")));
app.get("/admin-assets/admin.css", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("text/css").sendFile(join(here, "public", "admin.css"));
});
app.get("/admin-assets/signature-pad.js", (_req, res) => res.sendFile(join(here, "public", "signature-pad.js")));
/* Ces deux fichiers doivent venir de la source, comme les précédents. Servis
   depuis le dossier généré, ils restaient figés après une correction : le
   navigateur affichait alors une erreur déjà réparée, et la copie périmée
   servait de preuve trompeuse. */
app.get("/admin-assets/admin-api.js", (_req, res) =>
  res.setHeader("Cache-Control", "no-cache").type("text/javascript").sendFile(join(here, "public", "admin-api.js"))
);
app.get("/admin-assets/admin-config.js", (_req, res) =>
  res.setHeader("Cache-Control", "no-cache").type("text/javascript").sendFile(join(here, "public", "admin-config.js"))
);
/* Posé dans <head> avant le premier rendu, pour éviter le clignotement de thème. */
app.get("/admin-assets/theme.js", (_req, res) =>
  res.setHeader("Cache-Control", "no-cache").type("text/javascript").sendFile(join(here, "public", "theme.js"))
);
app.get("/doc-assets/doc-print.js", (_req, res) => res.sendFile(join(here, "public", "doc-print.js")));
app.get("/doc-assets/signature-pad.js", (_req, res) => res.sendFile(join(here, "public", "signature-pad.js")));
app.get("/doc-assets/sign-page.js", (_req, res) => res.sendFile(join(here, "public", "sign-page.js")));

/* ---------- fichiers stockés (Supabase Storage ou disque) ---------- */
/* Les chemins publics restent « uploads/… » quel que soit le driver : c'est ce
   qui permet de migrer vers Supabase sans toucher au site ni à l'admin. */
app.get(/^\/uploads\/(.+)$/, h(async (req, res) => {
  const file = await readStored(req.params[0]);
  if (!file) return res.status(404).type("text/plain").send("Fichier introuvable");
  /* Les pièces de dossier (CIN, permis, contrats) sont confidentielles et
     supprimables : jamais de cache. Les photos de véhicules, elles, sont
     immuables tant que le véhicule existe. */
  const dossier = req.params[0].startsWith("reservations/");
  res.setHeader("Cache-Control", dossier ? "private, no-store" : "public, max-age=31536000, immutable");
  res.type(file.mime).send(file.buffer);
}));

/* ---------- signature client (lien public, protégé par jeton) ---------- */
app.get("/sign/:token/contrat", h(async (req, res) => {
  const r = await getReservationBySignatureToken(req.params.token);
  if (!r) return res.status(404).type("text/plain").send("Lien de signature introuvable ou expiré.");
  if (!isDossierOpen(r)) {
    return res.status(410).type("text/plain").send("Ce contrat n'est plus ouvert à la signature.");
  }
  const vehicle = r.vehicle_slug ? await getVehicle(r.vehicle_slug) : null;
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(contractHtml(await getDossier(r.id), vehicle, { toolbar: false }));
}));

app.get("/sign/:token", h(async (req, res) => {
  const r = await getReservationBySignatureToken(req.params.token);
  if (!r) return res.status(404).type("text/plain").send("Lien de signature introuvable ou expiré.");
  if (!isDossierOpen(r)) {
    return res.status(410).type("text/plain").send("Ce contrat n'est plus ouvert à la signature.");
  }
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(signPageHtml(await getDossier(r.id), req.params.token));
}));

app.post("/sign/:token", h(async (req, res) => {
  const r = await getReservationBySignatureToken(req.params.token);
  if (!r) return res.status(404).json({ error: "Lien de signature introuvable ou expiré." });
  if (!isDossierOpen(r)) {
    return res.status(410).json({ error: "Ce contrat n'est plus ouvert à la signature." });
  }
  if (r.signature_data) return res.status(409).json({ error: "Ce contrat a déjà été signé." });
  const signature = String(req.body?.signature || "");
  const name = `${r.first_name || ""} ${r.last_name || ""}`.trim().slice(0, 120);
  if (name.length < 3) return res.status(400).json({ error: "Le nom du conducteur est manquant sur la réservation." });
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 2_000_000) {
    return res.status(400).json({ error: "Signature invalide." });
  }
  /* Le jeton est conservé : le client peut ainsi relire son contrat signé. */
  await saveSignature(r.id, { data: signature, name, mode: "remote", keepToken: true });
  res.json({ ok: true });
}));

app.get("/admin/login", h(async (req, res) => {
  if (req.user) return res.redirect("/admin");
  res.send(loginPage(await needsSetup()));
}));

app.get("/admin", requireAdminPage, (_req, res) => res.send(adminShell()));

/* ---------- public site (static) ---------- */
/* Only the site itself is public. Everything under server/, node_modules/ and the
   package files must stay unreachable, or the SQLite database (and therefore the
   admin password hash) would be downloadable. */
const PRIVATE = [
  /^\/server(\/|$)/i,
  /^\/node_modules(\/|$)/i,
  /^\/package(-lock)?\.json$/i,
  /^\/\.git(\/|$)/i,
  /^\/\.env/i,
];

app.use((req, res, next) => {
  const p = decodeURIComponent(req.path);
  if (PRIVATE.some((re) => re.test(p))) {
    return res.status(404).json({ error: "Introuvable" });
  }
  next();
});

app.use(
  express.static(ROOT, {
    extensions: ["html"],
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-cache");
    },
  })
);

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) {
    return res.status(404).json({ error: "Introuvable" });
  }
  res.status(404).sendFile(join(ROOT, "index.html"));
});

/* ---------- error handler ----------
   Sans ceci, Express renvoie une page HTML contenant la stack trace et les
   chemins de fichiers, même en production. */
app.use((err, req, res, _next) => {
  const isApi = req.path.startsWith("/api/");
  if (err?.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "Fichier trop volumineux (5 Mo par fichier, 4 Mo par envoi)." });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  console.error("[erreur]", req.method, req.path, "-", err?.message);
  if (isApi) return res.status(500).json({ error: "Erreur serveur." });
  res.status(500).type("text/plain").send("Erreur serveur.");
});

/* ---------- start ---------- */
const checkEnv = () => {
  if (!process.env.SESSION_SECRET) {
    console.warn(
      "\n  ⚠  SESSION_SECRET absent — génération d'une clé temporaire (les sessions seront invalidées au redémarrage).\n" +
      "     Pour un déploiement, définissez SESSION_SECRET dans l'environnement.\n"
    );
    process.env.SESSION_SECRET = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
};

/** Base vide (première installation) : on importe la flotte par défaut, sinon
 *  le site s'affiche sans véhicules. SEED_FLEET=0 laisse le parc vide à
 *  remplir — utile quand l'application est partagée avec une agence qui gère
 *  elle-même ses propres voitures. */
async function ensureFleet() {
  try {
    if (process.env.SEED_FLEET === "0") return;
    if ((await listVehicles()).length > 0) return;
    const r = await seedFleet();
    console.log(`\n  Flotte importée : ${r.added} véhicule(s) depuis assets/js/data.js.`);
    console.log(`  Créez le compte administrateur sur ${baseUrl()}/admin\n`);
  } catch (e) {
    console.error("[erreur] import de la flotte :", e.message);
  }
}

const baseUrl = () => `http://${HOST}:${PORT}`;

if (process.argv[1] && existsSync(process.argv[1])) {
  checkEnv();
  await ensureFleet();
  const setup = await needsSetup();
  app.listen(PORT, HOST, async () => {
    const base = `http://${HOST}:${PORT}`;
    console.log(`\n  Leegend Cars`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Site      ${base}/`);
    console.log(`  Admin     ${base}/admin`);
    console.log(`  Stockage  ${STORAGE_MODE === "supabase" ? "Supabase Storage" : "disque local"}`);
    if (setup) console.log(`\n  ⚠  Première connexion : créez le compte admin sur ${base}/admin\n`);
    else console.log(`  Connexion : ${base}/admin/login\n`);
  });
}

/* Le pool garde des connexions ouvertes : sans cet arrêt propre, « npm start »
   ne se termine jamais et les redéploiements finissent en timeout. */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    closeDb().finally(() => process.exit(0));
  });
}

export default app;