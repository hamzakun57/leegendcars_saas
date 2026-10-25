/**
 * Signature à distance : la page que le client ouvre depuis son téléphone.
 *
 * C'est la seule fonction accessible sans être administrateur — le client
 * n'a pas de compte. L'accès repose donc entièrement sur le jeton du lien :
 * 24 octets aléatoires, impossibles à deviner, transmis dans l'URL.
 *
 * Cette fonction ne renvoie QUE les champs utiles à l'affichage (le nom du
 * conducteur, le véhicule, le numéro de contrat). Le CIN, le passeport, les
 * règlements et les notes internes ne quittent jamais le serveur.
 */
import { corps, ErreurHttp, gerer, html, json } from "../_shared/http.ts";
import { clientService } from "../_shared/auth.ts";
import { chargerDossier } from "../_shared/dossier.ts";
import { contractHtml } from "../_shared/contract.js";
import { companyForAgency } from "../_shared/tenant.ts";

const FORME_JETON = /^[\w-]{20,64}$/;

async function parToken(client: any, token: string) {
  if (!FORME_JETON.test(token || "")) return null;
  const { data } = await client.from("reservations").select("*").eq("signature_token", token).maybeSingle();
  return data || null;
}

/* La passerelle Supabase vérifie le jeton de la requête avant même d'appeler la
   fonction. Le client n'a pas de compte : on lui fait donc porter la clé
   publique « anon », qui n'accorde aucun droit — c'est le jeton du lien de
   signature qui ouvre l'accès aux données, et il est vérifié ici. */
const clePublique = () => Deno.env.get("SUPABASE_ANON_KEY") || "";

