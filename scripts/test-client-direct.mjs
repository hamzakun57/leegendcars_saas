/**
 * Vérifie que le site public lit et écrit dans Supabase en direct, sans
 * passer par le serveur Express — exactement comme le fera la version
 * déployée sur Netlify.
 *
 * Les fichiers réellement livrés sont chargés dans un navigateur simulé, puis
 * toute la scénario est exécuté à l'intérieur de cette fenêtre : c'est le
 * seul contexte fidèle à ce que fera un visiteur.
 */
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "  OK  " : "ECHEC"} ${n}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++; };
let testReservationLastName = "";

const SB = process.env.SUPABASE_URL.replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.TZ = "Pacific/Auckland";
const admin = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });

const dom = new JSDOM(readFileSync("index.html", "utf8"), {
  url: "https://leegendcars.netlify.app/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const w = dom.window;
w.fetch = globalThis.fetch;
w.console = console;

/* jsdom n'implémente pas ces API, et app.js s'en sert dès le premier rendu.
   Les providing ici permet de vérifier la page telle qu'un visiteur la
   charge — y compris son premier rendu. */
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.requestAnimationFrame = (f) => setTimeout(f, 0);
w.cancelAnimationFrame = (id) => clearTimeout(id);
w.scrollTo = () => {};
w.Element.prototype.scrollIntoView = () => {};
w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
class IntersectionObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
w.IntersectionObserver = IntersectionObserver;

/* Véhicules de travail pour vérifier aussi le tri public par ordre d'affichage. */
const VEHICULE = "essai-client-direct";
const VEHICULE_ORDRE = ["essai-client-direct-ordre-a", "essai-client-direct-ordre-b", "essai-client-direct-ordre-c"];
const maintenant = new Date().toISOString();
for (const slug of [VEHICULE, ...VEHICULE_ORDRE]) await admin(`vehicles?slug=eq.${slug}`, { method: "DELETE" });
for (const [slug, name, sort_order] of [
  [VEHICULE, "Essai Direct", 0],
  [VEHICULE_ORDRE[0], "Essai Ordre A", 1],
  [VEHICULE_ORDRE[1], "Essai Ordre B", 2],
  [VEHICULE_ORDRE[2], "Essai Ordre C", 3],
]) {
  await admin("vehicles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      slug, name, tagline: "Automatique", transmission: "Automatique",
      fuel: "Essence", doors: 5, seats: 5, price_from: 500, deposit: 5000, approx: 50,
      tiers: [{ days: 7, price: 400 }], gallery: "[]", description: "[]", ideal_for: "[]",
      active: 1, en_service: 1, sort_order, created_at: maintenant, updated_at: maintenant,
    }),
  });
}

