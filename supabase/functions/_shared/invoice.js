import { COMPANY, logoSvg } from "./company.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nf = (n) => (Number(n || 0)).toLocaleString("fr-FR");
const fmtDate = (iso, withTime) => {
  if (!iso) return "";
  const dt = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(dt)) return esc(iso);
  const base = dt.toLocaleDateString("fr-FR");
  return withTime && String(iso).length > 10 ? `${base} ${String(iso).slice(11, 16)}` : base;
};
const line = (label, value) =>
  `<div class="fv-line"><span>${label}</span><b>${value ? esc(value) : ""}</b></div>`;
const val = (v) => (v ? esc(v) : "");

const PAY_LABEL = { especes: "Espèces", cb: "Carte bancaire", virement: "Virement", cheque: "Chèque" };

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"DejaVu Sans",Arial,Helvetica,sans-serif;color:#111;background:#3a3a40;
  font-size:9.4pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* --- écran : vraie feuille A4 centrée --- */
@media screen{
  body{padding:0 0 24px}
  .fv-page{width:210mm;min-height:296mm;margin:12mm auto;background:#fff;
    padding:12mm 10mm 10mm;box-shadow:0 2px 14px rgba(0,0,0,.55);position:relative}
  .fv-page::before{content:"Facture " attr(data-n);position:absolute;top:3mm;right:5mm;
    font:600 7pt system-ui,Arial,sans-serif;color:#bbb;letter-spacing:.08em;text-transform:uppercase}
}
@media print{
  body{background:#fff}
  .fv-page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
  .fv-page::before{display:none}
  .fv-box,.fv-table,.fv-pay,.fv-sign,.fv-stop{break-inside:avoid;page-break-inside:avoid}
}
.fv-bar{position:sticky;top:0;z-index:9;display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  max-width:210mm;margin:12mm auto -12mm;padding:10px 12px;background:#22242c;border-radius:8px}
.fv-bar button{background:#fff;color:#111;border:0;border-radius:6px;padding:7px 13px;
  font:600 13px system-ui,Arial,sans-serif;cursor:pointer}
.fv-bar a{color:#9ad;text-decoration:underline;font:12px system-ui,Arial,sans-serif}
.fv-bar .fv-hint{flex:1;min-width:260px;font-size:12px;line-height:1.35;color:#c9c9d2}
@media print{ .fv-bar{display:none!important} }

.fv-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:7px}
.fv-head__left{flex:1}
.fv-head__mid{text-align:center;width:150px}
.fv-head__right{flex:1;text-align:right;font-size:8pt;line-height:1.5}
.ct-logo{display:block;position:relative;width:140px;height:105px;overflow:hidden;margin:0 auto 2px}
.ct-logo img{display:block}
.fv-title{font-weight:700;font-size:14pt;letter-spacing:.06em}
.fv-number{margin-top:3px;border:1.5px solid #111;border-radius:3px;padding:6px 10px;
  font-weight:700;font-size:12pt;letter-spacing:.12em;display:inline-block;min-width:190px;text-align:center}
.fv-meta{font-size:8pt;line-height:1.5}

.fv-box{border:1px solid #111}
.fv-box__title{background:#e9e9e9;text-align:center;font-weight:700;padding:3px 8px;border-bottom:1px solid #111}
.fv-line{display:flex;gap:6px;padding:1.5px 8px;border-bottom:1px dotted #bbb}
.fv-line:last-child{border-bottom:0}
.fv-line span{flex:0 0 46%;color:#333}
.fv-line b{flex:1;font-weight:600}
.fv-row{display:grid;gap:6px;margin:6px 0}
.fv-row--2{grid-template-columns:1fr 1fr}

.fv-title2{font-weight:700;font-size:10.5pt;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.04em}
.fv-table{border:1px solid #111;border-collapse:collapse;width:100%}
.fv-table th,.fv-table td{border:1px solid #111;padding:4px 8px;font-size:9pt;text-align:left;vertical-align:top}
.fv-table th{background:#e9e9e9;font-weight:700}
.fv-table td.num,.fv-table th.num{text-align:right;white-space:nowrap}
.fv-table tfoot td{font-weight:700;background:#f6f6f6}
.fv-table .sub{color:#555;font-size:8pt}

.fv-stop{display:flex;gap:8px;justify-content:space-between;align-items:center;border:1px solid #111;
  padding:6px 10px;margin:8px 0;font-size:9pt}
.fv-stop b{font-weight:700}

.fv-pay{border:1px solid #111;border-collapse:collapse;width:100%;margin-top:4px}
.fv-pay th,.fv-pay td{border:1px solid #111;padding:4px 8px;font-size:9pt;text-align:left}
.fv-pay th{background:#e9e9e9}
.fv-pay td.num,.fv-pay th.num{text-align:right;white-space:nowrap}
.fv-tot{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
.fv-tot div{border:1px solid #111;padding:4px 10px;min-width:200px;display:flex;justify-content:space-between;gap:10px}
.fv-tot div.strong{font-weight:700;background:#f6f6f6}

.fv-sign{display:flex;gap:24px;margin-top:22px}
.fv-sign>div{flex:1;font-size:9pt}
.fv-sign .line{margin-top:34px;border-top:1px solid #111}
.fv-stamp{margin-top:16px;border:1.5px dashed #999;color:#777;padding:8px 10px;width:250px;
  font-size:8.5pt;line-height:1.45;border-radius:2px}
.fv-foot{margin-top:14px;border-top:1.5px solid #111;padding-top:5px;text-align:center;
  font-size:8.5pt;font-weight:700}
`;

function head(r) {
  return `<header class="fv-head">
    <div class="fv-head__left">
      <div class="fv-title">FACTURE</div>
      <div class="fv-number">${esc(r.invoiceNumber)}</div>
      <div class="fv-meta" style="margin-top:6px">
        <div>Date : <b>${fmtDate(new Date().toISOString())}</b></div>
        <div>Référence dossier : <b>${esc(r.ref)}</b></div>
        ${r.contract_number ? `<div>Contrat n° : <b>${esc(r.contract_number)}</b></div>` : ""}
      </div>
    </div>
    <div class="fv-head__mid">
      ${logoSvg(105, 140)}
    </div>
    <div class="fv-head__right">
      <div>Leegend Cars</div>
      <div>10 Rue Ouarzazat Hassan, Rabat 90000</div>
      <div>Tél: ${esc(company.phone)}</div>
      <div>Email: ${esc(company.email)}</div>
    </div>
  </header>`;
}

function document_(r, vehicle) {
  const client = `${r.first_name || ""} ${r.last_name || ""}`.trim();

  const detailRows = [
    `<tr>
      <td>Location de véhicule — ${esc(vehicle?.name || r.vehicle_name || "")}
        <div class="sub">${val(vehicle?.matricule ? `Immatriculation : ${vehicle.matricule}` : "")}</div>
      </td>
      <td class="num">${nf(r.days || 0)}</td>
      <td class="num">${nf(r.daily || 0)}</td>
      <td class="num">${nf(r.total || 0)}</td>
    </tr>`,
    r.extra_fee
      ? `<tr>
          <td>Frais divers${r.extra_fee_label ? ` — ${esc(r.extra_fee_label)}` : ""}</td>
          <td class="num">1</td><td class="num">${nf(r.extra_fee)}</td><td class="num">${nf(r.extra_fee)}</td>
        </tr>`
      : "",
    `<tr>
      <td colspan="3" style="text-align:right"><b>Total TTC</b></td>
      <td class="num"><b>${nf(r.totalTTC)} dh</b></td>
    </tr>`,
  ].join("");

  const payments = (r.payments || []).map(
    (p) => `<tr>
      <td>${fmtDate(p.paid_at)}</td>
      <td>${esc(PAY_LABEL[p.method] || p.method)}</td>
      <td>${val(p.note)}</td>
      <td class="num">${nf(p.amount)} dh</td>
    </tr>`
  );
  const payTable = payments.length
    ? `<table class="fv-pay">
        <thead><tr><th>Date</th><th>Mode</th><th>Observation</th><th class="num">Montant</th></tr></thead>
        <tbody>${payments}</tbody>
       </table>`
    : `<div class="fv-box" style="padding:6px 8px">Aucun règlement enregistré pour cette facture.</div>`;

  return `<section class="fv-page" data-n="${esc(r.invoiceNumber)}">
    ${head(r)}

    <div class="fv-row fv-row--2">
      <div class="fv-box">
        <div class="fv-box__title">FACTURÉ À</div>
        ${line("Nom et prénom :", client)}
        ${line("CIN N° :", r.d1_cin || r.passport)}
        ${line("Adresse :", r.d1_address)}
        ${line("Téléphone :", [r.country_code, r.phone].filter(Boolean).join(" "))}
      </div>
      <div class="fv-box">
        <div class="fv-box__title">LOCATION</div>
        ${line("Véhicule :", vehicle?.name || r.vehicle_name)}
        ${line("Immatriculation :", vehicle?.matricule)}
        ${line("Départ :", `${r.pickup || ""} — ${fmtDate(r.pickup_date, true)}`.trim())}
        ${line("Retour :", `${r.ret || ""} — ${fmtDate(r.return_date, true)}`.trim())}
        ${line("Durée :", r.days ? `${r.days} jour(s)` : "")}
      </div>
    </div>

    <div class="fv-title2">Détail de la facturation</div>
    <table class="fv-table">
      <thead>
        <tr><th>Désignation</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Montant</th></tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>

    <div class="fv-stop">
      <span>Arrêtée la présente facture à la somme de :</span>
      <b>${nf(r.totalTTC)} dh</b>
    </div>

    <div class="fv-title2">Règlements</div>
    ${payTable}
    <div class="fv-tot">
      <div><span>Total payé</span><b>${nf(r.totalPaid)} dh</b></div>
      <div class="strong"><span>${r.reste > 0 ? "Reste à payer" : "Trop-perçu"}</span><b>${nf(Math.abs(r.reste))} dh</b></div>
    </div>

    <div class="fv-sign">
      <div>Signature du client<div class="line"></div></div>
      <div>
        Cachet et signature — ${esc(company.legalName)}
        <div style="margin-top:4px">
          <img src="${company.stampImg}" alt="Cachet et signature" style="max-height:85px;max-width:240px;object-fit:contain;display:block">
        </div>
      </div>
    </div>

    <div class="fv-foot">ICE : ${esc(company.ice)} - RC : ${esc(company.rc)}</div>
  </section>`;
}

export function invoiceHtml(r, vehicle, company = COMPANY) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Facture ${esc(r.invoiceNumber)} — ${esc(vehicle?.name || r.vehicle_name || "")}</title>
<style>${CSS}</style>
<script src="/doc-assets/doc-print.js" defer></script>
</head>
<body>
  <div class="fv-bar">
    <button type="button" data-print onclick="window.print()">Enregistrer en PDF</button>
    <span class="fv-hint">Dans la fenêtre d'impression : <b>Destination « Enregistrer au format PDF »</b> ·
      <b>Format A4</b> · <b>Marges « Par défaut »</b> · <b>décochez « En-têtes et pieds de page »</b>.</span>
    <a href="/admin" target="_blank">Retour à l'admin</a>
  </div>
  ${document_(r, vehicle)}
</body></html>`;
}