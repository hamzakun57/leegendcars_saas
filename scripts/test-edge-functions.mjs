/**
 * Teste les Edge Functions déployées, contre le vrai projet Supabase.
 * Rien n'est simulé : c'est la seule façon de savoir si une fonction démarre.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const SB = process.env.SUPABASE_URL.replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASS = process.env.ADMIN_PASS;
const BASE = `${SB}/functions/v1`;

let pass = 0, fail = 0;
const check = (nom, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "ECHEC"} ${nom}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

const admin = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });

if (!EMAIL || !PASS) {
  console.log("(ADMIN_EMAIL / ADMIN_PASS absents : test ignoré)");
  process.exit(0);
}

/* Un jeton d'administrateur, comme celui qu'enverra le back-office. */
const login = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const session = await login.json();
check("connexion administrateur", login.ok && !!session.access_token);
const JETON = session.access_token;

/* Une réservation confirmée, avec un véhicule : il en faut une pour tester
   le contrat et la facture. */
const VEHICULE = "essai-edge-" + Date.now().toString(36);
await admin("vehicles", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({
    slug: VEHICULE, name: "Essai Edge", tagline: "Automatique", transmission: "Automatique",
    fuel: "Essence", doors: 5, seats: 5, price_from: 500, deposit: 5000, tiers: JSON.stringify([{ days: 7, price: 400 }]),
    description: "[]", ideal_for: "[]", gallery: "[]", active: 1, en_service: 1, sort_order: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }),
});
/* PostgREST renvoie la ligne insérée quand on demande « return=representation » ;
   c'est plus fiable que de deviner un identifiant dans un en-tête. */
const creation = await admin("reservations", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    ref: "EDGE-" + Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
    first_name: "Edge", last_name: "Fonctions", phone: "+212600000000", licence_number: "ZZ1",
    licence_date: "2020-01-01", pickup: "Tanger", ret: "Tanger",
    pickup_date: "2026-11-02", return_date: "2026-11-09", vehicle_slug: VEHICULE,
    status: "nouvelle", days: 7, daily: 400, total: 2800, total_paid: 1000,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }),
}).then((x) => x.json());
const id = creation && creation[0] ? creation[0].id : null;
check("réservation de test créée", !!id, id ? "#" + id : JSON.stringify(creation).slice(0, 120));

/* Le déclencheur de durcissement force « nouvelle » à l'insertion : c'est
   exactement ce qu'on veut. On passe donc par le chemin normal de
   l'administration — créer puis confirmer. */