try {
  /* Les fichiers sont lus dans l'ordre EXACT où index.html les charge. La liste
     ci-dessous n'était qu'une recopie : elle a divergé du site réel, qui
     pointait depuis des semaines vers un chemin supprimé — et tous les tests
     passaient quand même, puisqu'ils ne passaient pas par index.html. */
  const html = readFileSync("index.html", "utf8");
  const references = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  check("index.html déclare des scripts", references.length > 0, references.join(", "));

  for (const ref of references) {
    check(`« ${ref} » existe`, existsSync(ref));
  }

  for (const f of references) {
    if (!existsSync(f)) continue;
    try {
      w.eval(readFileSync(f, "utf8"));
    } catch (e) {
      check(`« ${f} » se charge sans erreur`, false, e.message);
    }
  }

  check("window.DATA exposé", !!w.DATA && !!w.DATA.CFG);
  check("client Supabase embarqueé", typeof w.supabase?.createClient === "function");
  check("LCData présent", !!w.LCData);
  check("mode « supabase » (aucun serveur requis)", w.LCData?.mode === "supabase", w.LCData?.mode);

  /* Aucune clé secrète ne doitFuivre dans un fichier servi au navigateur. */
  for (const f of ["assets/js/data.js", "assets/js/data-source.js", "index.html", "vendor/supabase.js"]) {
    check(`pas de clé service_role dans ${f}`, !readFileSync(f, "utf8").includes(KEY));
  }
  check("le bundle n'expose qu'un client public", !readFileSync("vendor/supabase.js", "utf8").includes("service_role"));

  /* Le scénario s'exécute dans la fenêtre : même contexte qu'un visiteur. */
  const resultat = await w.eval(`
    (async () => {
      const out = [];
      const note = (nom, ok, extra) => out.push({ nom, ok, extra: extra || "" });

      try {
        const flotte = await window.LCData.vehicles();
        note("lecture de la flotte", Array.isArray(flotte.vehicles), flotte.vehicles.length + " vehicule(s)");
        const positionsOrdre = ${JSON.stringify(VEHICULE_ORDRE)}.map((slug) => flotte.vehicles.findIndex((v) => v.slug === slug));
        const positionSansOrdre = flotte.vehicles.findIndex((v) => v.slug === "${VEHICULE}");
        note("ordre d'affichage respecte dans la flotte publique",
          positionsOrdre.every((position) => position >= 0) &&
            positionsOrdre[0] < positionsOrdre[1] && positionsOrdre[1] < positionsOrdre[2] &&
            positionsOrdre[2] < positionSansOrdre,
          [...positionsOrdre, positionSansOrdre].join(" < "));
        const rangsOrdre = ${JSON.stringify(VEHICULE_ORDRE)}.map(
          (slug) => flotte.vehicles.find((v) => v.slug === slug)?.sort_order
        );
        note("ordre numerique expose et croissant",
          rangsOrdre[0] === 1 && rangsOrdre[1] === 2 && rangsOrdre[2] === 3,
          rangsOrdre.join(" < "));
        /* Le véhicule de travail, et non le premier venu : la base est celle de
           l'agence, elle contient ses véhicules, aux prix que l'agence a
           choisis. Les montants attendus ci-dessous n'ont de sens qu'avec
           celui-ci (500 MAD, puis 400 à partir de sept jours). */
        const v = flotte.vehicles.find((x) => x.slug === "${VEHICULE}") || flotte.vehicles[0];
        note("vehicule de travail present", !!v && v.slug === "${VEHICULE}", v ? v.slug : "absent");
        note("forme publique (camelCase)", !!v && v.priceFrom !== undefined && Array.isArray(v.gallery) && Array.isArray(v.tiers));

        const p = await window.LCData.pricing({ vehicle: v.slug, from: "2026-11-02", to: "2026-11-09", babySeat: 0 });
        note("tarif sur 7 jours", p.days === 7 && p.total > 0, p.days + " j, " + p.total + " MAD");
        note("tarif dégressif applique", p.daily === 400, p.daily + " MAD/jour (au lieu de " + v.priceFrom + ")");

        const siege = await window.LCData.pricing({ vehicle: v.slug, from: "2026-11-02", to: "2026-11-09", babySeat: 2 });
        note("siege bebe facture", siege.total === p.total + 2 * p.days, siege.total + " MAD");

        const mauvais = await window.LCData.envoyerReservation({ firstName: "", lastName: "X" });
        note("formulaire incomplet refuse", mauvais.ok === false && mauvais.fields.includes("firstName"), (mauvais.fields || []).join(","));
      } catch (e) {
        note("erreur inattendue", false, e.message);
      }
      return out;
    })()
  `);

  for (const r of resultat) check(r.nom, r.ok, r.extra);

  let formClientReservation = null;
  const limiteRendu = Date.now() + 10000;
  while (!formClientReservation && Date.now() < limiteRendu) {
    if (!w.DATA.VEHICLES.some((vehicle) => vehicle.slug === VEHICULE)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    w.document.documentElement.lang = "en-US";
    w.location.hash = `#/vehicules/${VEHICULE}`;
    await new Promise((resolve) => setTimeout(resolve, 25));
    formClientReservation = w.document.querySelector("[data-rform]");
  }
  check("formulaire client de réservation affiché", !!formClientReservation);
  let ref = "";
  if (formClientReservation) {
    const saisie = {
      firstName: "Navigateur",
      lastName: `Formulaire${Date.now()}`,
      phone: "612345678",
      licenceNumber: "AB123456",
      licenceDate: "2015-04-01",
      pickup: "Tanger",
      ret: "Tanger",
      pickupDate: "2026-12-01",
      pickupTime: "10:00",
      returnDate: "2026-12-05",
      returnTime: "10:00",
      babySeat: "0",
      notes: "",
      botcheck: "",
    };
    testReservationLastName = saisie.lastName;
    for (const [name, value] of Object.entries(saisie)) {
      const input = formClientReservation.elements.namedItem(name);
      if (input) input.value = value;
    }
    const datesTransmises = ["licenceDate", "pickupDate", "returnDate"].map((name) =>
      formClientReservation.elements.namedItem(name).value
    );
    check("formulaire client transmet les dates ISO malgré la langue en-US",
      datesTransmises.join(",") === "2015-04-01,2026-12-01,2026-12-05",
      datesTransmises.join(", "));

    formClientReservation.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    const limiteEnvoi = Date.now() + 20000;
    while (!ref && Date.now() < limiteEnvoi) {
      try {
        ref = JSON.parse(w.sessionStorage.getItem("lc_reservation") || "{}").ref || "";
      } catch {}
      if (!ref) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const demande = JSON.parse(w.sessionStorage.getItem("lc_reservation") || "{}");
    check("création via le formulaire client avec les dates locales",
      !!ref && demande.licenceDate === "2015-04-01" &&
        demande.pickupDate === "2026-12-01" && demande.returnDate === "2026-12-05",
      ref || formClientReservation.querySelector("[data-form-alert]")?.textContent || "délai dépassé");
  }

  /* Ce que la base a réellement retenu, lu hors RLS avec la clé de service. */
  if (ref) {
    const r = await admin(`reservations?ref=eq.${ref}&select=*`);
    const [ligne] = await r.json();
    check("demande formulaire client bien enregistrée", !!ligne, ref);
    check("date du permis conservée sans décalage", ligne?.licence_date === "2015-04-01", ligne?.licence_date);
    check("dates de réservation conservées sans décalage",
      ligne?.pickup_date === "2026-12-01" && ligne?.return_date === "2026-12-05",
      `${ligne?.pickup_date} → ${ligne?.return_date}`);
    check("statut force a « nouvelle »", ligne?.status === "nouvelle", ligne?.status);
    check("total calcule (4 j x 500)", ligne?.total === 2000, String(ligne?.total));
    check("aucun encaissement invente", ligne?.total_paid === 0, String(ligne?.total_paid));
    check("aucun numero de contrat", !ligne?.contract_number, ligne?.contract_number);
    check("aucune signature", !ligne?.signature_data);
    check("resume lisible", String(ligne?.summary || "").includes("Navigateur Formulaire"));
    await admin(`reservations?ref=eq.${ref}`, { method: "DELETE" });
  }

  /* Et la preuve que le visiteur ne peut pas relire sa demande. */
  if (ref) {
    const anon = process.env.SUPABASE_ANON_KEY;
    const tentative = await fetch(`${SB}/rest/v1/reservations?ref=eq.${ref}`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const lu = await tentative.text();
    check("le visiteur ne peut pas relire sa demande", lu === "[]", lu.slice(0, 40));
  }
} catch (e) {
  check("erreur de test", false, e.message);
} finally {
  if (testReservationLastName) {
    await admin(`reservations?last_name=eq.${encodeURIComponent(testReservationLastName)}`, { method: "DELETE" });
  }
  for (const slug of [VEHICULE, ...VEHICULE_ORDRE]) await admin(`vehicles?slug=eq.${slug}`, { method: "DELETE" });
}

console.log(`\n${pass} reussis, ${fail} echecs`);