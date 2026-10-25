(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const nf = new Intl.NumberFormat("fr-FR");
  const money = (n) => nf.format(Number(n || 0)) + " MAD";
  const dt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d)
      ? String(iso)
      : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
  const dts = (iso) => (iso ? dt(iso).slice(0, 5) : "");
  const dtTime = (iso) => (iso ? dt(iso) + " " + String(iso).slice(11, 16) : "");

  const STATUS = { nouvelle: "Nouvelle", confirmee: "Confirmée", annulee: "Annulée", livree: "Livrée" };

  let vehicles = [];

  /* ---------- accès aux données ----------
     Deux Mondays : l'API du serveur Express, ou Supabase en direct. L'écran
     appelle exactement les mêmes routes dans les deux cas — seul cet appel
     change. C'est ce qui garantit qu'aucun écran ne bouge. */
  const viaServeur = async (url, opts = {}) => {
    const res = await fetch(url, {
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      location.href = "/admin/login";
      throw new Error("non autorisé");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data;
  };

  const api = window.LCAdmin && window.LCAdmin.mode === "supabase"
    ? (url, opts = {}) =>
        window.LCAdmin.api(url, opts).catch((e) => {
          /* Session expirée ou absente : renvoi immédiat vers l'écran de connexion. */
          if (/session|token|authent|autoris/i.test(e.message || "")) {
            location.replace("/admin/login");
          }
          throw e;
        })
    : viaServeur;

  /* Le contrat et la facture s'ouvrent dans un onglet. Deux réalités :

   - avec le serveur (local), l'appel renvoie le HTML ou { __html } ;
   - sur Netlify, l'adaptateur (admin-api.js) appelle l'Edge Function et renvoie
     { __html: data, __type: "html" }.

   Pour éviter d'être bloqué par le bloqueur de pop-ups après un appel réseau,
   on ouvre la fenêtre immédiatement sur le clic utilisateur, puis on y injecte
   le Blob URL dès que la réponse arrive. */
  async function ouvrirDocument(url) {
    const win = window.open("", "_blank");
    if (win) {
      try {
        win.document.title = "Génération du document…";
        win.document.body.style.cssText = "margin:0;font:15px system-ui,sans-serif;background:#202228;color:#e0e2ec;display:grid;place-items:center;height:100vh";
        win.document.body.innerHTML = "<div>Génération du document en cours…</div>";
      } catch (e) {}
    }

    try {
      const res = await api(url);
      const htmlStr = (res && res.__html) ? res.__html
                    : (typeof res === "string" ? res : null);
      if (!htmlStr) {
        if (win) win.close();
        flash("Impossible d'ouvrir le document.", "err");
        return;
      }
      const blob = new Blob([htmlStr], { type: "text/html; charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      if (win) {
        win.location.href = blobUrl;
      } else {
        window.open(blobUrl, "_blank");
      }
    } catch (e) {
      if (win) win.close();
      flash(e.message || "Erreur lors de l'ouverture du document.", "err");
    }
  }

  const flash = (text, kind = "ok") => {
    $("#msg").innerHTML = `<div class="${kind}">${esc(text)}</div>`;
    setTimeout(() => ($("#msg").innerHTML = ""), 4000);
  };

  /* ---------- envoi de fichiers : allégé avant d'envoyer ----------
     Netlify limite chaque requête à 6 Mo, et le passage en base64 ajoute
     environ 30 %. Une photo de téléphone fait 4 à 8 Mo : refusée telle quelle.
     On la redimensionne donc dans le navigateur avant l'envoi — une photo de
     fiche véhicule n'a pas besoin de 4000 px, et 1600 px suffisent pour
     l'écran comme pour l'impression. */
  const TAILLE_MAX = 1600;
  const QUALITE = 0.82;
  /* Une capture d'écran en PNG reste lourde même réduite à 1600 px. La
     fonction refuse un lot de plus de 4 Mo : on repasse donc la photo dans un
     canvas plus petit / moins compressé tant qu'elle dépasse ce poids, sinon
     deux photos suffisent à faire refuser l'envoi entier. */
  const POIDS_PHOTO = 850 * 1024;

  /** data URL -> data URL réduite. Renvoie l'original si le navigateur refuse
      (pas de canvas, format exotique) : la limite serveur reste le filet. */
  async function reduire(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return dataUrl;
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const facteur = Math.min(1, TAILLE_MAX / Math.max(img.width, img.height));
      if (facteur === 1 && dataUrl.length < POIDS_PHOTO) return dataUrl; // déjà raisonnable

      let largeur = Math.round(img.width * facteur);
      let hauteur = Math.round(img.height * facteur);
      let qualite = QUALITE;
      let sortie = "";
      for (let essai = 0; essai < 4; essai++) {
        const canvas = document.createElement("canvas");
        canvas.width = largeur;
        canvas.height = hauteur;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        sortie = canvas.toDataURL("image/jpeg", qualite);
        if (sortie.length < POIDS_PHOTO) return sortie;
        qualite = Math.max(0.45, qualite - 0.15);
        largeur = Math.round(largeur * 0.8);
        hauteur = Math.round(hauteur * 0.8);
      }
      return sortie;
    } catch (e) {
      return dataUrl;
    }
  }

  const lireFichier = (fichier) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error(fichier.name));
      r.readAsDataURL(fichier);
    });

  /* ---------- tiroir : formulaires de saisie ---------- */
  /* Les formulaires longs (client, véhicule, réservation) s'ouvrent dans un
     panneau latéral plutôt qu'au-dessus de la page : la liste reste en place et
     le contexte n'est pas perdu. */
  const sheet = () => $("#sheet");

  function openSheet(title, subtitle, html) {
    const s = sheet();
    $("#sheet-title").textContent = title;
    $("#sheet-sub").textContent = subtitle || "";
    $("#sheet-body").innerHTML = html;
    $("#sheet-foot").hidden = true;
    $("#sheet-foot").innerHTML = "";
    s.hidden = false;
    s.setAttribute("aria-hidden", "false");
    const first = $("#sheet-body input, #sheet-body select, #sheet-body textarea");
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
    return $("#sheet-body");
  }

  function closeSheet() {
    const s = sheet();
    if (!s || s.hidden) return;
    s.hidden = true;
    s.setAttribute("aria-hidden", "true");
    $("#sheet-body").innerHTML = "";
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-sheet-close]")) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });

  /* ---------- tabs (menu latéral) ---------- */
  const SIDE_LABEL = { res: "Réservations", sta: "Statistiques", cli: "Clients", veh: "Flotte", avail: "Indisponibilités", mnt: "Maintenance", set: "Réglages", dos: "Dossier" };

  function showTab(name) {
    $$(".side [data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === name));
    $$("main > section").forEach((s) => s.classList.add("hide"));
    $("#tab-" + name).classList.remove("hide");
    $("#crumb").textContent = name === "dos" ? "Réservations › Dossier" : "";
    window.scrollTo({ top: 0 });
    if (name === "res") { loadStats(); loadReservations(); }
    if (name === "sta") loadStatsVehicles();
    if (name === "cli") loadClients();
    if (name === "veh") loadVehicles();
    if (name === "avail") loadVehicles().then(loadBlocked);
    if (name === "mnt") loadVehicles().then(loadMaintenance);
    if (name === "set" && !$("#agency-settings-panel").classList.contains("hide")) {
      loadAgencySettings();
    }
  }

  $$(".side [data-tab]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.dataset.tab === "res") { $("#msg").innerHTML = ""; }
      showTab(a.dataset.tab);
    })
  );

  $("#logout").addEventListener("click", async () => {
    try { await api("/api/admin/logout", { method: "POST" }); } catch (_) {}
    location.replace("/admin/login");
  });

  /* ---------- maintenance ---------- */
  let mntKinds = [];

  /* « tous les 6 mois » plutôt que « tous les 180 jours » : c'est le langage
     du garage, et 180 jours ne veut rien dire pour une vignette. */
  function mntCycle(jours) {
    if (!jours) return "—";
    if (jours % 365 === 0) return `tous les ${jours / 365} an${jours > 365 ? "s" : ""}`;
    if (jours % 180 === 0) return `tous les ${jours / 180} mois`;
    if (jours % 30 === 0) return `tous les ${jours / 30} mois`;
    return `tous les ${jours} j`;
  }

  const mntDans = (m) => {
    if (m.jours === null) return `<span class="faint">—</span>`;
    if (m.jours < 0) return `<span class="warn-txt">en retard de ${Math.abs(m.jours)} j</span>`;
    if (m.jours === 0) return `<span class="warn-txt">aujourd'hui</span>`;
    if (m.jours <= 30) return `<span class="warn-txt">dans ${m.jours} j</span>`;
    return `<span class="faint">dans ${m.jours} j</span>`;
  };

  async function loadMaintenance() {
    const qs = new URLSearchParams();
    if ($("#mnt-veh").value) qs.set("vehicle", $("#mnt-veh").value);
    if ($("#mnt-kind").value) qs.set("kind", $("#mnt-kind").value);

    let data;
    try {
      data = await api("/api/admin/maintenance?" + qs);
    } catch (e) {
      return flash(e.message, "err");
    }
    mntKinds = data.kinds;

    const kindsAvant = $("#mnt-kind").value;
    $("#mnt-kind").innerHTML =
      '<option value="">Tous les types</option>' +
      mntKinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join("");
    $("#mnt-kind").value = kindsAvant;

    $("#mnt-cards").innerHTML = [
      ["Suivis", nf.format(data.items.length), false],
      ["En retard", nf.format(data.compte.retard), true],
      ["Sous 30 jours", nf.format(data.compte.bientot), false],
      ["À jour", nf.format(data.compte.ok), false],
    ]
      .map(([l, v, a]) => `<div class="card ${a ? "accent" : ""}"><small>${l}</small><b>${v}</b></div>`)
      .join("");

    $("#mnt-rows").innerHTML = data.items
      .map(
        (m) => `<tr>
        <td><b>${esc(m.vehicle_name)}</b></td>
        <td>${esc(m.kind_label)}</td>
        <td>${m.due_date ? dt(m.due_date) : "—"}</td>
        <td>${mntDans(m)}</td>
        <td>${m.last_done_at ? dt(m.last_done_at) : '<span class="faint">jamais</span>'}</td>
        <td class="num">${m.last_cost ? money(m.last_cost) : "—"}</td>
        <td><span class="faint">${mntCycle(m.period_days)}</span></td>
        <td class="row" style="gap:6px;justify-content:flex-end">
          <button data-mnt-done="${m.id}">Fait</button>
          <button class="ghost" data-mnt-edit="${m.id}">Modifier</button>
          <button class="danger" data-mnt-del="${m.id}">Supprimer</button>
        </td>
      </tr>`
      )
      .join("");
    $("#mnt-empty").classList.toggle("hide", data.items.length > 0);
  }

  function mntForm(item = null) {
    const isNew = !item;
    const field = (label, id, value, type, extra = "") =>
      `<div><label>${label}</label><input id="${id}" type="${type || "text"}" value="${esc(value ?? "")}" ${extra}></div>`;
    const vehicule = item?.vehicle_slug || $("#mnt-veh").value || vehicles[0]?.slug || "";

    openSheet(
      isNew ? "Nouveau suivi" : item.kind_label,
      isNew ? "Vignette, assurance, vidange, révision…" : "Modifier l'échéance",
      `<div class="panel">
      <label>Véhicule</label>
      <select id="m-veh" ${isNew ? "" : "disabled"}>
        ${vehicles.map((v) => `<option value="${esc(v.slug)}" ${v.slug === vehicule ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
      </select>

      <label>Type d'opération</label>
      <select id="m-kind">
        ${mntKinds.map((k) => `<option value="${esc(k.id)}" ${k.id === (item?.kind || "") ? "selected" : ""}>${esc(k.label)}</option>`).join("")}
      </select>
      ${field("Type personnalisé (si absent de la liste)", "m-kindlib", item?.label, "text", 'placeholder="Ex : bretelle"')}

      <label>Échéance à ne pas dépasser</label>
      <input id="m-due" type="date" value="${esc(item?.due_date || "")}">

      <label>Cycle (se reprogramme tout seul quand vous cliquez sur « Fait »)</label>
      <div class="grid3">
        ${field("Tous les combien de jours (0 = pas de report)", "m-period", item?.period_days ?? 0, "number", 'min="0" max="3650"')}
        ${field("Kilométrage du dernier passage", "m-km", item?.last_km ?? 0, "number", 'min="0"')}
      </div>

      <label>Note (facultatif)</label>
      <textarea id="m-notes" rows="2">${esc(item?.notes || "")}</textarea>
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end">
      <button class="ghost" id="m-cancel">Annuler</button>
      <button class="primary" id="m-save">${isNew ? "Créer" : "Enregistrer"}</button>
    </div>`
    );

    $("#m-cancel").addEventListener("click", closeSheet);
    $("#m-save").addEventListener("click", async () => {
      const kindLib = $("#m-kindlib").value.trim();
      const payload = {
        vehicle_slug: $("#m-veh").value,
        kind: kindLib || $("#m-kind").value,
        due_date: $("#m-due").value,
        period_days: Number($("#m-period").value) || 0,
        last_km: Number($("#m-km").value) || 0,
        notes: $("#m-notes").value.trim(),
      };
      if (!payload.due_date) return flash("Indiquez la date d'échéance.", "err");
      try {
        if (isNew) await api("/api/admin/maintenance", { method: "POST", body: payload });
        else await api("/api/admin/maintenance/" + item.id, { method: "PATCH", body: payload });
        flash(isNew ? "Suivi ajouté." : "Suivi mis à jour.");
        closeSheet();
        loadMaintenance();
      } catch (e) {
        flash(e.message, "err");
      }
    });
  }

  /* « Fait » : on demande le coût et le kilométrage, le serveur date l'opération
     et reprogramme la prochaine échéance selon le cycle. */
  function mntDone(id) {
    const row = $("#mnt-rows").querySelector(`[data-mnt-done="${id}"]`)?.closest("tr");
    const nom = row?.querySelector("td")?.textContent || "";
    const field = (label, f) => `<div><label>${label}</label><input id="${f}" type="number" min="0"></div>`;

    openSheet("Opération réalisée", nom, `<div class="panel">
      <div class="grid3">${field("Coût (MAD)", "d-cost")}${field("Kilométrage", "d-km")}</div>
      <label>Note (facultatif)</label>
      <input id="d-note" placeholder="Ex : garage Al Amal">
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end">
      <button class="ghost" id="d-cancel">Annuler</button>
      <button class="primary" id="d-save">Valider</button>
    </div>`);

    $("#d-cancel").addEventListener("click", closeSheet);
    $("#d-save").addEventListener("click", async () => {
      try {
        await api(`/api/admin/maintenance/${id}/done`, {
          method: "POST",
          body: { cost: Number($("#d-cost").value) || 0, km: Number($("#d-km").value) || 0, note: $("#d-note").value.trim() },
        });
        flash("Enregistré.");
        closeSheet();
        loadMaintenance();
      } catch (e) {
        flash(e.message, "err");
      }
    });
  }

  $("#mnt-refresh").addEventListener("click", loadMaintenance);
  $("#mnt-veh").addEventListener("change", loadMaintenance);
  $("#mnt-kind").addEventListener("change", loadMaintenance);
  $("#mnt-new").addEventListener("click", () => mntForm(null));

  $("#mnt-rows").addEventListener("click", async (e) => {
    const done = e.target.closest("[data-mnt-done]");
    const edit = e.target.closest("[data-mnt-edit]");
    const del = e.target.closest("[data-mnt-del]");
    if (done) return mntDone(done.dataset.mntDone);
    if (edit) {
      const items = await api("/api/admin/maintenance");
      return mntForm(items.items.find((m) => String(m.id) === edit.dataset.mntEdit));
    }
    if (del && confirm("Supprimer ce suivi ?")) {
      await api("/api/admin/maintenance/" + del.dataset.mntDel, { method: "DELETE" });
      flash("Suivi supprimé.");
      loadMaintenance();
    }
  });

  /* ---------- statistiques : rendement par voiture ---------- */
  /* Une période se choisit par presets ; « Période précise » affiche les deux
     dates. Sans paramètre, l'API renvoie tout l'historique. */
  function staPeriode() {
    const v = $("#sta-periode").value;
    const iso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (v === "month") {
      const debut = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: iso(debut), to: iso(today) };
    }
    if (v === "year") return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
    if (v === "last") {
      const y = today.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (v === "custom") return { from: $("#sta-from").value, to: $("#sta-to").value };
    return {};
  }

  let staData = null;

  async function loadStatsVehicles() {
    const { from, to } = staPeriode();
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    try {
      staData = await api("/api/admin/stats/vehicles?" + qs);
    } catch (e) {
      flash(e.message, "err");
      return;
    }

    const g = staData.global;
    $("#sta-global").innerHTML = [
      ["Locations", nf.format(g.rentals), false],
      ["Jours loués", nf.format(g.jours), false],
      ["Chiffre d'affaires", money(g.ca), true],
      ["Encaissé", money(g.encaisse), false],
      ["Reste dû", money(g.reste), false],
      ["Prix moyen / jour", money(g.prixMoyen), false],
      ["Annulées", nf.format(g.annulees), false],
    ]
      .map(([l, v, a]) => `<div class="card ${a ? "accent" : ""}"><small>${l}</small><b>${v}</b></div>`)
      .join("");

    const maxCa = Math.max(1, ...staData.vehicles.map((v) => v.ca));
    const rows = staData.vehicles.map((v) => {
      /* Sans CA la barre resterait à 100 % : on la masque plutôt que de mentir. */
      const w = v.ca ? Math.round((v.ca / maxCa) * 100) : 0;
      return `<tr>
        <td><b>${esc(v.name)}</b>${v.active ? "" : ' <span class="pill">désactivé</span>'}</td>
        <td class="num">${nf.format(v.rentals)}</td>
        <td class="num">${nf.format(v.jours)}</td>
        <td class="num"><b>${money(v.ca)}</b></td>
        <td class="num">${money(v.encaisse)}</td>
        <td class="num">${v.reste > 0 ? `<span class="warn">${money(v.reste)}</span>` : "—"}</td>
        <td class="num">${v.jours ? money(v.prixMoyen) : "—"}</td>
        <td>
          <div class="bar" title="${v.part} % du chiffre d'affaires"><i style="width:${w}%"></i></div>
          <small class="faint">${v.part} %</small>
        </td>
        <td class="num">${v.annulees || "—"}</td>
      </tr>`;
    });
    $("#sta-rows").innerHTML = rows.join("");
    $("#sta-empty").classList.toggle("hide", staData.vehicles.some((v) => v.rentals || v.annulees));
  }

  /* Export CSV : séparateur point-virgule et BOM, pour qu'Excel ouvre le
     fichier avec les bons accents sans import manuel. */
  function staExport() {
    if (!staData) return;
    const lignes = [
      ["Véhicule", "Locations", "Jours loués", "CA (MAD)", "Encaissé (MAD)", "Reste dû (MAD)", "Prix moyen /j", "Part du CA (%)", "Annulées"],
      ...staData.vehicles.map((v) => [v.name, v.rentals, v.jours, v.ca, v.encaisse, v.reste, v.prixMoyen, v.part, v.annulees]),
    ];
    const csv =
      "﻿" +
      lignes.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rendement-flotte-${staData.from === "0000-01-01" ? "tout" : staData.from}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  $("#sta-periode").addEventListener("change", () => {
    const custom = $("#sta-periode").value === "custom";
    $("#sta-custom").classList.toggle("hide", !custom);
    if (custom && !$("#sta-from").value) {
      const today = new Date();
      const debut = new Date(today.getFullYear(), today.getMonth(), 1);
      $("#sta-from").value = debut.toISOString().slice(0, 10);
      $("#sta-to").value = today.toISOString().slice(0, 10);
    }
    loadStatsVehicles();
  });
  $("#sta-from").addEventListener("change", loadStatsVehicles);
  $("#sta-to").addEventListener("change", loadStatsVehicles);
  $("#sta-refresh").addEventListener("click", loadStatsVehicles);
  $("#sta-export").addEventListener("click", staExport);

  /* ---------- stats + reservations ---------- */
  async function loadStats() {
    const s = await api("/api/admin/stats");
    $("#stats").innerHTML = [
      ["Total", s.total, false],
      ["Nouvelles", s.nouvelles, true],
      ["Confirmées", s.confirmees, false],
      ["Livrées", s.livrees, false],
      ["Véhicules actifs", s.activeVehicles, false],
    ]
      .map(([l, v, a]) => `<div class="card ${a ? "accent" : ""}"><small>${l}</small><b>${v}</b></div>`)
      .join("");
    /* Pastille du menu : le nombre de demandes à traiter, visible partout. */
    const badge = $("#side-badge");
    if (badge) badge.textContent = s.nouvelles > 0 ? String(s.nouvelles) : "";
  }

  async function loadReservations() {
    const status = $("#fstatus").value;
    const url = "/api/admin/reservations" + (status ? `?status=${status}` : "");
    const { reservations } = await api(url);

    $("#rempty").classList.toggle("hide", reservations.length > 0);
    $("#rows").innerHTML = reservations
      .map(
        (r) => `<tr>
        <td><code>${esc(r.ref)}</code><div class="faint">${esc(dts(r.created_at))}</div></td>
        <td><b>${esc(r.first_name)} ${esc(r.last_name)}</b></td>
        <td>${esc(r.country_code)} ${esc(r.phone)}</td>
        <td>${esc(r.vehicle_name || "—")}</td>
        <td class="faint">${esc(dts(r.pickup_date))} → ${esc(dts(r.return_date))}${r.days ? ` <span class="pill">${r.days}j</span>` : ""}</td>
        <td class="num">${r.total ? `<b>${money(r.total)}</b>` : "—"}</td>
        <td class="num">${r.reste != null ? (r.reste > 0 ? `<b style="color:var(--amber)">${money(r.reste)}</b>` : `<span style="color:var(--green)">soldé</span>`) : "—"}</td>
        <td><span class="tag ${esc(r.status)}">${STATUS[r.status] || esc(r.status)}</span></td>
        <td><button data-open="${r.id}">${r.dossierOpen || r.status === "confirmee" || r.status === "livree" ? "Dossier" : "Ouvrir"}</button></td>
      </tr>`
      )
      .join("");

    $$("[data-open]").forEach((b) =>
      b.addEventListener("click", () => openDossier(Number(b.dataset.open)))
    );
  }

  /* ---------- création manuelle d'une réservation ---------- */
  function reservationForm() {
    if (!vehicles.length) {
      flash("Ajoutez d'abord un véhicule dans la Flotte.", "err");
      showTab("veh");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const in8 = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);

    const field = (label, id, value, type, placeholder) =>
      `<div><label>${label}</label><input id="${id}" type="${type || "text"}" value="${esc(value ?? "")}"${
        placeholder ? ` placeholder="${esc(placeholder)}"` : ""
      }></div>`;

    openSheet("Nouvelle réservation", "Saisie manuelle, avec ou sans fiche client", `<div class="panel">
      <div class="row" style="justify-content:space-between">
        <b>Nouvelle réservation</b>
        <button type="button" class="ghost" id="rclose">Fermer</button>
      </div>

      <label>Client</label>
      <select id="r-client">
        <option value="">— Saisir un nouveau client —</option>
        ${clients.map((c) => `<option value="${c.id}">${esc(c.full_name || c.last_name)}${
          c.phone ? " · " + esc(c.phone) : ""
        }${c.licence_number ? " · permis " + esc(c.licence_number) : ""}</option>`).join("")}
      </select>
      <div class="faint" id="r-clientinfo"></div>

      <label>Identité du conducteur</label>
      <div class="grid3">
        ${field("Prénom", "r-fn")}
        ${field("Nom *", "r-ln")}
        ${field("Tél", "r-ph", "", "tel", "0660000000")}
        ${field("N° de permis *", "r-lic")}
        ${field("Date du permis", "r-licd", "", "date")}
        ${field("N° passeport", "r-pp")}
        ${field("CIN", "r-cin")}
        ${field("Nationalité", "r-nat", "", "text", "Marocaine")}
      </div>

      <label>Véhicule et dates</label>
      <div class="grid3">
        <div><label>Véhicule *</label><select id="r-veh">
          <option value="">— Choisir —</option>
          ${vehicles
            .filter((v) => v.active)
            .map((v) => `<option value="${esc(v.slug)}">${esc(v.name)} — ${money(v.price_from)}/j</option>`)
            .join("")}
        </select></div>
        <div><label>Prise en charge</label><input id="r-pickup" value="Tangier" placeholder="Lieu"></div>
        ${field("Date départ", "r-pd", today, "date")}
        ${field("Heure départ", "r-pt", "10:00", "time")}
        <div><label>Retour</label><input id="r-ret" value="Tangier" placeholder="Lieu"></div>
        ${field("Date retour", "r-rd", in3, "date")}
        ${field("Heure retour", "r-rt", "10:00", "time")}
        <div><label>Siège bébé (MAD/jour)</label><input id="r-baby" type="number" value="0" min="0"></div>
        <div><label>Statut</label><select id="r-status">
          <option value="confirmee">Confirmée</option>
          <option value="nouvelle">Nouvelle</option>
        </select></div>
      </div>

      <div class="panel" id="r-est" style="margin:14px 0 0"></div>

      <label>Notes</label>
      ${field("", "r-notes", "", "text", "Informations complémentaires")}

      <div class="row" style="margin-top:16px">
        <button type="button" class="primary" id="r-save">Créer la réservation</button>
        <button type="button" id="r-demo">Remplir (démo)</button>
      </div>
    </div>`);

    const g = (id) => document.getElementById(id);
    const set = (id, v) => {
      const el = g(id);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    /* Sélection d'une fiche existante : on recopie ses coordonnées, qui restent
       modifiables pour cette réservation. */
    g("r-client").addEventListener("change", () => {
      const c = clients.find((x) => x.id === Number(g("r-client").value));
      g("r-clientinfo").textContent = "";
      ["r-fn", "r-ln", "r-ph", "r-lic", "r-licd", "r-pp", "r-cin", "r-nat"].forEach((id) => set(id, ""));
      if (!c) return;
      set("r-fn", c.first_name || "");
      set("r-ln", c.last_name || "");
      set("r-ph", c.phone || "");
      set("r-lic", c.licence_number || "");
      set("r-licd", c.licence_date || "");
      set("r-pp", c.passport || "");
      set("r-cin", c.cin || "");
      set("r-nat", c.nationality || "");
      if (c.address) g("r-clientinfo").textContent = "Adresse : " + c.address + (c.notes ? " · " + c.notes : "");
      estimate();
    });

    /* Estimation à l'écran, recalculée à chaque changement (le serveur refait
       le calcul définitif à l'enregistrement). */
    function estimate() {
      const v = vehicles.find((x) => x.slug === g("r-veh").value);
      const box = g("r-est");
      if (!v) {
        box.innerHTML = '<span class="faint">Choisissez un véhicule pour estimer le montant.</span>';
        return;
      }
      const d1 = new Date(g("r-pd").value + "T00:00:00");
      const d2 = new Date(g("r-rd").value + "T00:00:00");
      const days = isNaN(d1) || isNaN(d2) ? 0 : Math.max(1, Math.round((d2 - d1) / 86400000));
      let daily = v.price_from;
      for (const t of v.tiers) if (days >= t.days) daily = t.price;
      const seat = Number(g("r-baby").value || 0) * days;
      box.innerHTML = `<div class="grid3">
        <div><div class="faint">Durée</div><div><b>${days} jour(s)</b></div></div>
        <div><div class="faint">Prix / jour</div><div><b>${money(daily)}</b></div></div>
        <div><div class="faint">Siège bébé</div><div><b>${money(seat)}</b></div></div>
        <div><div class="faint">Caution</div><div><b>${money(v.deposit)}</b></div></div>
        <div><div class="faint">Total estimé</div><div><b style="color:var(--amber)">${money(daily * days + seat)}</b></div></div>
      </div>`;
    }
    ["r-veh", "r-pd", "r-rd", "r-baby"].forEach((id) => g(id).addEventListener("input", estimate));
    g("r-veh").addEventListener("change", estimate);

    g("r-demo").addEventListener("click", () => {
      const v = vehicles.find((x) => x.active) || vehicles[0];
      g("r-veh").value = v.slug;
      set("r-fn", "Yassine");
      set("r-ln", "El Amrani");
      set("r-ph", "0661122334");
      set("r-lic", "JK445566");
      set("r-licd", in8);
      set("r-cin", "CD778899");
      set("r-nat", "Marocaine");
      set("r-pd", today);
      set("r-rd", in8);
      estimate();
    });

    g("rclose").addEventListener("click", closeSheet);

    g("r-save").addEventListener("click", async () => {
      const payload = {
        client_id: Number(g("r-client").value) || 0,
        vehicle_slug: g("r-veh").value,
        first_name: g("r-fn").value.trim(),
        last_name: g("r-ln").value.trim(),
        phone: g("r-ph").value.trim(),
        licence_number: g("r-lic").value.trim(),
        licence_date: g("r-licd").value,
        passport: g("r-pp").value.trim(),
        cin: g("r-cin").value.trim(),
        nationality: g("r-nat").value.trim(),
        pickup: g("r-pickup").value.trim(),
        ret: g("r-ret").value.trim(),
        pickup_date: g("r-pd").value,
        pickup_time: g("r-pt").value,
        return_date: g("r-rd").value,
        return_time: g("r-rt").value,
        baby_seat: Number(g("r-baby").value || 0),
        status: g("r-status").value,
        notes: g("r-notes").value.trim(),
      };
      try {
        const res = await api("/api/admin/reservations", { method: "POST", body: payload });
        closeSheet();
        flash(`Réservation ${res.reservation.ref} créée (${res.days} jour(s) · ${money(res.total)}).`);
        await loadClients();
        await openDossier(res.reservation.id);
      } catch (e) {
        flash(e.message, "err");
      }
    });

    estimate();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#rnew")?.addEventListener("click", async () => {
    /* La flotte et les clients sont chargés à la demande : ce bouton peut être
       le premier onglet ouvert dans la session. */
    if (!vehicles.length) {
      try {
        await loadVehicles();
      } catch {
        /* sans flotte, le formulaire le signale */
      }
    }
    if (!clients.length) {
      try {
        await loadClients();
      } catch {
        /* la saisie manuelle reste possible */
      }
    }
    reservationForm();
  });

  /* ================= DOSSIER RÉSERVATION ================= */
  const METHODS = { especes: "Espèces", cb: "Carte bancaire", virement: "Virement", cheque: "Chèque" };
  const KIND_LABEL = { piece: "Pièce", contrat: "Contrat", facture: "Facture", permis: "Permis" };

  let DOSSIER = null;
  let DOS_SUB = "details";

  const DOS_SUBS = [
    ["details", "Détails réservation"],
    ["reglements", "Règlements"],
    ["modifier", "Modifier"],
    ["pieces", "Pièces jointes"],
    ["contrat", "Contrat"],
    ["facture", "Facture"],
    ["conducteur2", "Conducteur 2"],
  ];

  async function openDossier(id) {
    const { reservation } = await api("/api/admin/reservations/" + id);
    DOSSIER = reservation;
    DOS_SUB = reservation.dossierOpen ? "details" : "details";
    renderDossier();
    showTab("dos");
  }

  const dl = (s) => (s ? esc(s) : "—");

  /** Un reste négatif = trop-perçu : on ne l'affiche jamais comme « reste à payer ». */
  function reste(r) {
    if (r.reste > 0) return { v: `<b class="warn-txt">${money(r.reste)}</b>`, c: "warn-txt" };
    if (r.reste < 0)
      return { v: `<b class="ok-txt">0 MAD</b> <span class="faint">(${money(Math.abs(r.reste))} d'avance)</span>`, c: "ok-txt" };
    return { v: `<b class="ok-txt">0 MAD</b>`, c: "ok-txt" };
  }

  function row(label, value, strong) {
    return `<div class="kv"><span>${label}</span><b class="${strong ? "hl" : ""}">${value}</b></div>`;
  }

  function renderDossier() {
    const r = DOSSIER;
    if (!r) return;

    const subnav = DOS_SUBS.map(
      ([k, label]) =>
        `<button data-sub="${k}" class="${DOS_SUB === k ? "on" : ""}">${label}</button>`
    ).join("");

    $("#dos").innerHTML = `
      <div class="dos-head">
        <div>
          <h1>${dl(r.ref)}</h1>
          <div class="dos-head__meta">${dl(r.vehicle_name)} · ${dl(r.first_name)} ${dl(r.last_name)}</div>
        </div>
        <div class="row">
          <span class="tag ${esc(r.status)}">${STATUS[r.status] || esc(r.status)}</span>
          <a class="btn ghost" href="tel:${esc(r.phone)}">Appeler</a>
          <button id="dos-back">Retour</button>
        </div>
      </div>

      ${
        r.dossierOpen
          ? ""
          : `<div class="warn">Dossier fermé : confirmez la réservation pour débloquer les règlements, les pièces jointes et les documents.</div>`
      }

      <div class="subnav">${subnav}</div>
      <div id="dos-body"></div>`;

    $$("#dos [data-sub]").forEach((b) => b.addEventListener("click", () => { DOS_SUB = b.dataset.sub; renderDossier(); }));
    $("#dos-back").addEventListener("click", () => { DOSSIER = null; showTab("res"); });

    const renderers = {
      details: subDetails, reglements: subReglements, modifier: subModifier,
      pieces: subPieces, contrat: () => subDoc("contrat"), facture: () => subDoc("facture"),
      conducteur2: subConducteur2,
    };
    $("#dos-body").innerHTML = renderers[DOS_SUB]();
    bindSub(r);
  }

  /* ---------- onglets ---------- */
  function subDetails() {
    const r = DOSSIER;
    return `<div class="panel">
      <div class="grid2">
        <div>
          <h2 style="margin-top:0">Général</h2>
          ${row("Réf resa", `<code>${dl(r.ref)}</code>`)}
          ${row("Client", dl(`${r.first_name} ${r.last_name}`))}
          ${row("Date de création", dl(dtTime(r.created_at)))}
          ${row("Crée par", dl(r.created_by))}
          ${row("Commercial", dl(r.commercial))}
          ${row("Agence", dl(r.agency))}
          ${row("Téléphone", dl(`${r.country_code} ${r.phone}`))}
          ${row("Permis", dl(`${r.licence_number}${r.licence_date ? " · " + dt(r.licence_date) : ""}`))}
          ${row("Passeport", dl(r.passport))}
          ${row("État", `<span class="tag ${esc(r.status)}">${STATUS[r.status] || r.status}</span>`)}
        </div>
        <div>
          <h2 style="margin-top:0">Trajet</h2>
          ${row("Livraison / Récupération", dl(r.delivery_type))}
          ${row("Départ", dl(`${r.pickup} · ${dtTime(r.pickup_date)} ${r.pickup_time || ""}`))}
          ${row("Retour", dl(`${r.ret} · ${dtTime(r.return_date)} ${r.return_time || ""}`))}
          ${row("Nbr jour(s)", dl(r.days))}
          ${row("Kms au départ", r.kms_depart ? `${Number(r.kms_depart).toLocaleString("fr-FR")} kms` : "—")}
          ${row("Kms au retour", r.kms_return ? `${Number(r.kms_return).toLocaleString("fr-FR")} kms` : "N/A")}
          ${row("Distance", r.distance_km ? `${Number(r.distance_km).toLocaleString("fr-FR")} kms` : "N/A")}
          ${row("Siège bébé", r.baby_seat ? money(r.baby_seat) + " MAD / jour" : "—")}
          ${row("Aller-retour", r.one_way ? "Oui (supplément)" : "Non")}
        </div>
      </div>

      <h2>Tarification</h2>
      <div class="grid2">
        <div>
          ${row("Prix / Jour", dl(money(r.daily)))}
          ${row("Total résa", money(r.total))}
          ${row(`Frais divers${r.extra_fee_label ? " (" + esc(r.extra_fee_label) + ")" : ""}`, money(r.extra_fee))}
        </div>
        <div>
          ${row("Total TTC", `<b class="hl">${money(r.totalTTC)}</b>`, true)}
          ${row("Total versé", money(r.totalPaid))}
          ${row("Reste", reste(r).v, true)}
        </div>
      </div>
      ${r.internal_notes ? `<h2>Notes internes</h2><div class="detail">${esc(r.internal_notes)}</div>` : ""}
      ${r.notes ? `<h2>Remarques client</h2><div class="detail">${esc(r.notes)}</div>` : ""}
      <div class="row" style="margin-top:16px">
        ${Object.entries(STATUS).map(([k, v]) => `<button data-set="${k}" class="${k === r.status ? "primary" : "ghost"}">${v}</button>`).join("")}
        <button class="danger" id="dos-del">Supprimer</button>
      </div>
    </div>`;
  }

  function subReglements() {
    const r = DOSSIER;
    const rows = r.payments.length
      ? r.payments.map((p) => `<tr>
          <td>${esc(dt(p.paid_at))}</td>
          <td>${esc(METHODS[p.method] || p.method)}</td>
          <td>${esc(p.note || "—")}</td>
          <td><b>${money(p.amount)}</b></td>
          <td><button class="danger" data-pay-del="${p.id}">×</button></td>
        </tr>`).join("")
      : '<tr><td colspan="5" class="empty">Aucun règlement enregistré.</td></tr>';

    return `<div class="panel">
      <div class="cards" style="margin-top:0">
        <div class="card"><small>Total TTC</small><b>${money(r.totalTTC)}</b></div>
        <div class="card"><small>Total versé</small><b>${money(r.totalPaid)}</b></div>
        <div class="card accent"><small>Reste</small><b>${r.reste > 0 ? money(r.reste) : "0"}</b>${r.reste < 0 ? `<div class="faint">${money(Math.abs(r.reste))} d'avance</div>` : ""}</div>
      </div>
      <h2 style="margin-top:6px">Ajouter un règlement</h2>
      <div class="grid4">
        <div><label>Montant (MAD)</label><input id="pay-amount" type="number" value="${r.reste > 0 ? r.reste : ""}"></div>
        <div><label>Date</label><input id="pay-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div><label>Mode</label><select id="pay-method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><label>Note</label><input id="pay-note" placeholder="Facultatif"></div>
      </div>
      <div class="row" style="margin-top:12px"><button class="primary" id="pay-add" ${r.dossierOpen ? "" : "disabled"}>Enregistrer</button></div>
      <h2>Historique</h2>
      <table><thead><tr><th>Date</th><th>Mode</th><th>Note</th><th>Montant</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  function subModifier() {
    const r = DOSSIER;
    const inp = (id, label, val, type = "text") =>
      `<div><label>${label}</label><input id="${id}" type="${type}" value="${esc(val ?? "")}"></div>`;
    const dis = r.dossierOpen ? "" : "disabled";
    return `<div class="panel">
      <h2 style="margin-top:0">Suivi</h2>
      <div class="grid3">
        ${inp("e-created_by", "Crée par", r.created_by)}
        ${inp("e-commercial", "Commercial", r.commercial)}
        ${inp("e-agency", "Agence", r.agency)}
        ${inp("e-kms_depart", "Kms au départ", r.kms_depart, "number")}
        ${inp("e-kms_return", "Kms au retour", r.kms_return, "number")}
        ${inp("e-distance_km", "Distance (km)", r.distance_km, "number")}
      </div>
      <div class="grid3">
        <div><label>Livraison / Récupération</label><select id="e-delivery_type" ${dis}>
          ${["", "Livraison", "Récupération"].map((o) => `<option ${r.delivery_type === o ? "selected" : ""}>${o || "— non précisé —"}</option>`).join("")}
        </select></div>
        <div><label>Assurance</label><select id="e-insurance" ${dis}>
          ${["Normale", "Réduite", "Aucune"].map((o) => `<option ${r.insurance === o ? "selected" : ""}>${o}</option>`).join("")}
        </select></div>
        <div><label>Mode de paiement</label><select id="e-payment_mode" ${dis}>
          ${[["", "— déduire des règlements —"], ["especes", "Espèce"], ["cb", "Carte bancaire"], ["virement", "Virement"], ["cheque", "Chèque"]]
            .map(([k, v]) => `<option value="${k}" ${(r.payment_mode || "") === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></div>
      </div>

      <h2>Carburant (jauge du contrat)</h2>
      <div class="grid3">
        <div><label>Départ</label><select id="e-fuel_depart" ${dis}>
          ${["", "0", "1/4", "1/2", "3/4", "1"].map((o) => `<option ${r.fuel_depart === o ? "selected" : ""}>${o || "—"}</option>`).join("")}
        </select></div>
        <div><label>Retour</label><select id="e-fuel_return" ${dis}>
          ${["", "0", "1/4", "1/2", "3/4", "1"].map((o) => `<option ${r.fuel_return === o ? "selected" : ""}>${o || "—"}</option>`).join("")}
        </select></div>
        <div><label>Km parcourus (auto)</label><input value="${r.kmDone ? r.kmDone.toLocaleString("fr-FR") + " kms" : "—"}" disabled></div>
      </div>

      <h2>Identité du 1<sup>er</sup> conducteur</h2>
      <div class="grid3">
        ${inp("e-d1_birthdate", "Né le", r.d1_birthdate, "date")}
        ${inp("e-d1_nationality", "Nationalité", r.d1_nationality)}
        ${inp("e-d1_address", "Adresse au Maroc", r.d1_address)}
        ${inp("e-d1_cin", "CIN N°", r.d1_cin)}
        ${inp("e-d1_cin_date", "CIN délivré le", r.d1_cin_date, "date")}
        ${inp("e-d1_passport_date", "Passeport délivré le", r.d1_passport_date, "date")}
      </div>

      <h2>Trajet</h2>
      <div class="grid4">
        ${inp("e-pickup", "Lieu de départ", r.pickup)}
        ${inp("e-pickup_date", "Date départ", r.pickup_date, "date")}
        ${inp("e-pickup_time", "Heure départ", r.pickup_time, "time")}
        ${inp("e-ret", "Lieu de retour", r.ret)}
        ${inp("e-return_date", "Date retour", r.return_date, "date")}
        ${inp("e-return_time", "Heure retour", r.return_time, "time")}
      </div>

      <h2>Options et équipements</h2>
      <div class="grid2">
        <div class="chk-grid">
          ${["radio:Poste radio", "gps:GPS", "babySeat:Siège bébé", "climatiseur:Climatiseur"]
            .map((o) => { const [k, l] = o.split(":");
              return `<label class="chk"><input type="checkbox" id="o-${k}" ${r.options[k] ? "checked" : ""} ${dis}> ${l}</label>`; }).join("")}
        </div>
        <div class="chk-grid">
          ${[["batterie", "Batterie"], ["outils", "Outils"], ["retroExt", "Retro-ext"], ["feux", "Feux"],
             ["galerie", "Galerie"], ["posteRadio", "Poste Radio"], ["pressuSecours", "Pressu Secours"],
             ["alarmeCigare", "Alarme Cigare"]]
            .map(([k, l]) => `<label class="chk"><input type="checkbox" id="q-${k}" ${r.equipment[k] ? "checked" : ""} ${dis}> ${l}</label>`).join("")}
        </div>
      </div>

      <h2>Frais et observations</h2>
      <div class="grid2">
        ${inp("e-extra_fee_label", "Libellé des frais divers", r.extra_fee_label)}
        ${inp("e-extra_fee", "Montant des frais divers (MAD)", r.extra_fee, "number")}
      </div>
      <label>Observation (imprimée sur le contrat)</label>
      <textarea id="e-observations" rows="2" ${dis}>${esc(r.observations || "")}</textarea>
      <label>Notes internes</label>
      <textarea id="e-internal_notes" rows="3">${esc(r.internal_notes || "")}</textarea>
      <div class="row" style="margin-top:14px"><button class="primary" id="e-save">Enregistrer les modifications</button></div>
    </div>`;
  }

  function subPieces() {
    const r = DOSSIER;
    const useSignedAttachmentUrls = window.LCAdmin?.mode === "supabase";
    const rows = r.attachments.length
      ? r.attachments.map((a) => `<tr>
          <td>${esc(KIND_LABEL[a.kind] || a.kind)}</td>
          <td>${
            useSignedAttachmentUrls
              ? `<button type="button" data-att-open="${a.id}">${esc(a.original_name)}</button>`
              : `<a href="/uploads/reservations/${esc(a.stored_name)}" target="_blank" rel="noopener">${esc(a.original_name)}</a>`
          }</td>
          <td class="faint">${esc(a.mime)}</td>
          <td>${(a.size / 1024).toFixed(0)} Ko</td>
          <td class="faint">${esc(dt(a.created_at))}</td>
          <td><button class="danger" data-att-del="${a.id}">×</button></td>
        </tr>`).join("")
      : '<tr><td colspan="6" class="empty">Aucune pièce jointe.</td></tr>';

    return `<div class="panel">
      <h2 style="margin-top:0">Ajouter une pièce jointe</h2>
      <div class="grid2">
        <div><label>Type</label><select id="att-kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><label>Fichier (JPEG, PNG, WebP ou PDF · 15 Mo)</label><input type="file" id="att-file" accept="image/jpeg,image/png,image/webp,application/pdf" ${r.dossierOpen ? "" : "disabled"}></div>
      </div>
      <label>Nom du document</label>
      <input id="att-name" placeholder="Ex : Permis de conduire — Client" ${r.dossierOpen ? "" : "disabled"}>
      <div class="row" style="margin-top:12px"><button class="primary" id="att-add" ${r.dossierOpen ? "" : "disabled"}>Téléverser</button></div>
      <h2>Fichiers</h2>
      <table><thead><tr><th>Type</th><th>Document</th><th>Format</th><th>Taille</th><th>Ajouté le</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }

  function subDoc(kind) {
    const r = DOSSIER;
    const isContract = kind === "contrat";
    const url = `/api/admin/reservations/${r.id}/${isContract ? "contract" : "invoice"}`;
    const docNumber = isContract ? r.contractNumber : r.invoiceNumber || "attribuée à l'ouverture";
    const attach = r.attachments.filter((a) => a.kind === kind);
    const missing = isContract
      ? [
          !r.d1_birthdate && "date de naissance",
          !r.d1_nationality && "nationalité",
          !r.d1_cin && "CIN",
          !r.kms_depart && "kms au départ",
        ].filter(Boolean)
      : [];

    return `<div class="panel">
      <div class="row" style="justify-content:space-between">
        <div>
          <h2 style="margin-top:0">${isContract ? "Contrat de location" : "Facture"}</h2>
          <div class="faint">${
            isContract
              ? "Document généré à partir du dossier — format du modèle Leegend Cars, 2 pages, prêt à imprimer en PDF."
              : "Document généré à partir du dossier et des règlements enregistrés, prêt à imprimer en PDF."
          }</div>
        </div>
        <div class="row">
          <button type="button" class="btn" id="doc-open">Ouvrir dans un onglet</button>
          ${
            isContract
              ? `<button id="sig-open" ${r.dossierOpen ? "" : "disabled"}>${
                  r.signatureSigned ? "Signature ✓" : "Signature"
                }</button>`
              : ""
          }
          <button class="primary" id="doc-print" ${r.dossierOpen ? "" : "disabled"}>Imprimer / PDF</button>
        </div>
      </div>
      ${
        !r.dossierOpen
          ? `<div class="warn">Dossier fermé : confirmez la réservation pour générer le document.</div>`
          : missing.length
            ? `<div class="warn">Champs non renseignés — ils resteront vides sur le document : ${esc(missing.join(", "))}.</div>`
            : `<div class="ok">Tous les champs nécessaires sont renseignés.</div>`
      }
      ${
        isContract
          ? r.signatureSigned
            ? `<div class="ok" style="margin-top:10px">Contrat signé le <b>${esc(dtTime(r.signatureSignedAt))}</b> par <b>${esc(
                r.signatureName || "—"
              )}</b>${
                r.signatureMode === "remote" ? " (signature électronique, lien à distance)" : " (signature sur place)"
              }.</div>`
            : r.signatureStatus === "pending"
              ? `<div class="warn" style="margin-top:10px">Lien de signature envoyé : en attente du client.</div>`
              : `<div class="warn" style="margin-top:10px">Le contrat n'est pas encore signé. Utilisez le bouton <b>Signature</b> pour le faire signer sur place ou générer un lien.</div>`
          : ""
      }
      ${
        attach.length
          ? `<div class="ok">${attach.length} fichier(s) joint(s) de type « ${KIND_LABEL[kind]} » déjà ajouté(s) au dossier.</div>`
          : ""
      }
      <div class="doc">
        <div class="doc__head">
          <div><b>Leegend Cars</b><div class="faint">${dl("10 Rue ouarzazat hassan Rabat 90000")}</div></div>
          <div style="text-align:right">
            <b>${isContract ? "Contrat de location" : "Facture"}</b>
            <div class="faint">n° ${dl(docNumber)}</div>
          </div>
        </div>
        <table class="doc__table">
          <tr><td>Client</td><td><b>${dl(`${r.first_name} ${r.last_name}`)}</b></td></tr>
          <tr><td>Téléphone</td><td>${dl(`${r.country_code} ${r.phone}`)}</td></tr>
          <tr><td>Permis</td><td>${dl(r.licence_number)}</td></tr>
          <tr><td>Véhicule</td><td>${dl(r.vehicle_name)}</td></tr>
          <tr><td>Départ</td><td>${dl(`${r.pickup} — ${dt(r.pickup_date)} ${r.pickup_time || ""}`)}</td></tr>
          <tr><td>Retour</td><td>${dl(`${r.ret} — ${dt(r.return_date)} ${r.return_time || ""}`)}</td></tr>
          <tr><td>Durée</td><td>${dl(r.days)} jour(s)</td></tr>
          <tr><td>Prix / jour</td><td>${money(r.daily)}</td></tr>
          ${r.extra_fee ? `<tr><td>Frais divers${r.extra_fee_label ? " (" + esc(r.extra_fee_label) + ")" : ""}</td><td>${money(r.extra_fee)}</td></tr>` : ""}
          <tr><td><b>Total TTC</b></td><td><b>${money(r.totalTTC)}</b></td></tr>
          <tr><td>Déjà versé</td><td>${money(r.totalPaid)}</td></tr>
          <tr><td><b>${r.reste > 0 ? "Reste à payer" : "Trop-perçu (avance)"}</b></td><td><b>${r.reste > 0 ? money(r.reste) : money(Math.abs(r.reste))}</b></td></tr>
        </table>
        ${
          isContract
            ? ""
            : `<div class="doc__table" style="border:0;padding:0">
                 <table style="width:100%;margin-top:6px">
                   <thead><tr><td style="border:0;padding:2px 0"><b>Règlements</b></td><td style="border:0;padding:2px 0"></td></tr></thead>
                   <tbody>
                     ${
                       r.payments.length
                         ? r.payments
                             .map(
                               (p) => `<tr>
                                 <td style="border:0;padding:2px 0">${esc(dtTime(p.paid_at))} — ${esc(METHODS[p.method] || p.method)}${p.note ? ` (${esc(p.note)})` : ""}</td>
                                 <td style="border:0;padding:2px 0;text-align:right">${money(p.amount)}</td>
                               </tr>`
                             )
                             .join("")
                         : `<tr><td style="border:0;padding:2px 0" class="faint">Aucun règlement enregistré.</td><td style="border:0"></td></tr>`
                     }
                   </tbody>
                 </table>
               </div>`
        }
      </div>
    </div>`;
  }

  function subConducteur2() {
    const r = DOSSIER;
    const has = r.driver2_first_name || r.driver2_last_name || r.driver2_licence;
    return `<div class="panel">
      <h2 style="margin-top:0">Second conducteur</h2>
      ${has ? "" : '<div class="warn">Aucun second conducteur enregistré pour cette réservation.</div>'}
      <div class="grid3">
        <div><label>Prénom</label><input id="d2-fn" value="${esc(r.driver2_first_name || "")}" ${r.dossierOpen ? "" : "disabled"}></div>
        <div><label>Nom</label><input id="d2-ln" value="${esc(r.driver2_last_name || "")}" ${r.dossierOpen ? "" : "disabled"}></div>
        <div><label>Téléphone</label><input id="d2-ph" value="${esc(r.driver2_phone || "")}" ${r.dossierOpen ? "" : "disabled"}></div>
        <div><label>N° de permis</label><input id="d2-lic" value="${esc(r.driver2_licence || "")}" ${r.dossierOpen ? "" : "disabled"}></div>
        <div><label>Date du permis</label><input id="d2-ld" type="date" value="${esc(r.driver2_licence_date || "")}" ${r.dossierOpen ? "" : "disabled"}></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="primary" id="d2-save" ${r.dossierOpen ? "" : "disabled"}>Enregistrer</button></div>
    </div>`;
  }

  /* ---------- signature client ---------- */
  function closeModal() {
    $("#sig-modal")?.remove();
  }

  function openSignatureModal(r) {
    closeModal();

    const signed = !!r.signatureSigned;
    const pending = !signed && r.signatureStatus === "pending";
    const clientName = `${r.first_name || ""} ${r.last_name || ""}`.trim();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "sig-modal";
    modal.innerHTML = `<div class="modal__box" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3>Signature du client</h3>
        <button class="modal__x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="modal__sub">Contrat n° ${esc(r.contractNumber)} — ${esc(r.vehicle_name || "")}</div>
      <div class="sig-choices">
        <div class="sig-choice">
          <button type="button" data-mode="onsite">
            <b>Signature maintenant</b>
            <span>Le client signe sur l'écran (tablette ou souris). La signature est inscrite sur le contrat immédiatement.</span>
          </button>
          <button type="button" data-mode="remote">
            <b>Créer un lien de signature</b>
            <span>Un lien personnel est envoyé au client : il lit le contrat et signe à distance, sur son téléphone.</span>
          </button>
        </div>
      </div>
      <div class="sig-panel" id="sig-panel"></div>
      <div class="sig-msg" id="sig-msg"></div>
    </div>`;
    document.body.appendChild(modal);

    const panel = modal.querySelector("#sig-panel");
    const msg = modal.querySelector("#sig-msg");

    const say = (text, kind) => {
      msg.className = "sig-msg " + (kind || "");
      msg.textContent = text || "";
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", onEsc);
      }
    });

    let pad = null;
    let hint = null;
    const destroyPad = () => {
      pad?.destroy();
      pad = null;
    };

    if (signed) {
      panel.innerHTML = `<div class="sig-sent">
          <img src="${esc(r.signatureData)}" alt="Signature enregistrée">
          <div>
            <div><b>Signé le ${esc(dtTime(r.signatureSignedAt))}</b></div>
            <div class="modal__sub" style="margin:2px 0 0">par ${esc(r.signatureName || clientName)} — ${
              r.signatureMode === "remote" ? "signature à distance" : "signature sur place"
            }</div>
          </div>
        </div>
        <div class="sig-row">
          <button type="button" class="btn" data-mode="onsite">Faire re-signer sur place</button>
          <button type="button" class="btn" data-mode="remote">${pending ? "Régénérer le lien" : "Créer un lien de signature"}</button>
          <span class="grow" style="flex:1"></span>
          <button type="button" class="btn" id="sig-clear-all">Annuler la signature</button>
        </div>`;
    } else if (pending) {
      panel.innerHTML = `<div class="modal__sub">Lien de signature en attente. Régénérez-le si le client l'a perdu, ou signez sur place.</div>
        <div class="sig-row">
          <button type="button" class="btn" data-mode="onsite">Signer sur place maintenant</button>
          <button type="button" class="btn" data-mode="remote">Régénérer le lien</button>
        </div>`;
    }

    /* ---- choix 1 : signature sur place ---- */
    function renderOnsite() {
      destroyPad();
      panel.innerHTML = `
        <label class="sig-label" for="sig-name">Nom du signataire</label>
        <input class="sig-input" id="sig-name" value="${esc(clientName)}" placeholder="Nom et prénom du client">
        <div class="sig-padbox">
          <canvas id="sig-canvas"></canvas>
          <em id="sig-hint">Faites signer le client ci-dessus</em>
        </div>
        <div class="sig-row">
          <button type="button" class="btn" id="sig-erase">Effacer</button>
          <button type="button" class="btn primary" id="sig-save">Enregistrer la signature</button>
          <span style="flex:1"></span>
          <button type="button" class="btn" id="sig-back">Retour</button>
        </div>`;
      const canvas = panel.querySelector("#sig-canvas");
      pad = new window.SignaturePad(canvas);
      hint = panel.querySelector("#sig-hint");
      canvas.addEventListener("pointerdown", () => hint?.classList.add("gone"));

      panel.querySelector("#sig-erase").addEventListener("click", () => {
        pad.clear();
        hint?.classList.remove("gone");
      });
      panel.querySelector("#sig-back").addEventListener("click", renderChoices);
      panel.querySelector("#sig-save").addEventListener("click", async () => {
        const name = (panel.querySelector("#sig-name").value || "").trim();
        if (name.length < 3) return say("Indiquez le nom complet du signataire.", "err");
        const data = pad.toDataURL(480);
        if (!data) return say("Le client n'a rien signé : la zone est vide.", "err");
        try {
          await api(`/api/admin/reservations/${r.id}/signature`, { method: "POST", body: { name, signature: data } });
          say("Signature enregistrée. Elle apparaît sur le contrat.", "ok");
          const fresh = await api(`/api/admin/reservations/${r.id}`);
          DOSSIER = fresh.reservation;
          renderDossier();
          setTimeout(() => { closeModal(); flash("Signature enregistrée sur le contrat."); }, 900);
        } catch (e) {
          say(e.message, "err");
        }
      });
    }

    /* ---- choix 2 : lien de signature à distance ---- */
    async function renderRemote() {
      destroyPad();
      panel.innerHTML = `<div class="modal__sub">Génération du lien personnel…</div>`;
      try {
        const res = await api(`/api/admin/reservations/${r.id}/signature/link`, { method: "POST" });
        const sms = `Bonjour ${clientName || ""}, merci de signer votre contrat : ${res.url}`.trim();
        panel.innerHTML = `
          <label class="sig-label">Lien à envoyer au client</label>
          <div class="sig-link">
            <input type="text" id="sig-url" readonly value="${esc(res.url)}">
            <button type="button" class="btn" id="sig-copy">Copier</button>
          </div>
          <div class="sig-row">
            ${
              r.phone
                ? `<a class="btn" href="sms:${esc([r.country_code, r.phone].filter(Boolean).join(""))}?body=${encodeURIComponent(
                    sms
                  )}">Envoyer par SMS</a>`
                : ""
            }
            <button type="button" class="btn" id="sig-back2">Retour</button>
          </div>
          <div class="modal__sub" style="margin-top:10px">Le client ouvre ce lien, relit le contrat, signe avec son doigt
            ou sa souris, puis le contrat s'affiche immédiatement avec sa signature.</div>`;
        panel.querySelector("#sig-copy").addEventListener("click", async () => {
          const input = panel.querySelector("#sig-url");
          input.select();
          try {
            await navigator.clipboard.writeText(res.url);
          } catch {
            document.execCommand("copy");
          }
          say("Lien copié : collez-le dans WhatsApp, SMS ou e-mail.", "ok");
        });
        panel.querySelector("#sig-back2").addEventListener("click", renderChoices);
        const fresh = await api(`/api/admin/reservations/${r.id}`);
        DOSSIER = fresh.reservation;
        renderDossier();
      } catch (e) {
        panel.innerHTML = "";
        say(e.message, "err");
      }
    }

    function renderChoices() {
      destroyPad();
      panel.innerHTML = "";
      say("");
    }

    modal.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.mode === "onsite") renderOnsite();
        else renderRemote();
      })
    );
    modal.querySelector("#sig-clear-all")?.addEventListener("click", async () => {
      if (!confirm("Annuler la signature enregistrée et invalider le lien ?")) return;
      await api(`/api/admin/reservations/${r.id}/signature`, { method: "DELETE" });
      closeModal();
      const fresh = await api(`/api/admin/reservations/${r.id}`);
      DOSSIER = fresh.reservation;
      renderDossier();
      flash("Signature annulée.");
    });
  }

  /* ---------- interactions des onglets ---------- */
  function bindSub(r) {
    const reload = async (fresh) => { DOSSIER = fresh; renderDossier(); };

    $$("#dos-body [data-set]").forEach((b) =>
      b.addEventListener("click", async () => {
        const res = await api("/api/admin/reservations/" + r.id, { method: "PATCH", body: { status: b.dataset.set } });
        flash("Statut : " + STATUS[b.dataset.set]);
        await reload(res.reservation);
        loadStats();
      })
    );
    $("#dos-del")?.addEventListener("click", async () => {
      if (!confirm(`Supprimer définitivement la réservation ${r.ref} ?`)) return;
      await api("/api/admin/reservations/" + r.id, { method: "DELETE" });
      flash("Réservation supprimée.");
      DOSSIER = null;
      showTab("res");
      loadStats();
    });

    $("#pay-add")?.addEventListener("click", async () => {
      try {
        const res = await api(`/api/admin/reservations/${r.id}/payments`, {
          method: "POST",
          body: { amount: Number($("#pay-amount").value), method: $("#pay-method").value,
                  paid_at: $("#pay-date").value, note: $("#pay-note").value },
        });
        flash("Règlement enregistré.");
        await reload(res.reservation);
      } catch (e) { flash(e.message, "err"); }
    });
    $$("#dos-body [data-pay-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Supprimer ce règlement ?")) return;
        await api("/api/admin/payments/" + b.dataset.payDel, { method: "DELETE" });
        const fresh = (await api("/api/admin/reservations/" + r.id)).reservation;
        await reload(fresh);
      })
    );

    $("#e-save")?.addEventListener("click", async () => {
      const body = {};
      ["created_by", "commercial", "agency", "kms_depart", "kms_return", "distance_km",
       "delivery_type", "insurance", "payment_mode", "fuel_depart", "fuel_return",
       "d1_birthdate", "d1_nationality", "d1_address", "d1_cin", "d1_cin_date", "d1_passport_date",
       "extra_fee_label", "extra_fee", "pickup", "pickup_date", "pickup_time", "ret", "return_date", "return_time"]
        .forEach((k) => (body[k] = $("#e-" + k).value));
      body.internal_notes = $("#e-internal_notes").value;
      body.observations = $("#e-observations").value;
      body.options = {
        radio: $("#o-radio").checked, gps: $("#o-gps").checked,
        babySeat: $("#o-babySeat").checked, climatiseur: $("#o-climatiseur").checked,
      };
      body.equipment = {};
      ["batterie", "outils", "retroExt", "feux", "galerie", "posteRadio", "pressuSecours", "alarmeCigare"]
        .forEach((k) => (body.equipment[k] = $("#q-" + k).checked));
      try {
        const res = await api("/api/admin/reservations/" + r.id, { method: "PATCH", body });
        flash("Modifications enregistrées.");
        await reload(res.reservation);
      } catch (e) { flash(e.message, "err"); }
    });

    $("#att-add")?.addEventListener("click", () => {
      const input = $("#att-file");
      const file = input.files?.[0];
      if (!file) return flash("Choisissez un fichier.", "err");
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api(`/api/admin/reservations/${r.id}/attachments`, {
            method: "POST",
            body: { kind: $("#att-kind").value, name: $("#att-name").value || file.name, files: [await reduire(reader.result)] },
          });
          /* La route renvoie les pièces, pas le dossier : on relit pour que la
             liste affiche réellement le fichier ajouté. */
          const fresh = (await api(`/api/admin/reservations/${r.id}`)).reservation;
          flash("Pièce jointe ajoutée.");
          await reload(fresh);
        } catch (e) { flash(e.message, "err"); }
      };
      reader.readAsDataURL(file);
    });
    $$("#dos-body [data-att-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Supprimer cette pièce jointe ?")) return;
        b.disabled = true;
        try {
          await api("/api/admin/attachments/" + b.dataset.attDel, { method: "DELETE" });
          const fresh = (await api("/api/admin/reservations/" + r.id)).reservation;
          flash("Pièce jointe supprimée.");
          await reload(fresh);
        } catch (e) {
          flash(e.message || "Impossible de supprimer la pièce jointe.", "err");
          b.disabled = false;
        }
      })
    );
    $$("#dos-body [data-att-open]").forEach((b) =>
      b.addEventListener("click", async () => {
        const win = window.open("", "_blank");
        try {
          const { url } = await api(`/api/admin/attachments/${b.dataset.attOpen}/view`);
          if (!url) throw new Error("Impossible d'ouvrir cette pièce jointe.");
          if (win) win.location.href = url;
          else window.open(url, "_blank");
        } catch (e) {
          if (win) win.close();
          flash(e.message || "Erreur lors de l'ouverture de la pièce jointe.", "err");
        }
      })
    );

    $("#d2-save")?.addEventListener("click", async () => {
      try {
        const res = await api("/api/admin/reservations/" + r.id, {
          method: "PATCH",
          body: { driver2_first_name: $("#d2-fn").value, driver2_last_name: $("#d2-ln").value,
                  driver2_phone: $("#d2-ph").value, driver2_licence: $("#d2-lic").value,
                  driver2_licence_date: $("#d2-ld").value },
        });
        flash("Second conducteur enregistré.");
        await reload(res.reservation);
      } catch (e) { flash(e.message, "err"); }
    });

    $("#sig-open")?.addEventListener("click", () => openSignatureModal(r));

    /* Les deux boutons d'ouverture — le lien du panneau et celui de la barre —
       passent par l'appel unique : une adresse /api/… n'existe pas sur Netlify. */
    const urlDocument = () => {
      const kind = DOS_SUB === "facture" ? "invoice" : "contract";
      return `/api/admin/reservations/${r.id}/${kind}`;
    };
    $("#doc-open")?.addEventListener("click", () => {
      ouvrirDocument(urlDocument()).catch((e) => flash(e.message, "err"));
    });
    $("#doc-print")?.addEventListener("click", () => {
      ouvrirDocument(urlDocument()).catch((e) => flash(e.message, "err"));
    });
  }

  $("#refresh").addEventListener("click", loadReservations);
  $("#fstatus").addEventListener("change", loadReservations);

  /* ---------- clients ---------- */
  const CLIENT_TYPES = [
    ["particulier", "Particulier"],
    ["professionnel", "Professionnel"],
    ["entreprise", "Entreprise"],
  ];
  const typeLabel = (t) => (CLIENT_TYPES.find((x) => x[0] === t) || CLIENT_TYPES[0])[1];
  const dateClientInput = (value) => {
    return window.LCDateUtils?.normalizeIsoDate(value) || "";
  };
  const dateClientAffichage = (value) => {
    const date = dateClientInput(value);
    if (!date) return "—";
    const [annee, mois, jour] = date.split("-").map(Number);
    const d = new Date(annee, mois - 1, jour);
    return d.getFullYear() === annee && d.getMonth() === mois - 1 && d.getDate() === jour
      ? d.toLocaleDateString("fr-FR")
      : "—";
  };
  const detailsClient = (client) => {
    const lignes = [
      ["Type", typeLabel(client.client_type)],
      ["Nom", client.last_name],
      ["Prénom", client.first_name],
      ["Date de naissance", dateClientAffichage(client.birthdate)],
      ["Nationalité", client.nationality],
      ["Téléphone", client.phone],
      ["E-mail", client.email],
      ["Adresse", client.address],
      ["N° du permis", client.licence_number],
      ["Délivré le", dateClientAffichage(client.licence_date)],
      ["N° CIN", client.cin],
      ["Délivrée le", dateClientAffichage(client.cin_date)],
      ["N° du passeport", client.passport],
      ["Délivré le", dateClientAffichage(client.passport_date)],
      ["N° d'entrée au Maroc", client.entry_number],
      ["Date d'entrée", dateClientAffichage(client.entry_date)],
      ["Notes", client.notes],
    ];
    openSheet(
      client.full_name || client.last_name,
      "Détails de la fiche client",
      `<div class="panel">
        <div class="grid2">
          ${lignes.map(([label, value]) => `<div><div class="faint">${esc(label)}</div><b>${value ? esc(value) : "—"}</b></div>`).join("")}
        </div>
        <div class="row" style="margin-top:16px">
          <button type="button" class="primary" id="c-detail-edit">Modifier la fiche</button>
          <button type="button" class="ghost" id="c-detail-close">Fermer</button>
        </div>
      </div>`
    );
    $("#c-detail-edit").addEventListener("click", () => clientForm(client));
    $("#c-detail-close").addEventListener("click", closeSheet);
  };

  let clients = [];

  async function loadClients() {
    const q = $("#cq").value.trim();
    const type = $("#ctype").value;
    const url = "/api/admin/clients" + (q || type ? `?${type ? "type=" + type : ""}${type && q ? "&" : ""}${q ? "q=" + encodeURIComponent(q) : ""}` : "");
    const res = await api(url);
    clients = res.clients;

    $("#cempty").classList.toggle("hide", clients.length > 0);
    $("#crows").innerHTML = clients
      .map(
        (c) => `<tr>
          <td><b>${esc(c.full_name || c.last_name)}</b></td>
          <td><span class="tag">${esc(typeLabel(c.client_type))}</span></td>
          <td>${dl(c.phone)}</td>
          <td>${dl(c.email)}</td>
          <td>${dl(c.licence_number)}${c.licence_date ? `<div class="faint">${esc(dateClientAffichage(c.licence_date))}</div>` : ""}</td>
          <td>${dl(c.cin)}</td>
          <td>${dl(c.nationality)}</td>
          <td><div class="row" style="justify-content:flex-end;gap:6px">
            <button data-cdetail="${c.id}">Détails</button>
            <button data-cedit="${c.id}">Modifier</button>
            <button class="danger" data-cdel="${c.id}" data-cname="${esc(c.full_name || c.last_name)}">Supprimer</button>
          </div></td>
        </tr>`
      )
      .join("");

    $$("[data-cdetail]").forEach((b) =>
      b.addEventListener("click", () => detailsClient(clients.find((c) => c.id === Number(b.dataset.cdetail))))
    );
    $$("[data-cedit]").forEach((b) =>
      b.addEventListener("click", () => clientForm(clients.find((c) => c.id === Number(b.dataset.cedit))))
    );
    $$("[data-cdel]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`Supprimer le client « ${b.dataset.cname} » ?`)) return;
        try {
          await api("/api/admin/clients/" + b.dataset.cdel, { method: "DELETE" });
          flash("Client supprimé.");
          loadClients();
        } catch (e) {
          flash(e.message, "err");
        }
      })
    );
  }

  function clientForm(c) {
    const isNew = !c;
    c = c || {
      client_type: "particulier", last_name: "", first_name: "", birthdate: "", phone: "", email: "",
      address: "", licence_number: "", licence_date: "", cin: "", cin_date: "", passport: "",
      passport_date: "", entry_number: "", entry_date: "", nationality: "", notes: "",
    };

    const field = (label, id, value, type, placeholder) =>
      `<div><label>${label}</label><input id="${id}" type="${type || "text"}" value="${esc(value || "")}"${
        placeholder ? ` placeholder="${esc(placeholder)}"` : ""
      }></div>`;

    openSheet(
      isNew ? "Nouveau client" : c.full_name || c.last_name,
      isNew ? "Fiche à réutiliser pour les prochaines réservations" : "Modification de la fiche",
      `<div class="panel">
      <div class="row" style="justify-content:space-between">
        <b>${isNew ? "Nouveau client" : "Modifier " + esc(c.full_name || c.last_name)}</b>
        <button type="button" class="ghost" id="cclose">Fermer</button>
      </div>

      <label>Type de client</label>
      <select id="c-type" style="max-width:260px">
        ${CLIENT_TYPES.map(([v, l]) => `<option value="${v}" ${c.client_type === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>

      <label>Identité</label>
      <div class="grid3">
        ${field("Nom *", "c-ln", c.last_name, "text", "Ben ayadech")}
        ${field("Prénom", "c-fn", c.first_name, "text", "Badr")}
        ${field("Date de naissance", "c-bd", dateClientInput(c.birthdate), "date")}
        ${field("Nationalité", "c-nat", c.nationality, "text", "Marocaine")}
      </div>

      <label>Contact</label>
      <div class="grid3">
        ${field("Tél", "c-ph", c.phone, "tel", "06 00 00 00 00")}
        ${field("Email", "c-em", c.email, "email", "client@email.com")}
      </div>
      <label>Adresse</label>
      ${field("", "c-addr", c.address, "text", "Rue, ville")}

      <label>Permis de conduire</label>
      <div class="grid3">
        ${field("Num permis", "c-lic", c.licence_number)}
        ${field("Date de délivrance", "c-licd", dateClientInput(c.licence_date), "date")}
      </div>

      <label>CIN</label>
      <div class="grid3">
        ${field("Num CIN", "c-cin", c.cin)}
        ${field("Date de délivrance", "c-cind", dateClientInput(c.cin_date), "date")}
      </div>

      <label>Passeport</label>
      <div class="grid3">
        ${field("Num passeport", "c-pp", c.passport)}
        ${field("Date de délivrance", "c-ppd", dateClientInput(c.passport_date), "date")}
      </div>

      <label>Numéro d'entrée au Maroc</label>
      <div class="grid3">
        ${field("Num d'entrée", "c-entry", c.entry_number)}
        ${field("Date d'entrée", "c-entryd", dateClientInput(c.entry_date), "date")}
      </div>

      <label>Notes</label>
      ${field("", "c-notes", c.notes, "text", "Informations utiles")}

      <div class="row" style="margin-top:16px">
        <button type="button" class="primary" id="c-save">${isNew ? "Créer le client" : "Enregistrer"}</button>
        ${isNew ? "" : '<button type="button" class="danger" id="c-del">Supprimer</button>'}
      </div>
    </div>`
    );

    $("#cclose").addEventListener("click", closeSheet);

    const body = () => ({
      client_type: $("#c-type").value,
      last_name: $("#c-ln").value.trim(),
      first_name: $("#c-fn").value.trim(),
      birthdate: $("#c-bd").value,
      phone: $("#c-ph").value.trim(),
      email: $("#c-em").value.trim(),
      address: $("#c-addr").value.trim(),
      licence_number: $("#c-lic").value.trim(),
      licence_date: $("#c-licd").value,
      cin: $("#c-cin").value.trim(),
      cin_date: $("#c-cind").value,
      passport: $("#c-pp").value.trim(),
      passport_date: $("#c-ppd").value,
      entry_number: $("#c-entry").value.trim(),
      entry_date: $("#c-entryd").value,
      nationality: $("#c-nat").value.trim(),
      notes: $("#c-notes").value.trim(),
    });

    $("#c-save").addEventListener("click", async () => {
      const payload = body();
      if (!payload.last_name) {
        flash("Le nom est obligatoire.", "err");
        $("#c-ln").focus();
        return;
      }
      const dates = [
        ["Date de naissance", payload.birthdate],
        ["Date de délivrance du permis", payload.licence_date],
        ["Date de délivrance de la CIN", payload.cin_date],
        ["Date de délivrance du passeport", payload.passport_date],
        ["Date d'entrée au Maroc", payload.entry_date],
      ];
      const dateInvalide = dates.find(([label, value]) => value && !window.LCDateUtils?.isIsoDate(value));
      if (dateInvalide) {
        flash(`${dateInvalide[0]} invalide. Choisissez une date dans le calendrier.`, "err");
        return;
      }
      try {
        if (isNew) {
          await api("/api/admin/clients", { method: "POST", body: payload });
          flash("Client créé.");
        } else {
          await api("/api/admin/clients/" + c.id, { method: "PATCH", body: payload });
          flash("Client mis à jour.");
        }
        closeSheet();
        loadClients();
      } catch (e) {
        flash(e.message, "err");
      }
    });

    $("#c-del")?.addEventListener("click", async () => {
      if (!confirm(`Supprimer définitivement « ${c.full_name || c.last_name} » ?`)) return;
      try {
        await api("/api/admin/clients/" + c.id, { method: "DELETE" });
        flash("Client supprimé.");
        closeSheet();
        loadClients();
      } catch (e) {
        flash(e.message, "err");
      }
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#cnew")?.addEventListener("click", () => clientForm(null));
  $("#crefresh")?.addEventListener("click", loadClients);
  $("#ctype")?.addEventListener("change", loadClients);
  let ct;
  $("#cq")?.addEventListener("input", () => {
    clearTimeout(ct);
    ct = setTimeout(loadClients, 250);
  });

  /* ---------- vehicles ---------- */
  /** Même règle que le serveur : sans accents, minuscules, séparés par des tirets. */
  const slugify = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  async function loadVehicles() {
    const { vehicles: list } = await api("/api/admin/vehicles");
    vehicles = list;
    $("#veh-list").innerHTML =
      list.map(vehicleCard).join("") || '<div class="empty">Aucun véhicule.</div>';
    $$("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => vehicleForm(vehicles.find((v) => v.slug === b.dataset.edit)))
    );
    $$("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`Supprimer « ${b.dataset.del} » ?`)) return;
        try {
          await api("/api/admin/vehicles/" + encodeURIComponent(b.dataset.del), { method: "DELETE" });
          flash("Véhicule supprimé.");
          loadVehicles();
        } catch (e) {
          flash(e.message, "err");
        }
      })
    );
    $$("[data-toggle]").forEach((b) =>
      b.addEventListener("click", async () => {
        const v = vehicles.find((x) => x.slug === b.dataset.toggle);
        if (!v) return flash("Véhicule introuvable. Actualisez la flotte puis réessayez.", "err");
        b.disabled = true;
        try {
          await api("/api/admin/vehicles/" + encodeURIComponent(v.slug), {
            method: "PUT",
            body: { active: !v.active },
          });
          flash(v.active ? "Véhicule masqué du site." : "Véhicule affiché sur le site.");
          await loadVehicles();
        } catch (e) {
          flash(e.message || "Impossible de modifier la visibilité du véhicule.", "err");
          b.disabled = false;
        }
      })
    );
    const sel = $("#bl-veh");
    if (sel) sel.innerHTML = list.map((v) => `<option value="${esc(v.slug)}">${esc(v.name)}</option>`).join("");
    const mnt = $("#mnt-veh");
    if (mnt) {
      const avant = mnt.value;
      mnt.innerHTML =
        '<option value="">Tous les véhicules</option>' +
        list.map((v) => `<option value="${esc(v.slug)}">${esc(v.name)}</option>`).join("");
      mnt.value = avant; // on garde le filtre en place après rechargement
    }
  }

  const imgSrc = (p) => {
    if (!p) return "";
    const s = String(p).trim();
    if (/^(https?:|\/\/|data:)/i.test(s)) return esc(s);
    return "/" + esc(s.replace(/^\/+/, ""));
  };

  function vehicleCard(v) {
    const spec = (l, val) => `<div><div class="faint">${l}</div><div>${val || "—"}</div></div>`;
    return `<div class="panel">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="display:flex;gap:14px">
          <div class="veh-thumb">${v.gallery && v.gallery[0] ? `<img src="${imgSrc(v.gallery[0])}" alt="">` : "—"}</div>
          <div>
            <b style="font-size:16px">${esc(v.name)}</b>
            <span class="faint"> · <code>${esc(v.slug)}</code></span>
            ${v.en_service ? '<span class="tag confirmee">en service</span>' : '<span class="tag annulee">hors service</span>'}
            ${v.active ? '<span class="tag confirmee">Visible sur le site</span>' : '<span class="tag annulee">Masqué du site</span>'}
            <div class="faint">${esc([v.modele, v.categorie, v.couleur].filter(Boolean).join(" · ") || "—")}</div>
            <div class="faint">${esc(
              [
                v.matricule_ww ? "WW " + v.matricule_ww : "",
                v.matricule || "",
                v.kilometrage ? `${Number(v.kilometrage).toLocaleString("fr-FR")} km` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "Immatriculation à renseigner"
            )}</div>
          </div>
        </div>
        <div class="row">
          <button data-toggle="${esc(v.slug)}">${v.active ? "Masquer du site" : "Afficher sur le site"}</button>
          <button data-edit="${esc(v.slug)}">Modifier</button>
          <button class="danger" data-del="${esc(v.slug)}">Supprimer</button>
        </div>
      </div>
      <div class="grid3" style="margin-top:12px">
        ${spec("Prix / jour", `<b>${money(v.price_from)}</b>`)}
        ${spec("Caution", `<b>${money(v.deposit)}</b>`)}
        ${spec("Barème", `<span class="faint">${(v.tiers || []).map((x) => `${x.days}j→${x.price}`).join(" · ") || "—"}</span>`)}
        ${spec("Places / portes", `${v.seats} / ${v.doors}`)}
        ${spec("Transmission / énergie", `${esc(v.transmission || "—")} · ${esc(v.energie || v.fuel || "—")}`)}
        ${spec("Climatisation", esc(v.climatisation || "—"))}
        ${spec("Puissance fiscale", v.puissance_fiscale ? `${v.puissance_fiscale} CV` : "—")}
        ${spec("En circulation le", v.date_circulation ? esc(v.date_circulation) : "—")}
        ${spec("Photos", `${(v.gallery || []).length}`)}
      </div>
    </div>`;
  }

  function vehicleForm(v) {
    v = v || {
      slug: "", name: "", modele: "", tagline: "", badge: "", matricule_ww: "", matricule: "",
      couleur: "", kilometrage: "", transmission: "", energie: "", fuel: "",
      doors: 5, seats: 5, puissance_fiscale: "", climatisation: "", categorie: "",
      date_circulation: "", price_from: 0, deposit: 0, approx: 0, sort_order: 0,
      description: [], ideal_for: [], gallery: [], tiers: [], active: true, en_service: true,
    };

    // photos = chemins déjà enregistrés ; previews = dataURL non encore envoyées
    const photos = (v.gallery || []).slice();
    const previews = [];
    const removed = [];

    const shotHtml = (src, index, isPreview) => `<div class="shot">
          <img src="${isPreview ? src : imgSrc(src)}" alt="">
          <button type="button" class="shot__x" data-rm="${index}" data-preview="${isPreview ? 1 : 0}" title="Retirer">×</button>
        </div>`;

    const photoList = () =>
      photos.map((p, i) => shotHtml(p, i, false)).join("") +
      previews.map((p, i) => shotHtml(p, i, true)).join("");

    const bindPhotoEvents = () => {
      $$("#shots [data-rm]").forEach((b) =>
        b.addEventListener("click", () => {
          const i = Number(b.dataset.rm);
          if (b.dataset.preview === "1") previews.splice(i, 1);
          else {
            const [gone] = photos.splice(i, 1);
            removed.push(gone);
          }
          $("#shots").innerHTML = photoList();
          $("#upinfo").textContent = `${photos.length + previews.length} photo(s)${previews.length ? ` — ${previews.length} à envoyer` : ""}`;
          bindPhotoEvents();
        })
      );
    };

    openSheet(
      v.name ? v.name : "Nouveau véhicule",
      v.name ? "Modification de la fiche véhicule" : "Véhicule affiché sur le site public",
      `<div class="panel">
      <div class="row" style="justify-content:space-between">
        <b>${v.name ? "Modifier " + esc(v.name) : "Nouveau véhicule"}</b>
        <button type="button" class="ghost" id="close">Fermer</button>
      </div>

      <label>Photos (JPEG, PNG ou WebP · 5 Mo max par photo)</label>
      <input type="file" id="f-files" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="shots" id="shots">${photoList()}</div>
      <div class="faint" id="upinfo">${photos.length} photo(s)</div>

      <label>Identification</label>
      <div class="grid3">
        <div><label>Nom *</label><input id="f-name" value="${esc(v.name)}" placeholder="Mercedes A-Class"></div>
        <div><label>Modèle *</label><input id="f-modele" value="${esc(v.modele || "")}" placeholder="A 180"></div>
        <div><label>Adresse web <span class="faint">(facultatif)</span></label>
          <input id="f-slug" value="${esc(v.slug)}" placeholder="généré automatiquement">
          <div class="faint">Le lien de la fiche : <code id="f-slug-apercu">…</code></div>
        </div>
        <div><label>Matricule WW <span class="faint">(si neuf)</span></label>
          <input id="f-mww" value="${esc(v.matricule_ww || "")}" placeholder="WW-1234-XX">
          <div class="faint">Véhicule neuf, non encore immatriculé.</div>
        </div>
        <div><label>Matricule <span class="faint">(si occasion)</span></label>
          <input id="f-mat" value="${esc(v.matricule || "")}" placeholder="A-12345-B">
          <div class="faint">Véhicule déjà immatriculé au Maroc.</div>
        </div>
        <div><label>Couleur *</label><input id="f-couleur" value="${esc(v.couleur || "")}" placeholder="Blanc"></div>
        <div><label>Catégorie</label><input id="f-cat" value="${esc(v.categorie || "")}" placeholder="Berline / SUV"></div>
        <div><label>Kilométrage *</label><input id="f-km" type="number" value="${v.kilometrage || ""}" placeholder="45000"></div>
        <div><label>En circulation le</label><input id="f-dc" type="date" value="${esc(v.date_circulation || "")}"></div>
      </div>

      <label>Caractéristiques</label>
      <div class="grid3">
        <div><label>Prix/jour (MAD) *</label><input id="f-price" type="number" value="${v.price_from}"></div>
        <div><label>Caution (MAD)</label><input id="f-deposit" type="number" value="${v.deposit}"></div>
        <div><label>Nombre de places *</label><input id="f-seats" type="number" value="${v.seats}"></div>
        <div><label>Nombre de portes *</label><input id="f-doors" type="number" value="${v.doors}"></div>
        <div><label>Puissance fiscale (CV)</label><input id="f-pf" type="number" value="${v.puissance_fiscale || ""}" placeholder="9"></div>
        <div><label>Transmission</label><select id="f-trans">
          ${["Automatique", "Manuelle", "Semi-automatique"].map((o) => `<option ${v.transmission === o ? "selected" : ""}>${o}</option>`).join("")}
        </select></div>
        <div><label>Énergie</label><select id="f-energie">
          ${["Gasoil", "Essence", "Hybride", "Électrique"].map((o) => `<option ${(v.energie || v.fuel) === o ? "selected" : ""}>${o}</option>`).join("")}
        </select></div>
        <div><label>Climatisation</label><select id="f-clim">
          ${["Oui", "Non"].map((o) => `<option ${(v.climatisation || "Oui") === o ? "selected" : ""}>${o}</option>`).join("")}
        </select></div>
        <div><label>Estimation (€)</label><input id="f-approx" type="number" value="${v.approx}"></div>
        <div><label>Badge</label><input id="f-badge" value="${esc(v.badge || "")}"></div>
        <div><label>Ordre d'affichage</label><input id="f-sort" type="number" min="0" value="${v.sort_order || 0}">
          <div class="faint">1 = premier, puis ordre croissant · 0 = à la fin</div></div>
      </div>

      <label>Texte</label>
      <div class="grid2">
        <div><label>Accroche</label><input id="f-tagline" value="${esc(v.tagline || "")}"></div>
        <div><label>Description (une phrase par ligne)</label><textarea id="f-desc" rows="3">${esc((v.description || []).join("\n"))}</textarea></div>
      </div>
      <div class="grid2">
        <div><label>Idéal pour (un par ligne)</label><textarea id="f-ideal" rows="3">${esc((v.ideal_for || []).join("\n"))}</textarea></div>
        <div><label>Barème : « jours:prix » par ligne (ex : 3:850)</label><textarea id="f-tiers" rows="4">${esc((v.tiers || []).map((x) => `${x.days}:${x.price}`).join("\n"))}</textarea></div>
      </div>

      <div class="row" style="margin-top:16px">
        <button type="button" class="primary" id="save">Enregistrer</button>
      </div>
    </div>`
    );

    bindPhotoEvents();

    $("#f-files").addEventListener("change", (e) => {
      const files = [...e.target.files];
      const room = 12 - photos.length - previews.length;
      if (files.length > room) alert(`Maximum ${room} photo(s) restante(s).`);
      $("#upinfo").textContent = "Lecture des fichiers…";
      Promise.all(
        files.slice(0, Math.max(0, room)).map(async (f) => {
          const brut = await lireFichier(f);
          return f.type.startsWith("image/") ? reduire(brut) : brut;
        })
      )
        .then((loaded) => {
          previews.push(...loaded);
          $("#shots").innerHTML = photoList();
          $("#upinfo").textContent = `${photos.length + previews.length} photo(s) — ${previews.length} à envoyer`;
          e.target.value = "";
          bindPhotoEvents();
        })
        .catch(() => ($("#upinfo").textContent = "Lecture impossible"));
    });

    $("#close").addEventListener("click", closeSheet);

    /* Slug : rempli tant que l'agent ne l'a pas modifié lui-même. */
    let slugManuel = !!v.slug;
    const majSlug = () => {
      const champ = $("#f-slug");
      const apercu = $("#f-slug-apercu");
      const courant = slugify(champ.value);
      if (!slugManuel) champ.value = slugify($("#f-name").value);
      const final = slugify(champ.value);
      if (apercu) apercu.textContent = final ? "/#/vehicules/" + final : "…";
      return courant;
    };
    $("#f-name").addEventListener("input", majSlug);
    $("#f-slug").addEventListener("input", () => {
      slugManuel = true;
      majSlug();
    });
    majSlug();

    $("#save").addEventListener("click", async () => {
      const btn = $("#save");
      const val = (s) => ($(s)?.value ?? "").trim();
      const num = (s) => Number(val(s)) || 0;
      const lines = (s) => val(s).split("\n").map((x) => x.trim()).filter(Boolean);

      if (!val("#f-name")) return flash("Le nom est obligatoire.", "err");

      const tiers = lines("#f-tiers").map((l) => {
        const [days, price] = l.split(":").map((x) => parseInt(x, 10));
        return { label: `${days || 0} jours et +`, days: days || 0, price: price || 0 };
      });

      const body = {
        /* Normalisé ici aussi : une majuscule ou un espace saisi à la main ne
           provoque pas une erreur, il est simplement corrigé. */
        slug: slugify(val("#f-slug")),
        name: val("#f-name"),
        modele: val("#f-modele"),
        tagline: val("#f-tagline"),
        badge: val("#f-badge"),
        matricule_ww: val("#f-mww"),
        matricule: val("#f-mat"),
        couleur: val("#f-couleur"),
        categorie: val("#f-cat"),
        kilometrage: num("#f-km"),
        date_circulation: val("#f-dc"),
        transmission: val("#f-trans"),
        energie: val("#f-energie"),
        fuel: val("#f-energie"),
        climatisation: val("#f-clim"),
        seats: num("#f-seats"),
        doors: num("#f-doors"),
        puissance_fiscale: num("#f-pf"),
        price_from: num("#f-price"),
        deposit: num("#f-deposit"),
        approx: num("#f-approx"),
        sort_order: num("#f-sort"),
        description: lines("#f-desc"),
        ideal_for: lines("#f-ideal"),
        tiers,
        active: !!v.active,
        en_service: !!v.en_service,
        keepPhotos: photos,
        removePhotos: removed,
        photos: previews,
      };

      btn.disabled = true;
      btn.textContent = previews.length ? `Envoi (${previews.length} photo…)` : "Envoi…";
      try {
        const res = await api(
          v.slug ? "/api/admin/vehicles/" + encodeURIComponent(v.slug) : "/api/admin/vehicles",
          { method: v.slug ? "PUT" : "POST", body }
        );
        flash("Véhicule enregistré." + (res.warnings?.length ? " (" + res.warnings.join(" ; ") + ")" : ""));
        closeSheet();
        loadVehicles();
      } catch (e) {
        flash(e.message, "err");
        btn.disabled = false;
        btn.textContent = "Enregistrer";
      }
    });
  }

  $("#new-veh").addEventListener("click", () => vehicleForm(null));

  /* ---------- blocked dates ---------- */
  async function loadBlocked() {
    const { blocked } = await api("/api/admin/blocked");
    $("#bl-rows").innerHTML =
      blocked
        .map(
          (b) => `<tr>
        <td>${esc(vehicles.find((v) => v.slug === b.vehicle_slug)?.name || b.vehicle_slug)}</td>
        <td>${esc(dt(b.start_date))}</td><td>${esc(dt(b.end_date))}</td>
        <td class="faint">${esc(b.reason || "—")}</td>
        <td><button class="danger" data-unbl="${b.id}">Retirer</button></td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="empty">Aucune période bloquée.</td></tr>';
    $$("[data-unbl]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api("/api/admin/blocked/" + b.dataset.unbl, { method: "DELETE" });
        loadBlocked();
      })
    );
  }

  $("#bl-add").addEventListener("click", async () => {
    try {
      await api("/api/admin/blocked", {
        method: "POST",
        body: {
          vehicle_slug: $("#bl-veh").value,
          start_date: $("#bl-start").value,
          end_date: $("#bl-end").value,
          reason: $("#bl-reason").value.trim(),
        },
      });
      flash("Période bloquée.");
      $("#bl-start").value = $("#bl-end").value = "";
      loadBlocked();
    } catch (e) {
      flash(e.message, "err");
    }
  });

  /* ---------- settings ---------- */
  async function loadAgencySettings() {
    const message = $("#agency-settings-msg");
    message.className = "";
    message.textContent = "";
    try {
      const { agency } = await api("/api/admin/agency-settings");
      const settings = agency.settings && typeof agency.settings === "object" ? agency.settings : {};
      const form = $("#agency-settings-form");
      form.elements.namedItem("brand").value = settings.brand || agency.name || "";
      for (const field of [
        "tagline", "city", "phonePrimary", "phonePrimaryTel", "phoneSecondary",
        "phoneSecondaryTel", "address", "mapsUrl", "hours",
      ]) {
        form.elements.namedItem(field).value = settings[field] || "";
      }
      form.elements.namedItem("pickupLocations").value = Array.isArray(settings.pickupLocations)
        ? settings.pickupLocations.join("\n")
        : "";
      form.elements.namedItem("babySeatDaily").value = String(Number(settings.babySeatDaily) || 0);
    } catch (e) {
      message.className = "err";
      message.textContent = e.message || "Impossible de charger la vitrine.";
    }
  }

  $("#agency-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#agency-settings-msg");
    const button = $("#agency-settings-save");
    const form = $("#agency-settings-form");
    message.className = "";
    message.textContent = "";
    button.disabled = true;
    try {
      const body = Object.fromEntries(
        [...form.elements]
          .filter((element) => element.name && element.name !== "pickupLocations")
          .map((element) => [element.name, element.value.trim()])
      );
      body.babySeatDaily = Number(body.babySeatDaily);
      body.pickupLocations = form.elements.namedItem("pickupLocations").value
        .split(/\r?\n/)
        .map((location) => location.trim())
        .filter(Boolean);
      await api("/api/admin/agency-settings", { method: "PATCH", body });
      message.className = "ok";
      message.textContent = "Vitrine de l'agence enregistrée.";
    } catch (e) {
      message.className = "err";
      message.textContent = e.message || "Impossible d'enregistrer la vitrine.";
    } finally {
      button.disabled = false;
    }
  });

  $("#pw-save").addEventListener("click", async () => {
    const message = $("#pw-msg");
    const button = $("#pw-save");
    message.className = "";
    message.textContent = "";
    button.disabled = true;
    try {
      if (!$("#pw-cur").value) throw new Error("Saisissez votre mot de passe actuel.");
      if (!$("#pw-new").value) throw new Error("Saisissez un nouveau mot de passe.");
      await api("/api/admin/password", {
        method: "POST",
        body: { current: $("#pw-cur").value, next: $("#pw-new").value },
      });
      message.className = "ok";
      message.textContent = "Mot de passe modifié.";
      $("#pw-cur").value = $("#pw-new").value = "";
    } catch (e) {
      message.className = "err";
      message.textContent = e.message || "Impossible de modifier le mot de passe.";
    } finally {
      button.disabled = false;
    }
  });

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const { user } = await api("/api/admin/me");
      if (!user || !user.username) {
        location.replace("/admin/login");
        return;
      }
      if (
        window.LCAdmin?.mode === "supabase" &&
        ["owner", "admin"].includes(user.role)
      ) {
        $("#agency-settings-panel").classList.remove("hide");
      }
      if ($("#who")) $("#who").textContent = user.username;
      await Promise.all([loadStats(), loadReservations()]);
    } catch (_) {
      location.replace("/admin/login");
    }
  }
  boot();
})();