Deno.serve((requete) =>
  gerer(requete, async () => {
    const client = clientService();
    const url = new URL(requete.url);
    const chemin = url.pathname.replace(/^\/+/, "");
    /* /signature/<token>[/page] — le déploiement ajoute ce préfixe. */
    const segments = chemin.split("/").filter(Boolean);
    const token = segments[1] || "";
    const action = segments[2] || "";

    /* La passerelle de Supabase sert tout ce qui ressemble à du HTML en
       « text/plain », avec une politique de sécurité qui vide la page : le
       client ne recevait que le code source. Cette fonction ne renvoie donc
       plus de HTML — elle renvoie du JSON, et c'est la page /signature.html
       du site qui l'affiche. Le HTML du contrat, lui, part dans un Blob. */
    if (requete.method === "GET" && (action === "" || action === "page")) {
      const r = await parToken(client, token);
      if (!r) throw new ErreurHttp(404, "Lien de signature introuvable ou expiré.");
      if (["confirmee", "livree"].indexOf(r.status) < 0) {
        throw new ErreurHttp(410, "Ce contrat n'est plus ouvert à la signature.");
      }

      const { data: vehicule } = r.vehicle_slug
        ? await client.from("vehicles").select("*").eq("slug", r.vehicle_slug).maybeSingle()
        : { data: null };
      const company = await companyForAgency(client, r.agency_id);

      return json({
        ok: true,
        token,
        cle: clePublique(),
        dossier: {
          ref: r.ref,
          brand: company.legalName,
          contractNumber: r.contract_number || r.ref,
          driver: [r.first_name, r.last_name].filter(Boolean).join(" "),
          vehicle: vehicule ? [vehicule.name, vehicule.matricule].filter(Boolean).join(" · ") : r.vehicle_slug || "",
          total: new Intl.NumberFormat("fr-FR").format(Number(r.total || 0) + Number(r.extra_fee || 0)),
          insurance: r.insurance || "Normale",
          pickup: r.pickup || "",
          retour: r.ret || "",
          pickupDate: r.pickup_date || "",
          pickupTime: r.pickup_time || "",
          returnDate: r.return_date || "",
          returnTime: r.return_time || "",
        },
        logo: company.logo,
        signed: !!r.signature_data,
        signatureSignedAt: r.signature_signed_at || "",
      });
    }

    if (requete.method === "GET" && action === "contrat") {
      const r = await parToken(client, token);
      if (!r) throw new ErreurHttp(404, "Lien de signature introuvable ou expiré.");
      const dossier = await chargerDossier(client, r.id);
      if (!dossier) throw new ErreurHttp(404, "Réservation introuvable.");
      const company = await companyForAgency(client, r.agency_id);
      const { data: vehicule } = r.vehicle_slug
        ? await client.from("vehicles").select("*").eq("slug", r.vehicle_slug).maybeSingle()
        : { data: null };
      return json({ ok: true, html: contractHtml({ ...dossier, dossierOpen: true }, vehicule, { toolbar: false, company }) });
    }

    if (requete.method === "POST") {
      const data = await corps(requete);
      const r = await parToken(client, token);
      if (!r) throw new ErreurHttp(404, "Lien de signature introuvable ou expiré.");
      if (["confirmee", "livree"].indexOf(r.status) < 0) {
        throw new ErreurHttp(410, "Ce contrat n'est plus ouvert à la signature.");
      }

      if (r.signature_data) throw new ErreurHttp(409, "Ce contrat a déjà été signé.");
      const nom = [r.first_name, r.last_name].filter(Boolean).join(" ").trim().slice(0, 120);
      if (nom.length < 3) throw new ErreurHttp(400, "Le nom du conducteur est manquant sur la réservation.");
      const signature = String(data.signature || "");
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 2_000_000) {
        throw new ErreurHttp(400, "Signature invalide.");
      }

      /* Le jeton est conservé : le client peut relire son contrat signé. */
      const { error } = await client
        .from("reservations")
        .update({
          signature_data: signature,
          signature_name: nom,
          signature_mode: "remote",
          signature_signed_at: new Date().toISOString(),
          signature_status: "signed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      if (error) throw error;

      return json({ ok: true });
    }

    throw new ErreurHttp(404, "Adresse inconnue.");
  })
);

const e = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

/* Page de signature : le minimal nécessaire, servie depuis la fonction pour
   que le client n'ait rien à installer. */
function pageSignature(r: any, vehicule: any, token: string, cleAnon: string): string {
  const veh = vehicule || { name: r.vehicle_name || "Véhicule" };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Signature du contrat ${e(r.contract_number || r.ref)}</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f6f8;color:#15181d}
  .page{max-width:620px;margin:0 auto;padding:24px 18px 60px}
  header{display:flex;align-items:center;gap:12px;margin-bottom:22px}
  .mark{width:42px;height:42px;border-radius:12px;background:#c8331f;color:#fff;display:grid;place-items:center;font-weight:900}
  h1{font-size:1.35rem;margin:0}
  .sub{color:#5a6069;margin:2px 0 0;font-size:.95rem}
  .card{background:#fff;border:1px solid #e2e6ec;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 12px 30px -22px #0a0b0e66}
  .kv{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px dashed #e2e6ec;font-size:.95rem}
  .kv:last-child{border:0}
  .kv span{color:#5a6069}
  .kv b{text-align:right}
  label{display:block;font-weight:600;margin:14px 0 6px;font-size:.95rem}
  input{width:100%;padding:12px 14px;border:1px solid #ccd2db;border-radius:10px;font-size:1rem}
  canvas{width:100%;height:170px;border:1px dashed #ccd2db;border-radius:12px;background:#fff;touch-action:none;display:block}
  .hint{color:#8b9199;font-size:.85rem;margin-top:6px}
  button{width:100%;margin-top:20px;padding:15px;border:0;border-radius:12px;background:#c8331f;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}
  button:disabled{background:#c9ced6;cursor:default}
  .msg{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:.95rem}
  .msg.err{background:#ff443822;border:1px solid #e2403499;color:#9d1d13}
  .msg.ok{background:#2fd07a26;border:1px solid #1cb0658c;color:#045f37}
  a.back{display:inline-block;margin-top:12px;color:#c8331f;font-size:.9rem}
</style></head><body><div class="page">
  <header>
    <div class="mark">LC</div>
    <div><h1>Signature du contrat</h1>
    <p class="sub">Contrat ${e(r.contract_number || r.ref)} · ${e(veh.name)}</p></div>
  </header>

  <div class="card">
    <div class="kv"><span>Conducteur</span><b>${e(r.first_name)} ${e(r.last_name)}</b></div>
    <div class="kv"><span>Permis</span><b>${e(r.licence_number)}</b></div>
    <div class="kv"><span>Prise en charge</span><b>${e(r.pickup)} · ${e(r.pickup_date)}</b></div>
    <div class="kv"><span>Retour</span><b>${e(r.ret)} · ${e(r.return_date)}</b></div>
    <a class="back" href="./${token}/contrat" target="_blank" rel="noopener">Relire le contrat complet</a>
  </div>

  <div class="card">
    <label for="nom">Votre nom complet</label>
    <input id="nom" placeholder="Ex : Hamza Kaissouni" autocomplete="name">
    <label for="pad">Votre signature</label>
    <canvas id="pad"></canvas>
    <p class="hint">Signez avec le doigt ou la souris. Le cadre est votre signature numérique.</p>
    <button id="envoyer" disabled>Envoyer ma signature</button>
    <div id="msg"></div>
  </div>
</div>
<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var CLE_ANON = ${JSON.stringify(cleAnon)};
  var pad = document.getElementById("pad"), ctx = pad.getContext("2d");
  var msg = document.getElementById("msg"), btn = document.getElementById("envoyer");
  var dessine = false;

  function ajuste() {
    var r = pad.getBoundingClientRect();
    var d = Math.max(window.devicePixelRatio || 1, 1);
    var image = ctx.getImageData(0, 0, pad.width, pad.height);
    pad.width = r.width * d; pad.height = r.height * d;
    ctx.scale(d, d);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, r.width, r.height);
    ctx.strokeStyle = "#15181d"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (image.width) ctx.putImageData(image, 0, 0);
  }
  window.addEventListener("resize", ajuste);
  ajuste();

  function point(ev) {
    if (ev.touches && ev.touches[0]) return ev.touches[0];
    return ev;
  }
  function debut(ev) {
    ev.preventDefault();
    dessine = true;
    ctx.beginPath();
    const p = point(ev);
    ctx.moveTo(p.clientX - pad.getBoundingClientRect().left, p.clientY - pad.getBoundingClientRect().top);
  }
  function Trace(ev) {
    if (!dessine) return;
    ev.preventDefault();
    const p = point(ev);
    const r = pad.getBoundingClientRect();
    ctx.lineTo(p.clientX - r.left, p.clientY - r.top);
    ctx.stroke();
    btn.disabled = false;
  }
  function fin() { dessine = false; }
  pad.addEventListener("mousedown", debut);
  pad.addEventListener("mousemove", Trace);
  window.addEventListener("mouseup", fin);
  pad.addEventListener("touchstart", debut, { passive: false });
  pad.addEventListener("touchmove", Trace, { passive: false });
  pad.addEventListener("touchend", fin);

  btn.addEventListener("click", async function () {
    var nom = document.getElementById("nom").value.trim();
    if (!nom) { msg.textContent = "Indiquez votre nom complet."; msg.className = "msg err"; return; }
    btn.disabled = true;
    try {
      var r = await fetch(TOKEN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + CLE_ANON },
        body: JSON.stringify({ name: nom, signature: pad.toDataURL("image/png") })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || "Envoi refusé.");
      msg.textContent = "Merci, votre signature est enregistrée. Vous pouvez relire votre contrat.";
      msg.className = "msg ok";
      btn.textContent = "Signature envoyée";
    } catch (err) {
      msg.textContent = err.message || "Envoi impossible.";
      msg.className = "msg err";
      btn.disabled = false;
    }
  });
})();
</script></body></html>`.replace("TOKEN_PATH", JSON.stringify(cheminPost(token)));
}

function cheminPost(token: string): string {
  return `/signature/${token}`;
}
