/**
 * Comparaison des deux chemins d'accès au back-office.
 *
 * La même opération est exécutée deux fois :
 *   - via le serveur Express (/api/admin/…)
 *   - via l'adaptateur Supabase, dans un navigateur simulé
 *
 * Puis on compare la FORME des réponses (clés et types, récursivement). Si une
 * clé disparaît ou change de type, l'écran affichera autre chose : ce test
 * l'attrape avant la mise en ligne.
 *
 * Usage : npm run test:adapter
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { hashPassword } from "../server/auth.js";
import { createUser, deleteUser } from "../server/db.js";
import { closeDb } from "../server/pg.js";

const B = process.env.TEST_URL || "http://127.0.0.1:3199";
const EMAIL = process.env.ADMIN_EMAIL;
const PASS = process.env.ADMIN_PASS;
/* Le serveur Express garde son ancien mécanisme d'authentification : on lui
   crée un compte éphémère pour la comparaison. */
const VIEUX = "adapter_" + Date.now().toString(36);
const VIEUX_PASS = "ancien-mot-de-passe-123";

let pass = 0, fail = 0;
const check = (nom, ok, extra = "") => { console.log(`${ok ? "  OK  " : "ECHEC"} ${nom}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++; };

/* ---------- signature de forme ---------- */
function forme(valeur, chemin = "", profondeur = 0) {
  if (profondeur > 4) return [];
  if (valeur === null) return [`${chemin}:null`];
  if (Array.isArray(valeur)) {
    if (!valeur.length) return [`${chemin}:array-vide`];
    return [`${chemin}:array`, ...forme(valeur[0], `${chemin}[]`, profondeur + 1)];
  }
  if (typeof valeur === "object") {
    const sortie = [`${chemin}:objet`];
    for (const cle of Object.keys(valeur).sort()) {
      sortie.push(...forme(valeur[cle], chemin ? `${chemin}.${cle}` : cle, profondeur + 1));
    }
    return sortie;
  }
  return [`${chemin}:${typeof valeur}`];
}

const comparer = (a, b) => {
  const fa = forme(a).sort();
  const fb = forme(b).sort();
  const manquants = fa.filter((x) => !fb.includes(x));
  const enTrop = fb.filter((x) => !fa.includes(x));
  return { ok: manquants.length === 0 && enTrop.length === 0, manquants, enTrop };
};

if (!EMAIL || !PASS) {
  console.log("(variables ADMIN_EMAIL / ADMIN_PASS absentes : test ignoré)");
  process.exit(0);
}

await createUser(VIEUX, hashPassword(VIEUX_PASS));

/* ---------- session côté serveur Express ---------- */
let cookieServeur = "";
{
  const r = await fetch(`${B}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: VIEUX, password: VIEUX_PASS }),
  });
  cookieServeur = r.headers.getSetCookie?.()[0]?.split(";")[0] || "";
}

/* ---------- session côté navigateur simulé ---------- */
process.env.TZ = "Pacific/Auckland";
const dom = new JSDOM("<html></html>", { url: "https://leegendcars.netlify.app/admin", runScripts: "outside-only" });
const w = dom.window;
w.fetch = globalThis.fetch;
w.console = console;
/* JSDOM ne sait pas naviguer et fournit déjà un localStorage : on n'y touche
   pas, le test s'en sert comme un vrai navigateur. */
for (const f of ["vendor/supabase.js", "server/public/admin-config.js", "shared/date-utils.js", "server/public/admin-api.js"]) {
  w.eval(readFileSync(f, "utf8"));
}
check("adaptateur présent", !!w.LCAdmin);
check("mode « supabase »", w.LCAdmin?.mode === "supabase", w.LCAdmin?.mode);

/* Déclaré hors du bloc d'essai : le finally doit pouvoir nettoyer même si le
   test échoue avant la création du véhicule de travail. */
let voitureCreee = null;
let nomPieceTest = "";
let clientTestId = null;

