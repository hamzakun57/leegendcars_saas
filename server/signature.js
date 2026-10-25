import { COMPANY } from "./company.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDateTime = (iso) => {
  if (!iso) return "";
  const dt = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(dt)) return esc(iso);
  return dt.toLocaleDateString("fr-FR") + (String(iso).length > 10 ? ` ${String(iso).slice(11, 16)}` : "");
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"DejaVu Sans",Arial,Helvetica,sans-serif;background:#f4f6f8;color:#15181d;
  font-size:15px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:#9ad}
.top{position:sticky;top:0;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap;
  padding:12px 16px;background:#fff;border-bottom:1px solid #e2e6ec}
.brand-logo-wrap{position:relative;display:block;width:88px;height:88px;overflow:hidden;flex:0 0 auto}
.brand-logo{position:absolute;left:-33.333%;top:-37.778%;width:166.667%;height:166.667%;max-width:none;object-fit:contain}
.top b{font-weight:700;letter-spacing:.04em}
.top .sep{color:#5b6270}
.top .grow{flex:1}
.btn{background:#fff;color:#111;border:0;border-radius:7px;padding:9px 15px;font:600 14px system-ui,Arial,sans-serif;
  cursor:pointer;text-decoration:none;display:inline-block}
.btn--ghost{background:#e2e6ec;color:#15181d;border:1px solid #ccd2db}
.btn:disabled{opacity:.5;cursor:not-allowed}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px 60px}
.card{background:#fff;border:1px solid #e2e6ec;border-radius:10px;padding:18px;margin-bottom:18px}
.card h1{font-size:19px;margin-bottom:4px}
.card h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#5a6069;margin-bottom:10px}
.welcome{background:#e8f8ef;border-left:7px solid #27bd78;color:#15181d}
.dates{background:#f4f5f6;color:#15181d;font-size:15px}
.dates p+p{margin-top:6px}
.muted{color:#5a6069;font-size:13.5px;line-height:1.5}
.recap{display:grid;grid-template-columns:1fr;gap:0;margin:12px 0 0;font-size:15px}
.recap div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #e2e6ec;padding:10px 2px}
.recap div:last-child{border:0}
.recap span{color:#15181d;font-weight:700}
.recap b{font-weight:600;text-align:right}
label{display:block;font-size:13px;color:#a2a9b8;margin:12px 0 4px}
input[type=text]{width:100%;background:#14161c;border:1px solid #3b4252;border-radius:8px;color:#fff;
  padding:11px 12px;font:15px "DejaVu Sans",Arial,sans-serif}
input[type=text]:focus{outline:2px solid #d8a01c;border-color:#d8a01c}
.pad{position:relative;margin-top:8px;border:2px dashed #aeb3b8;border-radius:10px;background:#fff;overflow:hidden}
.pad canvas{display:block;width:100%;height:200px;touch-action:none;cursor:crosshair}
.pad .hint{position:absolute;inset:0;display:grid;place-items:center;color:#707780;font-size:14px;
  pointer-events:none}
.pad .hint.gone{display:none}
.padrow{display:flex;gap:10px;margin-top:12px;align-items:center;flex-wrap:wrap}
.msg{margin-top:12px;font-size:13.5px;padding:10px 12px;border-radius:8px;display:none}
.msg.err{display:block;background:#3a1d22;color:#ffb4bd;border:1px solid #6b2b34}
.msg.ok{display:block;background:#e8f8ef;color:#14653d;border:1px solid #9ddbb9}
.download{background:#25b978;color:#fff}
.frame{background:#3a3a40;border-radius:12px;padding:14px;overflow:auto}
iframe{width:100%;height:1100px;border:0;background:#fff;border-radius:6px;display:block}
.foot{text-align:center;color:#6d7482;font-size:12.5px;margin-top:26px}
.signed{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.signed img{background:#fff;border-radius:8px;padding:6px 10px;max-width:280px;max-height:80px;object-fit:contain}
@media (max-width:640px){
  .pad canvas{height:170px}
}
`;

/* ------------------------------------------------------------------ page */
export function signPageHtml(r, token) {
  const client = `${r.first_name || ""} ${r.last_name || ""}`.trim();
  const signed = !!r.signatureData;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signature du contrat ${esc(r.contractNumber)} — ${esc(COMPANY.legalName)}</title>
<style>${CSS}</style>
<script src="/doc-assets/signature-pad.js" defer></script>
<script src="/doc-assets/sign-page.js" defer></script>
</head>
<body data-token="${esc(token)}" data-signed="${signed ? "1" : ""}">
  <div class="top">
    <span class="brand-logo-wrap"><img class="brand-logo" src="${esc(COMPANY.logo)}" alt="Logo Leegend Cars"></span>
    <b>${esc(COMPANY.legalName)}</b>
    <span class="sep">·</span>
    <span>Contrat n° ${esc(r.contractNumber)}</span>
    <span class="grow"></span>
    ${signed ? '<button type="button" class="btn" data-print-iframe>Télécharger le contrat signé (PDF)</button>' : ""}
  </div>

  <div class="wrap">
    <div class="card welcome">
      <h1>Bonjour ${esc(client || "")},</h1>
      <p class="muted">${
        signed
          ? "Votre signature est enregistrée. Le contrat signé est affiché ci-dessous."
          : `Merci de faire confiance à ${esc(COMPANY.legalName)}. Veuillez signer le contrat ci-dessous pour confirmer votre réservation n° ${esc(r.contractNumber)}.`
      }</p>
      <div class="recap">
        <div><span>Véhicule</span><b>${esc(r.vehicle_name)}</b></div>
        <div><span>Montant total</span><b>${esc(Number(r.totalTTC || 0).toLocaleString("fr-FR"))} dh</b></div>
        <div><span>Assurance</span><b>${esc(r.insurance || "Normale")}</b></div>
        <div><span>Livraison</span><b>${esc(r.pickup)}</b></div>
        <div><span>Récupération</span><b>${esc(r.ret)}</b></div>
      </div>
    </div>

    <div class="card dates">
      <p><b>Départ :</b> ${esc(fmtDateTime(r.pickup_date))}${r.pickup_time ? ` à ${esc(r.pickup_time)}` : ""}</p>
      <p><b>Retour :</b> ${esc(fmtDateTime(r.return_date))}${r.return_time ? ` à ${esc(r.return_time)}` : ""}</p>
    </div>

    <div class="card">
      <h2>Votre signature</h2>
      ${
        signed
          ? `<div class="signed">
              <img src="${esc(r.signatureData)}" alt="Votre signature">
              <div>
                <div><b>Signé le ${esc(fmtDateTime(r.signatureSignedAt))}</b></div>
                <div class="muted">${esc(r.signatureName || client)}${
                  r.signatureMode === "remote" ? " — signature électronique" : ""
                }</div>
              </div>
            </div>`
          : `<div class="pad">
          <canvas id="sig-pad"></canvas>
          <div class="hint" id="sig-hint">Dessinez votre signature ci-dessus</div>
        </div>
        <p class="muted">Les informations de la réservation ne sont pas modifiables.</p>
        <div class="padrow">
          <button type="button" class="btn btn--ghost" id="sig-clear">Effacer</button>
          <button type="button" class="btn" id="sig-save">Enregistrer ma signature</button>
        </div>
        <div class="msg" id="sig-msg"></div>`
      }
    </div>

    <h2 style="color:#5a6069;font-size:13px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px">
      Contrat complet</h2>
    <div class="frame">
      <iframe id="doc" src="/sign/${esc(token)}/contrat" title="Contrat de location"></iframe>
    </div>

    <p class="foot">${esc(COMPANY.legalName)} · Tél ${esc(COMPANY.phone)} · ${esc(COMPANY.email)}<br>
      Lien personnel, ne le transférez pas.</p>
  </div>
</body></html>`;
}