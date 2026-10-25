const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));


const THEME_TOGGLE = `<button type="button" data-theme-toggle class="btn ghost" aria-pressed="false" title="Passer en thème clair"><span data-icone>☾</span></button>`;

const loginShell = (body) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Administration — Gestion de location</title>
<link rel="stylesheet" href="/admin-assets/admin.css">
<script src="/runtime-config.js"></script>
<script src="/admin-assets/admin-config.js"></script>
<script src="/vendor/supabase.js"></script>
<script src="/admin-assets/theme.js"></script></head>
<body><div class="wrap login">${body}</div></body></html>`;

export const loginPage = (needsSetup) =>
  loginShell(`
    <div class="login__card panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="brand"><span class="brand__mark">GL</span>Gestion de location</div>
        ${THEME_TOGGLE}
      </div>
      <h1>Connexion</h1>
      <p class="sub">Espace d'administration de la location.</p>
      <div id="msg"></div>
      <form id="f" autocomplete="on">
        <label for="u">Adresse e-mail</label>
        <input id="u" name="username" type="email" autocomplete="username" required autofocus
               placeholder="vous@exemple.ma">
        <label for="p">Mot de passe</label>
        <input id="p" name="password" type="password" autocomplete="current-password" required>
        <button class="primary" style="width:100%;margin-top:20px" type="submit">
          Se connecter
        </button>
      </form>
      <p class="faint" style="margin-top:20px;text-align:center">
        Session limitée à 12 heures. <a href="/" style="color:var(--red)">Retour au site</a>
      </p>
    </div>
    <script src="/admin-assets/login.js"></script>
  `);

const adminShell = () => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Administration — Gestion de location</title><link rel="stylesheet" href="/admin-assets/admin.css">
<script src="/runtime-config.js"></script>
<script src="/admin-assets/admin-config.js"></script>
<script>
(function () {
  var cfg = window.LCAdminConfig || {};
  if (cfg.source === "supabase") {
    var raw = localStorage.getItem("lc_admin_session");
    if (!raw) {
      location.replace("/admin/login");
      return;
    }
    try {
      var sess = JSON.parse(raw);
      if (!sess || !sess.access_token) {
        location.replace("/admin/login");
        return;
      }
    } catch (e) {
      location.replace("/admin/login");
      return;
    }
  }
})();
</script>
<script src="/admin-assets/theme.js"></script></head>
<body>
<header class="top"><div class="wrap">
  <div class="brand"><span class="brand__mark">GL</span>Gestion de location <span class="pill">admin</span></div>
  <div class="row" style="margin-left:auto">
    <span class="faint" id="who"></span>
    <a class="btn ghost" href="/" target="_blank">Voir le site</a>
    ${THEME_TOGGLE}
  </div>
</div></header>

<div class="shell">
  <nav class="side" id="side" aria-label="Menu principal">
    <div class="side__group">Pilotage</div>
    <a data-tab="res" class="on"><span class="ic">▤</span> Réservations <span class="badge" id="side-badge"></span></a>
    <a data-tab="sta"><span class="ic">◧</span> Statistiques</a>
    <a data-tab="cli"><span class="ic">☺</span> Clients</a>
    <div class="side__group"> exploitation</div>
    <a data-tab="veh"><span class="ic">▣</span> Flotte</a>
    <a data-tab="mnt"><span class="ic">✚</span> Maintenance</a>
    <div class="side__group">Compte</div>
    <a data-tab="set"><span class="ic">⚙</span> Réglages</a>
    <div class="side__foot">
      <button id="logout"><span class="ic">⏻</span> Déconnexion</button>
    </div>
  </nav>

  <main class="wrap">
    <div id="msg"></div>
    <div id="crumb" class="faint" style="margin:18px 0 -6px"></div>

    <section id="tab-res">
      <h1>Réservations</h1>
      <p class="sub">Les demandes envoyées depuis le site. Ouvrez une réservation confirmée pour accéder au dossier complet.</p>
      <div class="cards" id="stats"></div>
      <div class="toolbar">
        <select id="fstatus">
          <option value="">Tous les statuts</option>
          <option value="nouvelle">Nouvelle</option>
          <option value="confirmee">Confirmée</option>
          <option value="annulee">Annulée</option>
          <option value="livree">Livrée</option>
        </select>
        <button id="refresh">Actualiser</button>
        <button class="primary" id="rnew" style="margin-left:auto">+ Nouvelle réservation</button>
      </div>
      <div class="panel panel--table"><table>
        <thead><tr>
          <th>Réf. · reçue</th><th>Client</th><th>Téléphone</th>
          <th>Véhicule</th><th>Dates</th><th class="num">Total</th><th class="num">Reste</th><th>Statut</th><th></th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table><div id="rempty" class="empty hide">
        <b>Aucune réservation</b>Les demandes envoyées depuis le site apparaîtront ici.
      </div></div>
    </section>

    <section id="tab-sta" class="hide">
      <h1>Statistiques</h1>
      <p class="sub">Rendement de chaque voiture. Seules les réservations confirmées et livrées comptent
        comme chiffre d'affaires ; la période se base sur la date de prise en charge.</p>
      <div class="toolbar">
        <select id="sta-periode">
          <option value="all">Tout l'historique</option>
          <option value="month">Ce mois-ci</option>
          <option value="year">Cette année</option>
          <option value="last">L'année dernière</option>
          <option value="custom">Période précise…</option>
        </select>
        <span id="sta-custom" class="row hide">
          <input id="sta-from" type="date"><span class="faint">→</span><input id="sta-to" type="date">
        </span>
        <button id="sta-refresh">Actualiser</button>
        <button class="ghost" id="sta-export" style="margin-left:auto">Exporter en CSV</button>
      </div>
      <div class="cards" id="sta-global"></div>
      <div class="panel panel--table"><table>
        <thead><tr>
          <th>Véhicule</th><th class="num">Locations</th><th class="num">Jours loués</th>
          <th class="num">CA</th><th class="num">Encaissé</th><th class="num">Reste dû</th>
          <th class="num">Prix moyen /j</th><th>Part du CA</th><th class="num">Annulées</th>
        </tr></thead>
        <tbody id="sta-rows"></tbody>
      </table><div id="sta-empty" class="empty hide">
        <b>Aucune location sur cette période</b>Changez de période ou confirmez des réservations.
      </div></div>
    </section>

    <section id="tab-cli" class="hide">
      <h1>Clients</h1>
      <p class="sub">La fiche client : identité, contact et documents. Sert à retrouver un conducteur sans le ressaisir.</p>
      <div class="toolbar">
        <input id="cq" placeholder="Rechercher : nom, téléphone, CIN, passeport…">
        <select id="ctype">
          <option value="">Tous les types</option>
          <option value="particulier">Particulier</option>
          <option value="professionnel">Professionnel</option>
          <option value="entreprise">Entreprise</option>
        </select>
        <button id="crefresh">Actualiser</button>
        <button class="primary" id="cnew" style="margin-left:auto">+ Nouveau client</button>
      </div>
      <div class="panel panel--table"><table>
        <thead><tr>
          <th>Nom</th><th>Type</th><th>Téléphone</th><th>Email</th>
          <th>Permis</th><th>CIN</th><th>Nationalité</th><th></th>
        </tr></thead>
        <tbody id="crows"></tbody>
      </table><div id="cempty" class="empty hide">
        <b>Aucun client enregistré</b>Créez une fiche pour ne plus ressaisir un conducteur.
      </div></div>
    </section>

    <section id="tab-veh" class="hide">
      <h1>Flotte</h1>
      <p class="sub">Ces véhicules sont servis à <code>/api/vehicles</code> et affichés sur le site public.</p>
      <div class="row" style="margin-bottom:14px">
        <button class="primary" id="new-veh">+ Nouveau véhicule</button>
      </div>
      <div id="veh-list"></div>
    </section>

    <section id="tab-avail" class="hide">
      <h1>Indisponibilités</h1>
      <p class="sub">Bloque une période pour un véhicule. Le prix ne s'affiche plus sur ces dates si la période bloque.</p>
      <div class="panel">
        <div class="grid3">
          <div><label>Véhicule</label><select id="bl-veh"></select></div>
          <div><label>Du</label><input id="bl-start" type="date"></div>
          <div><label>Au</label><input id="bl-end" type="date"></div>
        </div>
        <label>Motif (facultatif)</label>
        <input id="bl-reason" placeholder="Ex : entretien, location longue…">
        <div class="row" style="margin-top:14px"><button class="primary" id="bl-add">Bloquer</button></div>
      </div>
      <div class="panel"><table>
        <thead><tr><th>Véhicule</th><th>Du</th><th>Au</th><th>Motif</th><th></th></tr></thead>
        <tbody id="bl-rows"></tbody>
    </table></div>
    </section>

    <section id="tab-mnt" class="hide">
      <h1>Maintenance</h1>
      <p class="sub">Échéances à tenir pour chaque voiture : vignette, assurance, contrôle technique, vidange…
        Quand vous cliquez sur « Fait », l'échéance suivante se reprogramme toute seule.</p>
      <div class="cards" id="mnt-cards"></div>
      <div class="toolbar">
        <select id="mnt-veh">
          <option value="">Tous les véhicules</option>
        </select>
        <select id="mnt-kind">
          <option value="">Tous les types</option>
        </select>
        <button id="mnt-refresh">Actualiser</button>
        <button class="primary" id="mnt-new" style="margin-left:auto">+ Nouveau suivi</button>
      </div>
      <div class="panel panel--table"><table>
        <thead><tr>
          <th>Véhicule</th><th>Type</th><th>Échéance</th><th>Dans</th>
          <th>Dernier</th><th class="num">Coût</th><th>Cycle</th><th></th>
        </tr></thead>
        <tbody id="mnt-rows"></tbody>
      </table><div id="mnt-empty" class="empty hide">
        <b>Aucun suivi</b>Ajoutez la vignette, l'assurance et la vidange de vos voitures pour ne plus
        dépasser une échéance.
      </div></div>
    </section>

    <section id="tab-set" class="hide">
      <h1>Réglages</h1>
      <p class="sub">Changer le mot de passe de l'administrateur.</p>
      <div class="panel" style="max-width:420px">
        <label>Mot de passe actuel</label><input id="pw-cur" type="password" autocomplete="current-password">
        <label>Nouveau mot de passe</label><input id="pw-new" type="password" autocomplete="new-password">
        <div class="row" style="margin-top:14px"><button class="primary" id="pw-save">Enregistrer</button></div>
        <div id="pw-msg" role="status" aria-live="polite" style="margin-top:12px"></div>
      </div>
      <div id="agency-settings-panel" class="hide">
        <h2>Vitrine de l'agence</h2>
        <p class="sub">Ces informations apparaissent sur le site public de cette agence.</p>
        <form id="agency-settings-form" class="panel" style="max-width:720px">
          <label for="agency-brand">Nom affiché</label><input id="agency-brand" name="brand" maxlength="80" required>
          <label for="agency-tagline">Activité (sous le nom)</label><input id="agency-tagline" name="tagline" maxlength="120">
          <label for="agency-city">Ville</label><input id="agency-city" name="city" maxlength="100">
          <div class="grid2">
            <div><label for="agency-phone">Téléphone principal</label><input id="agency-phone" name="phonePrimary" maxlength="40"></div>
            <div><label for="agency-phone-tel">Numéro d'appel principal</label><input id="agency-phone-tel" name="phonePrimaryTel" maxlength="40"></div>
            <div><label for="agency-phone-secondary">Téléphone secondaire</label><input id="agency-phone-secondary" name="phoneSecondary" maxlength="40"></div>
            <div><label for="agency-phone-secondary-tel">Numéro d'appel secondaire</label><input id="agency-phone-secondary-tel" name="phoneSecondaryTel" maxlength="40"></div>
          </div>
          <label for="agency-address">Adresse</label><input id="agency-address" name="address" maxlength="200">
          <label for="agency-maps">Lien Google Maps (facultatif)</label><input id="agency-maps" name="mapsUrl" type="url" maxlength="500">
          <label for="agency-hours">Horaires</label><input id="agency-hours" name="hours" maxlength="120">
          <label for="agency-pickup">Lieux de prise en charge (un par ligne)</label>
          <textarea id="agency-pickup" name="pickupLocations" rows="5" maxlength="5000"></textarea>
          <label for="agency-baby-seat">Supplément siège bébé par jour (MAD; 0 = non proposé)</label>
          <input id="agency-baby-seat" name="babySeatDaily" type="number" min="0" max="5000" step="1">
          <div class="row" style="margin-top:14px"><button class="primary" id="agency-settings-save">Enregistrer la vitrine</button></div>
          <div id="agency-settings-msg" role="status" aria-live="polite" style="margin-top:12px"></div>
        </form>
      </div>
    </section>

    <section id="tab-dos" class="hide">
      <div id="dos"></div>
    </section>

    <div class="sheet" id="sheet" hidden aria-hidden="true">
      <div class="sheet__scrim" data-sheet-close></div>
      <aside class="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header class="sheet__head">
          <b id="sheet-title"></b>
          <span class="faint" id="sheet-sub"></span>
          <button type="button" class="sheet__x" data-sheet-close aria-label="Fermer">✕</button>
        </header>
        <div class="sheet__body" id="sheet-body"></div>
        <footer class="sheet__foot" id="sheet-foot" hidden></footer>
      </aside>
    </div>
  </main>
</div>
<script src="/admin-assets/admin-config.js"></script>
<script src="/vendor/supabase.js"></script>
<script src="/shared/date-utils.js"></script>
<script src="/admin-assets/admin-api.js"></script>
<script src="/admin-assets/signature-pad.js"></script>
<script src="/admin-assets/admin.js"></script>
</body></html>`;

export { esc, adminShell };