try {
  /* Connexion : elle seule passe par l'adaptateur (le serveur a son ancien
     mécanisme, volontairement conservé). */
  const connexion = await w.eval(`window.LCAdmin.api("/api/admin/login", { method: "POST", body: { email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASS)} } })`);
  check("connexion administrateur", connexion && connexion.ok === true);
  const [flotteServeur, flotteSupabase] = await Promise.all([
    fetch(`${B}/api/admin/vehicles`, { headers: { cookie: cookieServeur } }).then((r) => r.json()),
    w.eval(`window.LCAdmin.api("/api/admin/vehicles")`),
  ]);
  const ordreValide = (liste) => liste.every((vehicule, index) => {
    if (index === 0) return true;
    const precedent = liste[index - 1];
    const rang = (v) => Number(v.sort_order) > 0 ? Number(v.sort_order) : Number.MAX_SAFE_INTEGER;
    return rang(precedent) < rang(vehicule) ||
      (rang(precedent) === rang(vehicule) &&
        String(precedent.name || "").localeCompare(String(vehicule.name || ""), "fr", { sensitivity: "base" }) <= 0);
  });
  check("tri flotte serveur : rangs positifs puis 0", ordreValide(flotteServeur.vehicles));
  check("tri flotte Supabase : rangs positifs puis 0", ordreValide(flotteSupabase.vehicles));
  const datesClientTest = {
    client_type: "particulier",
    last_name: `Dates${Date.now()}`,
    first_name: "Test",
    birthdate: "1990-05-12",
    licence_date: "2012-06-13",
    cin_date: "2018-07-14",
    passport_date: "2020-08-15",
    entry_date: "2024-09-16",
  };
  const creationClient = await w.eval(
    `window.LCAdmin.api("/api/admin/clients", { method: "POST", body: ${JSON.stringify(datesClientTest)} })`,
  );
  clientTestId = creationClient?.client?.id || null;
  check("création client avec les dates saisies", !!clientTestId);
  if (clientTestId) {
    const datesRelues = await w.eval(`window.LCAdmin.api("/api/admin/clients?q=${encodeURIComponent(datesClientTest.last_name)}")`);
    const clientRelu = datesRelues.clients.find((client) => client.id === clientTestId);
    check("toutes les dates client sont conservées",
      !!clientRelu &&
        ["birthdate", "licence_date", "cin_date", "passport_date", "entry_date"]
          .every((field) => clientRelu[field] === datesClientTest[field]));
    await w.eval(
      `window.LCAdmin.api("/api/admin/clients/${clientTestId}", { method: "PATCH", body: { birthdate: "1991-10-17", licence_date: "2013-11-18", cin_date: "2019-12-19", passport_date: "2021-01-20", entry_date: "2025-02-21" } })`,
    );
    const updatedClient = await w.eval(`window.LCAdmin.api("/api/admin/clients?q=${encodeURIComponent(datesClientTest.last_name)}")`);
    const clientMisAJour = updatedClient.clients.find((client) => client.id === clientTestId);
    check("modification des dates client conservée",
      !!clientMisAJour &&
        ["birthdate", "licence_date", "cin_date", "passport_date", "entry_date"]
          .every((field, index) => clientMisAJour[field] === ["1991-10-17", "2013-11-18", "2019-12-19", "2021-01-20", "2025-02-21"][index]));
  }
  let refusDateInvalide = "";
  try {
    await w.eval(
      `window.LCAdmin.api("/api/admin/clients", { method: "POST", body: { last_name: "DateInvalide", birthdate: "2023-02-29" } })`,
    );
  } catch (e) {
    refusDateInvalide = e.message;
  }
  check("date réellement impossible refusée", /date client est invalide/i.test(refusDateInvalide), refusDateInvalide);
  let refusMotDePasseActuel = "";
  try {
    await w.eval(`window.LCAdmin.api("/api/admin/password", { method: "POST", body: { current: "mot-de-passe-incorrect", next: "nouveau-test-123" } })`);
  } catch (e) {
    refusMotDePasseActuel = e.message;
  }
  check("changement de mot de passe vérifie le mot de passe actuel",
    refusMotDePasseActuel === "Mot de passe actuel incorrect.", refusMotDePasseActuel);

  const moi = await fetch(`${B}/api/admin/me`, { headers: { cookie: cookieServeur } }).then((r) => r.json());
  const moiAdaptateur = await w.eval(`window.LCAdmin.api("/api/admin/me")`);
  check("GET /api/admin/me : un compte est reconnu", !!moi.user && !!moiAdaptateur.user);
  check("GET /api/admin/me : même forme", comparer(moi, moiAdaptateur).ok,
    JSON.stringify(comparer(moi, moiAdaptateur).enTrop).slice(0, 120));

  const requetes = [
    ["/api/admin/stats", "tableau de bord"],
    ["/api/admin/reservations?limit=50", "liste des réservations"],
    ["/api/admin/vehicles", "flotte"],
    ["/api/admin/clients", "clients"],
    ["/api/admin/blocked", "indisponibilités"],
    ["/api/admin/maintenance", "maintenance"],
    ["/api/admin/stats/vehicles", "rendement par voiture"],
  ];

  for (const [chemin, libelle] of requetes) {
    const ancien = await fetch(B + chemin, { headers: { cookie: cookieServeur } }).then((r) => r.json());
    const nouveau = await w.eval(`window.LCAdmin.api(${JSON.stringify(chemin)})`);
    const ecart = comparer(ancien, nouveau);
    check(`${libelle} — même forme`, ecart.ok,
      ecart.ok ? "" : "manque " + JSON.stringify(ecart.manquants.slice(0, 4)) + " en trop " + JSON.stringify(ecart.enTrop.slice(0, 4)));
  }

  /* Le dossier complet est le plus riche : totaux, règlements, pièces,
     signature. Il faut une vraie réservation pour l'exercer — on en crée une
     par l'API du serveur (donc avec toutes les valeurs possibles), on compare,
     puis on la supprime. */
  const brut = await fetch(`${B}/api/admin/vehicles`, { headers: { cookie: cookieServeur } });
  const flotte = await brut.json();
  /* Déclaré ici : le finally doit pouvoir le nettoyer même si le test échoue
     avant la création de la réservation. */
  let nomVoiture = flotte.vehicles && flotte.vehicles[0] ? flotte.vehicles[0].slug : null;
  if (!nomVoiture) {
    const r = await fetch(`${B}/api/admin/vehicles`, {
      method: "POST",
      headers: { cookie: cookieServeur, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Adaptateur ${Date.now()}`, price_from: 500 }),
    });
    voitureCreee = (await r.json()).vehicle.slug;
    nomVoiture = voitureCreee;
  }
  const creation = await fetch(`${B}/api/admin/reservations`, {
    method: "POST",
    headers: { cookie: cookieServeur, "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: "Comparaison", last_name: "Formes", phone: "+212600000000",
      licence_number: "ZZ999", licence_date: "2020-01-01",
      pickup: "Tanger", ret: "Rabat", pickup_date: "2026-11-02", return_date: "2026-11-09",
      vehicle_slug: nomVoiture, status: "confirmee",
      kms_depart: 100, kms_return: 350, d1_cin: "AB123", insurance: "Premium",
    }),
  }).then((r) => r.json());

  if (creation.ok) {
    const id = creation.reservation.id;

    /* La suppression des pièces jointes passe par cette route Netlify avant
       d'appeler le stockage. Vérifier la vraie requête évite qu'une route
       invalide laisse silencieusement les pièces visibles. */
    const pngTest = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const ajoutPiece = await w.eval(
      `window.LCAdmin.api("/api/admin/reservations/${id}/attachments", { method: "POST", body: { kind: "piece", name: "Test suppression", files: [${JSON.stringify(pngTest)}] } })`,
    );
    const pieceTest = ajoutPiece?.attachments?.[0];
    nomPieceTest = pieceTest?.stored_name || "";
    check("pièce jointe de test téléversée", !!pieceTest?.id && !!nomPieceTest);
    if (pieceTest?.id) {
      let erreurSuppressionPiece = "";
      try {
        await w.eval(`window.LCAdmin.api("/api/admin/attachments/${pieceTest.id}", { method: "DELETE" })`);
      } catch (e) {
        erreurSuppressionPiece = e.message;
      }
      const dossierApresSuppression = await w.eval(`window.LCAdmin.api("/api/admin/reservations/${id}")`);
      check("suppression d'une pièce via l'adaptateur", !dossierApresSuppression.reservation.attachments.some((a) => a.id === pieceTest.id), erreurSuppressionPiece);
    }

    /* Un règlement : le dossier doit exposer « payments » et « totalPaid ». */
    await fetch(`${B}/api/admin/reservations/${id}/payments`, {
      method: "POST",
      headers: { cookie: cookieServeur, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 500, method: "cb" }),
    });

    const ancienDossier = await fetch(`${B}/api/admin/reservations/${id}`, { headers: { cookie: cookieServeur } }).then((r) => r.json());
    const nouveauDossier = await w.eval(`window.LCAdmin.api("/api/admin/reservations/${id}")`);
    const ecart = comparer(ancienDossier, nouveauDossier);
    check("dossier complet — même forme", ecart.ok, ecart.ok ? "" : "manque " + JSON.stringify(ecart.manquants.slice(0, 8)));

    /* Et les valeurs calculées doivent être identiques, pas seulement la forme :
       un dossier qui affiche « reste dû » faux est un bug visible. */
    const a = ancienDossier.reservation, n = nouveauDossier.reservation;
    for (const champ of ["totalTTC", "totalPaid", "reste", "kmDone", "dossierOpen", "paymentModeLabel", "insurance", "contractNumber"]) {
      check(`dossier — ${champ} identique`, JSON.stringify(a[champ]) === JSON.stringify(n[champ]), `${JSON.stringify(a[champ])} vs ${JSON.stringify(n[champ])}`);
    }

    /* Une mise à jour doit produire le même dossier des deux côtés. */
    const ancienApres = await fetch(`${B}/api/admin/reservations/${id}`, {
      method: "PATCH", headers: { cookie: cookieServeur, "Content-Type": "application/json" },
      body: JSON.stringify({ kms_depart: 10, kms_return: 90, internal_notes: "comparaison" }),
    }).then((r) => r.json());
    const nouveauApres = await w.eval(`window.LCAdmin.api("/api/admin/reservations/${id}", { method: "PATCH", body: { kms_depart: 10, kms_return: 90, internal_notes: "comparaison" } })`);
    check("PATCH dossier — même forme", comparer(ancienApres.reservation, nouveauApres.reservation).ok,
      JSON.stringify(comparer(ancienApres.reservation, nouveauApres.reservation).manquants.slice(0, 5)));
    check("PATCH dossier — km identique", ancienApres.reservation.kmDone === nouveauApres.reservation.kmDone, `${ancienApres.reservation.kmDone} vs ${nouveauApres.reservation.kmDone}`);

    /* Lien de signature : la route se distinguait mal de « enregistrer une
       signature » et plantait sur un corps vide. On vérifie le lien ET qu'il
       s'ouvre vraiment, sans aucun en-tête — c'est ainsi que le client y
       accède, et la fonction refusait jusqu'ici ce cas. */
    const lien = await w.eval(`window.LCAdmin.api("/api/admin/reservations/${id}/signature/link", { method: "POST" })`);
    check("lien de signature créé", !!(lien && lien.token && lien.url), JSON.stringify(lien).slice(0, 90));
    if (lien && lien.url) {
      const page = await fetch(lien.url);
      const textePage = await page.text();
      check("page de signature accessible au client", page.status === 200 && textePage.includes("Signature du contrat"),
        `HTTP ${page.status}, ${textePage.length} caractères`);
      const forged = await fetch(lien.url.replace(lien.token, "a".repeat(24)));
      check("jeton inventé refusé", forged.status === 404, `HTTP ${forged.status}`);
    }

    /* Contrat et facture : l'écran demande le document, l'adaptateur l'ouvre
       dans un onglet. La fabrication du document, elle, est déjà couverte par
       la suite des Edge Functions ; ici on vérifie que la ROUTE répond — c'est
       elle qui manquait, l'écran ouvrant une adresse /api/… inexistante. */
    let ouverture = "";
    w.open = () => ({ document: { open() {}, write: (h) => { ouverture = h; }, close() {} } });
    for (const kind of ["contract", "invoice"]) {
      let ok = false;
      let motif = "";
      try {
        const r = await w.eval(`window.LCAdmin.api("/api/admin/reservations/${id}/${kind}")`);
        ok = !!(r && r.ok) || ouverture.length > 1000;
      } catch (e) {
        /* Un dossier incomplet refuse le document : c'est un refus métier,
           pas une route absente. Ce qui compte ici est que la route réponde. */
        ok = !/Route inconnue/.test(e.message);
        motif = e.message;
      }
      check(`route ${kind} reconnue`, ok, motif || (ouverture ? `${ouverture.length} caractères` : ""));
      ouverture = "";
    }

    /* Création d'un véhicule par l'écran d'édition, avec un corps objet : c'est
       exactement ce que fait admin.js. Le test passa par l'API du serveur, il
       ne verrait donc jamais une régression de l'adaptateur sur cette route —
       celle qui a produit « [object Object] is not valid JSON » à l'écran. */
    const fiche = { name: `Saisie ${Date.now()}`, price_from: 750, deposit: 5000, transmission: "Automatique", gallery: [] };
    const ficheServeur = await fetch(`${B}/api/admin/vehicles`, {
      method: "POST", headers: { cookie: cookieServeur, "Content-Type": "application/json" },
      body: JSON.stringify(fiche),
    }).then((r) => r.json());
    /* Même nom des deux côtés : on libère d'abord le slug pris par le
       serveur, puis on rejoue la création à l'identique via l'adaptateur. */
    await fetch(`${B}/api/admin/vehicles/${ficheServeur.vehicle.slug}`, { method: "DELETE", headers: { cookie: cookieServeur } });
    const ficheAdaptateur = await w.eval(
      `window.LCAdmin.api("/api/admin/vehicles", { method: "POST", body: ${JSON.stringify(fiche)} })`,
    );
    check("création véhicule — corps objet accepté", !!ficheAdaptateur.vehicle, JSON.stringify(ficheAdaptateur).slice(0, 120));
    check("création véhicule — mêmes champs", comparer(ficheServeur.vehicle, ficheAdaptateur.vehicle).ok,
      JSON.stringify(comparer(ficheServeur.vehicle, ficheAdaptateur.vehicle).enTrop.slice(0, 5)));

    /* Un véhicule sans photo ne doit produire ni « undefined » ni image cassée. */
    check("création véhicule — galerie vide acceptée",
      Array.isArray(ficheAdaptateur.vehicle.gallery) && ficheAdaptateur.vehicle.gallery.length === 0,
      JSON.stringify(ficheAdaptateur.vehicle.gallery));

    /* Un doublon doit produire une phrase lisible, pas un message technique de
       PostgreSQL — ni, surtout, une erreur qui masque la cause réelle. Ce test
       doit donc précéder la suppression. */
    let doublon = "";
    try {
      await w.eval(`window.LCAdmin.api("/api/admin/vehicles", { method: "POST", body: ${JSON.stringify(fiche)} })`);
    } catch (e) {
      doublon = e.message;
    }
    check("doublon — message lisible", /déjà ce nom/.test(doublon), doublon || "aucune erreur levée");
    check("doublon — pas de détail technique", !/row-level security|duplicate key|PGRST/i.test(doublon), doublon);

    await w.eval(`window.LCAdmin.api("/api/admin/vehicles/${ficheAdaptateur.vehicle.slug}", { method: "DELETE" })`).catch(() => {});
    await fetch(`${B}/api/admin/vehicles/${ficheServeur.vehicle.slug}`, { method: "DELETE", headers: { cookie: cookieServeur } }).catch(() => {});

    await fetch(`${B}/api/admin/reservations/${id}`, { method: "DELETE", headers: { cookie: cookieServeur } });
  } else {
    check("dossier complet — comparé", false, JSON.stringify(creation).slice(0, 120));
  }
} catch (e) {
  check("erreur inattendue", false, e.message);
} finally {
  /* Nettoyage par préfixe plutôt que par variable : un test interrompu au
     milieu laisserait sinon une voiture « Saisie <date> » dans la base de
     l'agence, et les suites suivantes échoueraient sur un parc non vide. */
  const jeton = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" };
  if (clientTestId) {
    await w.eval(`window.LCAdmin.api("/api/admin/clients/${clientTestId}", { method: "DELETE" })`).catch(() => {});
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/clients?id=eq.${clientTestId}`, { method: "DELETE", headers: jeton }).catch(() => {});
    }
  }
  if (nomPieceTest) {
    await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/uploads/uploads/reservations/${encodeURIComponent(nomPieceTest)}`,
      { method: "DELETE", headers: jeton },
    ).catch(() => {});
  }
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/vehicles?slug=like.saisie-*`, { method: "DELETE", headers: jeton }).catch(() => {});
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/vehicles?slug=like.adaptateur-*`, { method: "DELETE", headers: jeton }).catch(() => {});
  if (voitureCreee) {
    await fetch(`${B}/api/admin/vehicles/${voitureCreee}`, { method: "DELETE", headers: { cookie: cookieServeur } }).catch(() => {});
  }
  await deleteUser(VIEUX).catch(() => {});
  console.log(`\n${pass} reussis, ${fail} echecs`);
  await closeDb();
}