if (id) {
  await admin(`reservations?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "confirmee", confirmed_at: new Date().toISOString() }),
  });
  const statut = await admin(`reservations?id=eq.${id}&select=status`).then((x) => x.json());
  check("réservation confirmée par l'administration", statut[0].status === "confirmee", statut[0].status);
}

const appeler = (nom, chemin, options = {}) =>
  fetch(`${BASE}/${nom}${chemin || ""}`, {
    method: options.method || "POST",
    headers: { "Content-Type": "application/json", ...(options.jeton ? { Authorization: `Bearer ${options.jeton}` } : {}), ...(options.anon ? { Authorization: `Bearer ${options.anon}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

try {
  console.log("\n— contrôle d'accès —");
  check("upload sans jeton refusé", (await appeler("upload", "", { body: {} })).status === 401);
  check("document sans jeton refusé", (await appeler("document", "", { body: { id } })).status === 401);

  const faux = await appeler("document", "", { body: { id }, jeton: "eyJhbGciOiJIUzI1NiJ9.e30.invalide" });
  check("document avec un jeton falsifié refusé", faux.status === 401 || faux.status === 403, "HTTP " + faux.status);

  const clientAnon = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `inexistant-${Date.now()}@test.local`, password: "faux" }),
  });
  check("session inexistante : refusée", !clientAnon.ok);

  console.log("\n— contrat et facture —");
  const contrat = await appeler("document", "", { body: { id, document: "contract" }, jeton: JETON });
  const htmlContrat = await contrat.text();
  check("contrat généré", contrat.status === 200 && htmlContrat.includes("Contrat"), `HTTP ${contrat.status}, ${htmlContrat.length} o`);
  check("contrat en HTML complet", htmlContrat.trimStart().startsWith("<!doctype") || htmlContrat.includes("<html"));
  check("en-tête du contrat au nom de Leegend Cars", htmlContrat.includes("<div>Leegend Cars</div>") && !htmlContrat.includes("LUXE RIF CAR"));

  const facture = await appeler("document", "", { body: { id, document: "invoice" }, jeton: JETON });
  const htmlFacture = await facture.text();
  check("facture générée", facture.status === 200 && htmlFacture.includes("FACTURE"), `HTTP ${facture.status}, ${htmlFacture.length} o`);
  check("en-tête de la facture au nom de Leegend Cars", htmlFacture.includes("<div>Leegend Cars</div>") && !htmlFacture.includes("LUXE RIF CAR"));
  const numero = (htmlFacture.match(/F\d{4}-\d{4}/) || [])[0];
  check("numéro de facture attribué", !!numero, numero);

  const apres = await admin(`reservations?id=eq.${id}&select=ref,contract_number,invoice_number`).then((x) => x.json());
  check("numéros enregistrés en base",
    apres[0].contract_number === apres[0].ref && !!apres[0].invoice_number,
    `ref=${apres[0].ref} contrat=${apres[0].contract_number} facture=${apres[0].invoice_number}`);

  console.log("\n— signature à distance —");
  const jetonSignature = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  await admin(`reservations?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ signature_token: jetonSignature, signature_status: "pending" }),
  });

  check("jeton inexistant -> 404", (await appeler("signature", `/inconnu${"a".repeat(24)}`, { method: "GET", anon: ANON })).status === 404);
  const page = await appeler("signature", `/${jetonSignature}`, { method: "GET", anon: ANON });
  const htmlPage = await page.text();
  const pageData = JSON.parse(htmlPage);
  check("données de signature et logo Leegend Cars", page.status === 200 && pageData.ok && pageData.dossier.brand === "Leegend Cars" && pageData.logo.startsWith("data:image/"), `HTTP ${page.status}`);
  /* La page publique ne doit montrer que ce que le client doit signer : ni CIN,
     ni passe灭port, ni règlements, ni notes internes. Le permis, lui, y
     figure — c'est la pièce que le client signe. */
  const fuites = ["d1_cin", "total_paid", "internal_notes", "payments", "signature_data"].filter((c) => htmlPage.includes(c));
  check("la page ne fuit aucune donnée interne", fuites.length === 0, fuites.join(", "));

  const poste = await appeler("signature", `/${jetonSignature}`, {
    body: { name: "Nom modifié", signature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" },
    anon: ANON,
  });
  check("signature enregistrée", poste.status === 200, "HTTP " + poste.status);
  const signe = await admin(`reservations?id=eq.${id}&select=signature_status,signature_name,signature_mode`).then((x) => x.json());
  check("signature visible côté admin et nom protégé", signe[0].signature_status === "signed" && signe[0].signature_mode === "remote" && signe[0].signature_name === "Edge Fonctions",
    `${signe[0].signature_status} / ${signe[0].signature_name}`);
  const pageSignee = await appeler("signature", `/${jetonSignature}`, { method: "GET", anon: ANON }).then((x) => x.json());
  check("contrat signé disponible après enregistrement", pageSignee.ok && pageSignee.signed);
  const contratSigne = await appeler("signature", `/${jetonSignature}/contrat`, { method: "GET", anon: ANON }).then((x) => x.json());
  check("contrat rendu avec la signature enregistrée",
    !!contratSigne.html && contratSigne.html.includes('src="data:image/png;base64,') && contratSigne.html.includes('ct-signature--remote'));
  const contratDom = new JSDOM(contratSigne.html || "");
  const pagesContrat = contratDom.window.document.querySelectorAll(".ct-page");
  check("contrat signé sur deux pages avec signature en recto et verso",
    pagesContrat.length === 2 &&
      !!pagesContrat[0].querySelector(".ct-signature--remote") &&
      !!pagesContrat[1].querySelector(".ct-signature--remote") &&
      pagesContrat[1].querySelector(".ct-articles")?.nextElementSibling?.classList.contains("ct-signature"));

  console.log("\n— envoi de fichiers —");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const refuse = await appeler("upload", "", { body: { reservation_id: id, files: [PNG] }, jeton: JETON });
  check("une image est acceptée", refuse.status === 201 || refuse.status === 200, "HTTP " + refuse.status);
  const corpsReponse = await refuse.json().catch(() => ({}));
  check("la pièce est enregistrée", (corpsReponse.attachments || []).length === 1, JSON.stringify(corpsReponse).slice(0, 100));

  const idPiece = corpsReponse.attachments ? corpsReponse.attachments[0].id : null;
  check("pièce jointe créée", !!idPiece);
  /* Un fichier déjà envoyé n'empêche pas un second envoi : la fonction renvoie
     alors la liste des pièces avec un avertissement pour celui qui a été
     refusé — même comportement que le serveur. */
  const scriptDeguise = await appeler("upload", "", {
    body: { reservation_id: id, files: ["data:image/png;base64,PD9waHAgc3lzdGVtKCk7ID8+"] }, jeton: JETON,
  });
  const corpsDeguise = await scriptDeguise.json().catch(() => ({}));
  check("un script déguisé en image est refusé",
    (corpsDeguise.warnings || []).some((w) => /non supporté/i.test(w)),
    JSON.stringify(corpsDeguise).slice(0, 110));
  check("le fichier valide reste le seul enregistré",
    (corpsDeguise.attachments || []).length === 1,
    `${(corpsDeguise.attachments || []).length} pièce(s)`);

  if (corpsReponse.attachments) {
    const stockage = corpsReponse.attachments[0];
    /* La base ne retient que le nom du fichier. La clé de stockage porte le
       préfixe public, et l'API attend le bucket puis cette clé complète. */
    const cleObjet = `uploads/uploads/reservations/${stockage.stored_name.replace(/^.*\//, "")}`;
    const telecharge = await fetch(`${SB}/storage/v1/object/${cleObjet}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    check("fichier présent dans le bucket", telecharge.status === 200, `HTTP ${telecharge.status}`);

    const supprime = await appeler("upload", "", { body: { action: "delete", stored_name: stockage.stored_name }, jeton: JETON });
    const resultatSuppression = await supprime.json().catch(() => ({}));
    check("fichier supprimé", supprime.status === 200 && resultatSuppression.supprime === true, `HTTP ${supprime.status}`);
    /* On interroge la liste des objets, pas un GET : le CDN de Supabase peut
       encore servir une copie en cache quelques secondes après la suppression,
       alors que l'objet a réellement disparu. */
    const lister = async (prefixe) =>
      (await fetch(`${SB}/storage/v1/object/list/uploads`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: prefixe, limit: 100 }),
      }).then((x) => x.json())) || [];

    const restants = await lister("uploads/reservations");
    check("objet réellement retiré du bucket",
      !restants.some((o) => o.name === stockage.stored_name),
      `${restants.length} objet(s) encore dans le dossier`);
  }
} catch (e) {
  check("erreur inattendue", false, e.message);
} finally {
  if (id) await admin(`reservations?id=eq.${id}`, { method: "DELETE" });
  await admin(`vehicles?slug=eq.${VEHICULE}`, { method: "DELETE" });
  /* Les pièces du test disparaissent avec le dossier (cascade) ; le fichier
     associé, lui, est retiré explicitement plus haut. */
  console.log(`\n${pass} reussis, ${fail} echecs`);
}