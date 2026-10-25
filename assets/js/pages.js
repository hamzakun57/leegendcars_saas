/* Leegend Cars — rendu des pages (templates) */
(function () {
  const D = window.DATA;
  const I = window.Icons;
  const { CFG, wa, escapeHtml } = D;
  const phoneLink = (value) => String(value || "").replace(/[^\d+().-]/g, "");
  const mapsLink = () => {
    try {
      const url = new URL(CFG.mapsUrl);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  /* ---------- helpers ---------- */
  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  const breadcrumb = (last, parent) => {
    let out = '<nav class="breadcrumb" aria-label="Fil d\'Ariane"><a href="#/">Accueil</a>';
    if (parent) out += `<span class="sep">/</span><a href="${parent.href}">${parent.label}</a>`;
    out += `<span class="sep">/</span><span>${last}</span></nav>`;
    return out;
  };

  const callBtn = (label, cls) =>
    `<a class="btn ${cls || "btn--primary"}" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()}${label ||
      ` Appeler ${escapeHtml(CFG.phonePrimary)}`}</a>`;

  /* Un véhicule saisi au back-office peut n'avoir aucune photo : sans garde-fou,
     la page produisait « <img src="undefined"> » et une icône cassée. Le visuel
     de remplacement reprend la teinte de la carte au lieu d'afficher du vide. */
  const PHOTO_VIDE =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
        <defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1c1917"/><stop offset="1" stop-color="#0c0a09"/>
        </linearGradient></defs>
        <rect width="800" height="500" fill="url(#f)"/>
        <g fill="none" stroke="#78716c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".55">
          <path d="M212 322h376M244 322l22-58c6-16 21-26 38-26h192c17 0 32 10 38 26l22 58"/>
          <path d="M262 264h276M318 238v-24h164v24"/>
          <circle cx="300" cy="338" r="26"/><circle cx="500" cy="338" r="26"/>
        </g>
        <text x="400" y="420" text-anchor="middle" fill="#a8a29e" font-family="system-ui,sans-serif" font-size="22" opacity=".7">Photo à venir</text>
      </svg>`,
    );

  const photo = (v, index) => (v.gallery && v.gallery[index]) || PHOTO_VIDE;

  const ctaBand = (o) => `
    <div class="cta-band" data-reveal>
      <h2>${o.title}</h2>
      <p>${o.text}</p>
      <div class="btn-row">
        ${o.primary}
        ${o.secondary || ""}
      </div>
      ${o.note ? `<p class="note">${o.note}</p>` : ""}
    </div>`;

  const vehicleCard = (v) => `
    <article class="vehicle" data-reveal>
      <div class="vehicle__glow" style="background:${v.accent}"></div>
      <span class="badge badge--top vehicle__badge-tech">${v.transmission}</span>
      <div class="vehicle__media">
        <img src="${photo(v, 0)}" alt="${v.name} — location de voiture" loading="lazy" />
      </div>
      <div class="vehicle__body">
        <h3 class="vehicle__name">${v.name}</h3>
        <p class="vehicle__tag">${v.tagline}</p>
        <div class="vehicle__specs">
          <span class="vehicle__spec">${I.users()} ${v.seats} places</span>
          <span class="vehicle__spec">${I.gear()} ${v.transmission}</span>
          <span class="vehicle__spec">${I.fuel()} ${v.fuel}</span>
        </div>
        <div class="vehicle__price">
          <div>
            <small>À partir de</small>
            <b>${money(v.priceFrom)} <i>MAD</i></b>
          </div>
          <span class="note">≈ ${v.approx} € / jour</span>
        </div>
        <p class="deposit-line">Caution : <b>${money(v.deposit)} MAD</b></p>
        <a class="btn btn--ghost vehicle__cta" href="#/vehicules/${v.slug}" aria-label="Voir la page de la ${v.name}">
          Voir le véhicule ${I.arrowRight()}
        </a>
      </div>
    </article>`;

  const faqList = (items) =>
    `<div class="faq-list">${items
      .map(
        (f, i) => `
      <details class="faq-item" ${i === 0 ? "open" : ""} data-reveal>
        <summary>${f.q}</summary>
        <div class="faq-item__body">${f.a}</div>
      </details>`
      )
      .join("")}</div>`;

  /* ---------- reservation form ---------- */
  const reservationForm = (vehicle) => {
    const countries = D.COUNTRY_CODES.map(
      (c, i) =>
        `<option value="${c.code}" ${i === 0 ? "selected" : ""}>${c.label}</option>`
    ).join("");
const locations = (selected) =>
      D.PICKUP_LOCATIONS.map(
        (l) => `<option value="${escapeHtml(l)}" ${l === selected ? "selected" : ""}>${escapeHtml(l)}</option>`
      ).join("");
    return `
    <form class="rform" data-rform data-vehicle="${vehicle.name}" data-slug="${vehicle.slug}" data-price="${vehicle.priceFrom}" novalidate data-reveal>
      <div>
        <h2>Demande de réservation</h2>
        <p class="rform__intro">Cette demande sert uniquement à vérifier la disponibilité et vous communiquer le tarif final. Aucun paiement en ligne.</p>
      </div>

      <div class="rform__honeypot" aria-hidden="true">
        <label for="lc-bot">Ne remplissez pas ce champ</label>
        <input type="text" id="lc-bot" name="botcheck" tabindex="-1" autocomplete="off" />
      </div>

      <fieldset>
        <legend>Informations du conducteur</legend>
        <div class="rform__row">
          <div class="field">
            <label for="rf-first">Prénom <span>*</span></label>
            <input id="rf-first" name="firstName" type="text" placeholder="Ex : John" autocomplete="given-name" required />
          </div>
          <div class="field">
            <label for="rf-last">Nom <span>*</span></label>
            <input id="rf-last" name="lastName" type="text" placeholder="Ex : Smith" autocomplete="family-name" required />
          </div>
        </div>
        <div class="rform__row">
          <div class="field">
            <label for="rf-country">Indicatif international <span>*</span></label>
            <select id="rf-country" name="countryCode">${countries}</select>
          </div>
          <div class="field">
            <label for="rf-phone">Téléphone portable <span>*</span></label>
            <input id="rf-phone" name="phone" type="tel" placeholder="Ex : 6 12 34 56 78" autocomplete="tel" required />
          </div>
        </div>
        <div class="rform__row">
          <div class="field">
            <label for="rf-licence">Numéro de permis <span>*</span></label>
            <input id="rf-licence" name="licenceNumber" type="text" placeholder="Ex : AB123456" autocomplete="off" required />
          </div>
          <div class="field">
            <label for="rf-licence-date">Date de délivrance du permis <span>*</span></label>
            <input id="rf-licence-date" name="licenceDate" type="date" required />
          </div>
        </div>
        <div class="field">
          <label for="rf-passport">Numéro de passeport (facultatif)</label>
          <input id="rf-passport" name="passport" type="text" placeholder="Si vous n'avez pas de permis marocain" autocomplete="off" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Détails de la réservation</legend>
        <div class="rform__row">
          <div class="field">
            <label for="rf-pickup">Lieu de prise en charge <span>*</span></label>
            <select id="rf-pickup" name="pickup" required>${locations(D.PICKUP_LOCATIONS[0])}</select>
          </div>
          <div class="field">
            <label for="rf-return">Lieu de retour <span>*</span></label>
            <select id="rf-return" name="ret" required>${locations(D.PICKUP_LOCATIONS[0])}</select>
          </div>
        </div>
        <p class="rform__notice" data-rform-oneway hidden>Retour dans une autre ville : un supplément aller-retour sera ajouté au tarif final.</p>
        <div class="rform__row">
          <div class="field">
            <label for="rf-pdate">Date prise en charge <span>*</span></label>
            <input id="rf-pdate" name="pickupDate" type="date" required />
          </div>
          <div class="field">
            <label for="rf-ptime">Heure prise en charge <span>*</span></label>
            <input id="rf-ptime" name="pickupTime" type="time" value="10:00" required />
          </div>
        </div>
        <div class="rform__row">
          <div class="field">
            <label for="rf-rdate">Date retour <span>*</span></label>
            <input id="rf-rdate" name="returnDate" type="date" required />
          </div>
          <div class="field">
            <label for="rf-rtime">Heure retour <span>*</span></label>
            <input id="rf-rtime" name="returnTime" type="time" value="10:00" required />
          </div>
        </div>
        <div class="rform__row">
          <div class="field">
            <label for="rf-seat">Siège bébé</label>
            <select id="rf-seat" name="babySeat">
              <option value="0" selected>Sans siège bébé</option>
              ${D.BABY_SEAT_DAILY > 0 ? `<option value="${D.BABY_SEAT_DAILY}">Avec siège bébé (${D.BABY_SEAT_DAILY} MAD / jour)</option>` : ""}
            </select>
          </div>
        </div>

        <div class="rtotal" data-rform-total>
          <div class="rtotal__row"><span>Durée</span><b data-rtotal-days>—</b></div>
          <div class="rtotal__row"><span>Tarif journalier</span><b data-rtotal-daily>—</b></div>
          <div class="rtotal__row" data-rtotal-seat-row hidden><span>Siège bébé</span><b data-rtotal-seat>—</b></div>
          <div class="rtotal__row rtotal__row--total"><span>Total estimé</span><b data-rtotal-total>—</b></div>
          <p class="rtotal__hint">Estimation automatique selon vos dates. Le tarif final vous sera confirmé par téléphone.</p>
        </div>
      </fieldset>

      <fieldset>
        <legend>Remarques client</legend>
        <div class="field field--full">
          <label for="rf-notes">Informations complémentaires (facultatif)</label>
          <textarea id="rf-notes" name="notes" placeholder="Numéro de vol, heure d'arrivée, hôtel, siège enfant, deuxième conducteur…"></textarea>
        </div>
      </fieldset>

      <p class="note">Nous confirmons rapidement la disponibilité et le tarif final par téléphone.</p>
      <div data-form-alert></div>
      <button class="btn btn--primary btn--block btn--lg" type="submit">Envoyer la demande</button>
      <p class="rform__legal">Tarif indicatif. Le prix final dépend des dates et de la durée de location. Cette demande ne constitue pas une réservation automatique. Votre demande est enregistrée et transmise directement à l'équipe ${escapeHtml(CFG.brand)}.</p>
    </form>`;
  };

  /* ================= ACCUEIL ================= */
  const home = () => `
    <section class="hero" id="accueil">
      <div class="hero__media">
        <picture>
          <source media="(max-width: 767px)" srcset="mobile_background.jpg" />
          <img src="pc_background.jpg" alt="${escapeHtml(CFG.brand)}, service de location de voitures" />
        </picture>
        <div class="hero__overlay"></div>
      </div>
      <div class="container hero__inner">
        <span class="hero__eyebrow"><span class="hero__pulse"></span> Location de voiture · Demande en ligne</span>
        <h1 class="hero__title">Location de voiture <br /><span>simple et claire.</span></h1>
        <p class="hero__sub">Consultez les véhicules disponibles et envoyez votre demande en quelques minutes. L'agence vous confirme les dates et le tarif avant validation.</p>
        <div class="hero__actions">
          <a class="btn btn--ghost btn--lg" href="#/vehicules">Voir la flotte ${I.arrowRight()}</a>
        </div>
        <div class="hero__stats">
          <div class="hero__stat"><b>Flotte</b><span>Véhicules disponibles</span></div>
          <div class="hero__stat"><b>En ligne</b><span>Demande de réservation</span></div>
          <div class="hero__stat"><b>Direct</b><span>Contact avec l'agence</span></div>
          <div class="hero__stat"><b>Clair</b><span>Tarif confirmé avant validation</span></div>
        </div>
      </div>
      <a class="hero__scroll" href="#/vehicules" data-scroll="vehicules" aria-label="Voir les véhicules">Découvrir ${I.arrowDown()}</a>
    </section>

    <section class="section" id="vehicules">
      <div class="container">
        <div class="section__head" data-reveal>
          <span class="eyebrow">Notre flotte</span>
          <h2 class="section__title">Choisissez votre véhicule</h2>
          <p class="section__sub">Découvrez les véhicules de l'agence et consultez les informations et tarifs affichés pour chacun.</p>
        </div>
        <div class="vehicles">${D.VEHICLES.length ? D.VEHICLES.map(vehicleCard).join("") : emptyFleet()}</div>
        <div class="vehicles__more" data-reveal>
          <a class="btn btn--ghost" href="#/vehicules">Voir tous nos véhicules ${I.arrowRight()}</a>
        </div>
      </div>
    </section>

    <section class="section section--alt trust" id="prix">
      <div class="container">
        <div class="trust__grid">
          <div data-reveal>
            <span class="eyebrow">Pourquoi ${escapeHtml(CFG.brand)}</span>
            <h2 class="section__title">Une agence locale, des engagements clairs.</h2>
            <p class="trust__lead">On garde la conversation simple : un interlocuteur unique, des prix écrits avant de réserver, et une voiture qui correspond exactement à ce qui a été annoncé.</p>
            <div class="btn-row" style="margin-top:var(--space-6)">
              <a class="btn btn--primary" href="#/vehicules">${I.arrowRight()} Réserver maintenant</a>
            </div>
          </div>
          <div class="trust__list">
            ${D.TRUST.map(
              (t, i) => `
              <div class="trust__item" data-reveal data-reveal-delay="${i + 1}">
                <span class="card__icon">${I[t.icon]()}</span>
                <h3 class="card__title">${t.title}</h3>
                <p class="card__text">${t.text}</p>
              </div>`
            ).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="process">
      <div class="container">
        <div class="section__head section__head--center" data-reveal>
          <span class="eyebrow">Comment ça se passe</span>
          <h2 class="section__title">De la réservation à la voiture, en 3 étapes.</h2>
          <p class="section__sub">Aucun paiement en ligne. Vous ne versez une avance qu'après confirmation écrite de votre réservation.</p>
        </div>
        <div class="steps">
          ${D.PROCESS.map(
            (s, i) => `
            <div class="step" data-reveal data-reveal-delay="${i + 1}">
              <div class="step__top">
                <span class="step__num">${s.num}</span>
                <span class="step__dur">${s.dur}</span>
              </div>
              <h3 class="step__title">${s.title}</h3>
              <p class="step__text">${s.text}</p>
            </div>`
          ).join("")}
        </div>
        <div class="process__cta" data-reveal>
          <a class="btn btn--primary btn--lg" href="#/vehicules">${I.arrowRight()} Réserver maintenant</a>
          <p class="note">L'agence vous contactera pour confirmer votre demande.</p>
        </div>
      </div>
    </section>

    <section class="section section--alt local" id="aeroports">
      <div class="container">
        <div class="local__grid">
          <div class="local__text" data-reveal>
            <span class="eyebrow">Aéroports & livraison</span>
            <h2 class="section__title">Une prise en charge organisée selon vos besoins.</h2>
            <p>${escapeHtml(CFG.brand)} vous accompagne avec un service simple et transparent. Indiquez le lieu de prise en charge souhaité dans votre demande; l'agence vous confirmera les modalités et les éventuels frais avant validation.</p>
            <p>Les conditions, le tarif et les détails de remise du véhicule vous sont confirmés directement par l'agence.</p>
            <div class="btn-row" style="margin-top:var(--space-6)">
<a class="btn btn--primary" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} Appeler ${escapeHtml(CFG.phonePrimary)}</a>
              <a class="btn btn--ghost" href="#/aeroports">Détails aéroports ${I.arrowRight()}</a>
            </div>
          </div>
          <div class="local__cards">
            ${[
              {
                t: "Prise en charge",
                d: "Le lieu et l'horaire sont confirmés avec vous avant la validation de la demande.",
              },
              {
                t: "Une flotte adaptée",
                d: "Consultez les véhicules, leurs caractéristiques et les tarifs disponibles sur le site.",
              },
              {
                t: "Zones de prise en charge",
                d: "Les lieux de remise du véhicule sont convenus directement avec l'agence.",
              },
            ]
              .map(
                (c, i) => `
              <div class="local__card" data-reveal data-reveal-delay="${i + 1}">
                <b class="num">0${i + 1}</b>
                <div>
                  <h3>${c.t}</h3>
                  <p>${c.d}</p>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="guide">
      <div class="container">
        <div class="section__head" data-reveal>
          <span class="eyebrow">Guide</span>
          <h2 class="section__title">Guide de location de voiture.</h2>
          <p class="section__sub">Les points à vérifier avant d'envoyer votre demande de location.</p>
        </div>
        <div class="guide">
          ${D.GUIDE.map(
            (g, i) => `
            <article class="guide__card" ${g.span ? 'data-span="2"' : ""} data-reveal data-reveal-delay="${(i % 3) + 1}">
              <h3>${g.title}</h3>
              <p>${g.text}</p>
            </article>`
          ).join("")}
        </div>
        <div class="process__cta" style="margin-top:var(--space-10)" data-reveal>
          <p class="note">La réservation n'est confirmée qu'après validation par l'agence.</p>
        </div>
      </div>
    </section>

    <section class="section section--alt" id="faq">
      <div class="container container--narrow">
        <div class="section__head section__head--center" data-reveal>
          <span class="eyebrow">FAQ</span>
          <h2 class="section__title">Questions fréquentes</h2>
          <p class="section__sub">Documents, âge, assurance, caution, livraison à l'aéroport : tout ce qu'il faut savoir avant de louer chez ${escapeHtml(CFG.brand)}.</p>
        </div>
        ${faqList(D.HOME_FAQ)}
        <div class="process__cta" style="margin-top:var(--space-8)" data-reveal>
          <a class="btn btn--ghost" href="#/faq">Voir toute la FAQ ${I.arrowRight()}</a>
        </div>
      </div>
    </section>`;

  /* ================= FLOTTE ================= */
  const vehiclesIndex = () => `
    <section class="page">
      <div class="container">
        ${breadcrumb("Véhicules")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">Notre flotte</span>
          <h1>Tous nos véhicules</h1>
          <p class="lead">Consultez les véhicules proposés par l'agence et leurs caractéristiques. Les prix et conditions sont confirmés selon vos dates avant validation.</p>
        </div>
        <div class="vehicles">${D.VEHICLES.length ? D.VEHICLES.map(vehicleCard).join("") : emptyFleet()}</div>
      </div>
    </section>`;

  /* Le parc peut être vide : l'agence n'a pas encore saisi ses voitures.
     Préférer un message honnête à une page vide ou à des véhicules de
     démonstration qui n'existent pas. */
  /* Deux situations très différentes se cachent derrière la même page vide :
     une agence qui n'a encore saisi aucune voiture, et un site qui n'a pas
     réussi à joindre la base. La seconde affichait jusqu'ici « notre flotte est
     en cours de mise à jour » — un mensonge qui fait perdre des clients et
     masque la panne. On distingue donc les deux, et on dit ce qui bloque. */
  const echecFlotte = () =>
    typeof D.FLETTE_ERREUR === "string" && D.FLETTE_ERREUR
      ? `<div class="empty-fleet empty-fleet--erreur"${D.FLETTE_DETAIL ? ` title="${D.FLETTE_DETAIL}"` : ""}>
      <b>Impossible de charger nos véhicules</b>
      ${D.FLETTE_ERREUR}<br />
      Rechargez la page, ou écrivez-nous en attendant.
    </div>`
      : "";

  const emptyFleet = () =>
    echecFlotte() ||
    `<div class="empty-fleet">
      <b>Aucun véhicule disponible pour le moment</b>
      Notre flotte est en cours de mise à jour. Écrivez-nous, nous vous dirons
      ce que nous avons en garage.
    </div>`;

  /* ================= DÉTAIL VÉHICULE ================= */
  const vehicleDetail = (slug) => {
    const v = D.VEHICLES.find((x) => x.slug === slug);
    if (!v) return null;
    const thumbs = (v.gallery || [])
      .map(
        (g, i) =>
          `<button type="button" class="${i === 0 ? "is-active" : ""}" data-thumb="${g}" aria-label="Image ${i + 1}"><img src="${g}" alt="${v.name} vue ${i + 1}" loading="lazy" /></button>`
      )
      .join("");

    return `
    <section class="page">
      <div class="container">
        ${breadcrumb(v.name, { label: "Véhicules", href: "#/vehicules" })}
        <div class="vdetail">
          <div class="vinfo">
            <div class="vgallery" data-reveal>
              <div class="vgallery__glow" style="background:${v.accent}"></div>
              <span class="vgallery__chip">dès <b>${money(v.priceFrom)} MAD</b> / jour</span>
              <span class="vgallery__deposit">Caution : <b>${money(v.deposit)} MAD</b></span>
              <img class="vgallery__main" src="${photo(v, 0)}" alt="${v.name} — location" />
            </div>
            <div class="vthumbs" data-thumbs>${thumbs}</div>

            <div class="vhead" data-reveal>
              <p class="vinfo__tag">${v.tagline}</p>
              <h1>${v.name}</h1>
              <div class="vchips">
                <span>${I.users()} ${v.seats} places</span>
                <span>${I.gear()} ${v.transmission}</span>
                <span>${I.door()} ${v.doors} portes</span>
                <span>${I.fuel()} ${v.fuel}</span>
                <span>${I.snow()} Climatisation</span>
              </div>
            </div>

            <div class="vdesc vinfo__desc" data-reveal>
                ${v.description.map((p) => `<p>${p}</p>`).join("")}
              </div>

              <div class="vblock videal" data-reveal>
                <h2>Idéale pour :</h2>
                <ul class="ideal-list">
                  ${v.idealFor.map((x) => `<li>${I.checkCircle()} ${x}</li>`).join("")}
                </ul>
              </div>

              <div class="vblock vfaq" data-reveal>
                <h2>À savoir avant de réserver</h2>
                ${faqList(D.VEHICLE_FAQ)}
              </div>

              <div class="vblock vcta" data-reveal>
                ${ctaBand({
                  title: "Intéressé par la " + v.name + " ?",
                  text: "Envoyez une demande pour que l'agence confirme la disponibilité, le tarif et les conditions.",
                  primary: callBtn(" Demander par téléphone"),
                  note: "La demande ne confirme pas automatiquement la réservation.",
                })}
              </div>
          </div>

          <aside class="vaside">
            ${reservationForm(v)}
          </aside>
        </div>

        <div class="vblock" style="margin-top:var(--space-16)">
          <h2 data-reveal>Voitures similaires</h2>
          <div class="similar">
            ${D.VEHICLES.filter((x) => x.slug !== v.slug)
              .map(
                (x) => `
              <a class="card" href="#/vehicules/${x.slug}" data-reveal>
                <h3 class="card__title">${x.name}</h3>
                <p class="card__text">${money(x.priceFrom)} MAD / jour · caution ${money(x.deposit)} MAD · ${x.seats} places · ${x.transmission} · ${x.fuel}</p>
              </a>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>`;
  };

  /* ================= AÉROPORTS ================= */
  const airports = () => `
    <section class="page">
      <div class="container">
        ${breadcrumb("Prise en charge")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">Prise en charge à l'aéroport</span>
          <h1>Organisez une prise en charge à l'aéroport.</h1>
          <p class="lead">Indiquez l'aéroport et l'horaire souhaités. L'agence vous confirmera les possibilités de prise en charge et les frais éventuels avant validation.</p>
          <div class="btn-row">
            <a class="btn btn--primary btn--lg" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.plane()} Réserver la prise en charge</a>
            <a class="btn btn--ghost btn--lg" href="#/vehicules">Voir la flotte ${I.arrowRight()}</a>
          </div>
        </div>

        <div class="section__head" data-reveal>
          <span class="eyebrow">Comment ça marche</span>
          <h2 class="section__title">Du vol au volant, en 3 étapes.</h2>
        </div>
        <div class="steps">
          ${[
            {
              num: "01",
              dur: "Avant le vol",
              title: "Vous précisez votre demande",
              text: "Indiquez le lieu, l'horaire, les dates de location et le véhicule souhaité.",
            },
            {
              num: "02",
              dur: "Suivi du vol",
              title: "L'agence vérifie la demande",
              text: "L'agence confirme la disponibilité, le tarif et les modalités de prise en charge.",
            },
            {
              num: "03",
              dur: "Selon accord",
              title: "Prise en charge",
              text: "Le lieu et l'heure de remise sont convenus avec l'agence avant la réservation.",
            },
          ]
            .map(
              (s, i) => `
            <div class="step" data-reveal data-reveal-delay="${i + 1}">
              <div class="step__top">
                <span class="step__num">${s.num}</span>
                <span class="step__dur">${s.dur}</span>
              </div>
              <h3 class="step__title">${s.title}</h3>
              <p class="step__text">${s.text}</p>
            </div>`
            )
            .join("")}
        </div>

        <div class="section__head" style="margin-top:var(--space-16)" data-reveal>
          <span class="eyebrow">Avantages</span>
          <h2 class="section__title">Pourquoi notre livraison aéroport fait la différence</h2>
        </div>
        <div class="grid-4">
          ${[
            {
              i: "tag",
              t: "Lieu convenu",
              d: "La prise en charge est organisée selon les possibilités de l'agence.",
            },
            {
              i: "clock",
              t: "Modalités confirmées",
              d: "Les horaires et les frais éventuels sont précisés avant validation.",
            },
            {
              i: "truck",
              t: "Restitution simplifiée",
              d: "Vous rendez la voiture au même endroit, ou ailleurs sur demande.",
            },
            {
              i: "mapPin",
              t: "Contact direct",
              d: "Échangez avec l'agence pour organiser votre prise en charge.",
            },
          ]
            .map(
              (c, i) => `
            <div class="card" data-reveal data-reveal-delay="${i + 1}">
              <span class="card__icon">${I[c.i]()}</span>
              <h3 class="card__title">${c.t}</h3>
              <p class="card__text">${c.d}</p>
            </div>`
            )
            .join("")}
        </div>

        <div class="section__head" style="margin-top:var(--space-16)" data-reveal>
          <span class="eyebrow">Bonnes questions</span>
          <h2 class="section__title">Questions sur la livraison aéroport</h2>
        </div>
        ${faqList([
          {
            q: "Que se passe-t-il si mon vol a du retard ?",
            a: "Contactez l'agence dès que possible. Les ajustements et éventuels frais dépendent des conditions convenues.",
          },
          {
            q: "Où exactement on me retrouve à l'aéroport ?",
            a: `À la sortie du terminal Arrivées, juste après les douanes. Un agent ${escapeHtml(CFG.brand)} vous attend avec un panneau à votre nom. On vous envoie sa position exacte par téléphone dès votre atterrissage.`,
          },
          {
            q: "Puis-je rendre la voiture à l'aéroport au retour ?",
            a: "La restitution à l'aéroport peut être organisée selon les disponibilités et les frais confirmés par l'agence.",
          },
          {
            q: "Quel délai pour la prise en charge ?",
            a: "Le délai dépend du lieu et des modalités de remise convenus avec l'agence.",
          },
        ])}

        <div style="margin-top:var(--space-16)">
          ${ctaBand({
            title: "Vous souhaitez une prise en charge à l'aéroport ?",
            text: "Indiquez l'aéroport, les horaires et vos dates. L'agence vous confirmera les possibilités et les conditions.",
primary: `<a class="btn btn--primary" href="#/vehicules">${I.arrowRight()} Réserver maintenant</a>`,
            secondary: `<a class="btn btn--ghost" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} Appeler ${escapeHtml(CFG.phonePrimary)}</a>`,
          })}
        </div>
      </div>
    </section>`;

  /* ================= PRIX & PROMOS ================= */
  const pricing = () => `
    <section class="page">
      <div class="container">
        ${breadcrumb("Prix & promos")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">Tarifs & promotions</span>
          <h1>Consultez les tarifs des véhicules.</h1>
          <p class="lead">Les tarifs affichés sont indicatifs et peuvent dépendre des dates et de la durée. L'agence confirme le prix détaillé et les conditions avant validation.</p>
          <div class="btn-row">
            <a class="btn btn--primary btn--lg" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.tag()} Demander mon prix exact</a>
            <a class="btn btn--ghost btn--lg" href="#/vehicules">Voir les véhicules ${I.arrowRight()}</a>
          </div>
        </div>

        <div class="section__head" data-reveal>
          <span class="eyebrow">Nos tarifs</span>
          <h2 class="section__title">Des tarifs clairs, par véhicule.</h2>
          <p class="section__sub">Les tarifs et cautions sont affichés par véhicule. Contactez l'agence pour confirmer le montant applicable à votre demande.</p>
        </div>
        <div class="price-cards">
          ${D.VEHICLES.length
            ? D.VEHICLES.map(
                (v) => `
            <article class="price-card" data-reveal>
              <div class="price-card__media">
                <img src="${photo(v, 0)}" alt="${v.name}" loading="lazy" />
              </div>
              <div class="price-card__body">
                <span class="price-card__value">À partir de<b>${money(v.priceFrom)} MAD <i>/ jour</i></b></span>
                <p class="card__text">${v.tagline} · ≈ ${v.approx} €/jour</p>
                <p class="deposit-line">Caution : <b>${money(v.deposit)} MAD</b></p>
                <a class="btn btn--ghost btn--sm" href="#/vehicules/${v.slug}">Voir le détail ${I.arrowRight()}</a>
              </div>
            </article>`
              ).join("")
            : emptyFleet()}
        </div>

        <div class="section__head" style="margin-top:var(--space-16)" data-reveal>
          <span class="eyebrow">Inclus</span>
          <h2 class="section__title">Vérifiez les conditions avant de réserver</h2>
          <p class="section__sub">Les éléments inclus et les frais éventuels dépendent du véhicule et du contrat.</p>
        </div>
        <div class="included-grid">
          <div class="included included--in" data-reveal>
            <h3>${I.checkCircle()} À confirmer avec l'agence</h3>
            <ul>
              ${[
                "Couverture d'assurance et franchise",
                "Limites de kilométrage",
                "Lieu et frais de prise en charge",
                "Conditions d'assistance",
                "Politique de carburant",
                "Caution et moyens de paiement",
              ]
                .map((x) => `<li>${I.check()} ${x}</li>`)
                .join("")}
            </ul>
          </div>
          <div class="included included--out" data-reveal data-reveal-delay="1">
            <h3>${I.x()} À lire dans le contrat</h3>
            <ul>
              ${[
                "Frais et options éventuels",
                "Annulation et modification",
              ].map((x) => `<li>${I.x()} ${x}</li>`).join("")}
            </ul>
          </div>
        </div>

        <div style="margin-top:var(--space-16)">
          ${ctaBand({
            title: "Vous avez vos dates exactes ?",
            text: "Envoyez vos dates et le véhicule souhaité. L'agence vous communiquera la disponibilité, le tarif et les conditions.",
primary: callBtn(" Obtenir mon prix exact"),
          })}
        </div>
      </div>
    </section>`;

  /* ================= À PROPOS ================= */
  const about = () => `
    <section class="page">
      <div class="container">
        ${breadcrumb("À propos")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">L'agence</span>
          <h1>${escapeHtml(CFG.brand)}, une agence locale qui assume sa simplicité.</h1>
          <p class="lead">Louer une voiture devrait être <strong>simple, clair et sans surprise</strong>. Consultez les informations disponibles et échangez directement avec l'agence avant de confirmer.</p>
        </div>

        <div class="prose">
          <div data-reveal>
            <h2>Pourquoi choisir ${escapeHtml(CFG.brand)}</h2>
            <p>${escapeHtml(CFG.brand)} vous aide à trouver un véhicule de location avec des informations accessibles et un contact direct avec l'agence.</p>
            <p>Les dates, le tarif, la caution et les modalités de prise en charge sont confirmés avant la validation de votre demande.</p>
          </div>
          <div data-reveal>
            <h2>Notre promesse</h2>
            <p>Les modalités de remise du véhicule sont convenues directement avec l'agence selon le lieu et les dates souhaités.</p>
            <div class="note-box">La demande en ligne ne confirme pas automatiquement une réservation. Attendez la confirmation de l'agence avant votre déplacement.</div>
          </div>
          <div data-reveal>
            <h2>Notre flotte</h2>
            <p>La flotte publiée sur le site présente les véhicules proposés par l'agence. Consultez chaque fiche pour ses caractéristiques et ses conditions.</p>
            <p>Si vous avez un besoin particulier, contactez l'agence avant d'envoyer votre demande.</p>
          </div>
        </div>

        <div class="section__head" style="margin-top:var(--space-16)" data-reveal>
          <span class="eyebrow">Nos piliers</span>
          <h2 class="section__title">Un service pensé pour simplifier votre location</h2>
        </div>
        <div class="pillars">
          ${[
            {
              i: "tag",
              t: "Transparence",
              d: "Prix écrits avant validation, conditions claires, jamais de frais surprise à la prise en charge.",
            },
            {
              i: "clock",
              t: "Réactivité",
              d: "Un contact direct avec l'agence pour répondre à vos questions.",
            },
            {
              i: "sparkles",
              t: "Qualité",
              d: "Flotte premium récente, entretenue et nettoyée avant chaque location.",
            },
            {
              i: "mapPin",
              t: "Service local",
              d: "Les modalités de remise sont convenues selon votre lieu et votre horaire.",
            },
          ]
            .map(
              (p, i) => `
            <div class="card" data-reveal data-reveal-delay="${i + 1}">
              <span class="card__icon">${I[p.i]()}</span>
              <h3 class="card__title">${p.t}</h3>
              <p class="card__text">${p.d}</p>
            </div>`
            )
            .join("")}
        </div>

        <div style="margin-top:var(--space-16)">
          ${ctaBand({
            title: "Une question, un besoin spécifique ?",
            text: "On préfère discuter. Appelez-nous, on prend le temps de comprendre votre voyage.",
            primary: callBtn(" Nous appeler"),
            secondary: `<a class="btn btn--ghost" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} ${escapeHtml(CFG.phonePrimary)}</a>`,
          })}
        </div>
      </div>
    </section>`;

  /* ================= CONTACT ================= */
  const contact = () => `
    <section class="page">
      <div class="container">
        ${breadcrumb("Contact")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">On vous répond vite</span>
          <h1>Discutons. Appelez-nous, on prend le temps.</h1>
          <p class="lead">Contactez l'agence pour obtenir les disponibilités, les tarifs et les conditions applicables à votre demande.</p>
        </div>

        <div class="contact-grid">
          <div class="contact-cards">
<a class="contact-card contact-card--success" href="tel:${phoneLink(CFG.phonePrimaryTel)}" data-reveal>
            <span class="card__icon">${I.phone()}</span>
            <span>
              <small>Appelez-nous — le plus rapide</small>
              <b>${escapeHtml(CFG.phonePrimary)}</b>
            </span>
          </a>
            <a class="contact-card" href="tel:${phoneLink(CFG.phonePrimaryTel)}" data-reveal data-reveal-delay="1">
              <span class="card__icon">${I.phone()}</span>
              <span>
                <small>Téléphone principal</small>
                <b>${escapeHtml(CFG.phonePrimary)}</b>
              </span>
            </a>
            <a class="contact-card" href="tel:${phoneLink(CFG.phoneSecondaryTel)}" data-reveal data-reveal-delay="2">
              <span class="card__icon">${I.phone()}</span>
              <span>
                <small>Téléphone secondaire</small>
                <b>${escapeHtml(CFG.phoneSecondary)}</b>
              </span>
            </a>
            <div class="contact-card" data-reveal data-reveal-delay="3">
              <span class="card__icon">${I.mapPin()}</span>
              <span>
                <small>Où nous trouver</small>
                <b>${escapeHtml(CFG.address)}</b>
              </span>
            </div>
            <div class="contact-card" data-reveal data-reveal-delay="4">
              <span class="card__icon">${I.clock()}</span>
              <span>
                <small>Disponibilité</small>
                <b>${escapeHtml(CFG.hours)}</b>
              </span>
            </div>
          </div>

          <div class="side-panel" data-reveal>
            <h2>Préférez la réservation guidée ?</h2>
            <p>Choisissez un véhicule et remplissez le formulaire de réservation : on vous répond avec la disponibilité et le tarif final.</p>
            <a class="btn btn--primary" href="#/vehicules">Choisir un véhicule ${I.arrowRight()}</a>
            <hr class="hairline" />
            <h3>Où trouver l'agence</h3>
            <p>Indiquez le lieu de prise en charge souhaité; l'agence vous confirmera si elle peut y remettre le véhicule et les frais éventuels.</p>
            <a class="btn btn--ghost" href="${escapeHtml(mapsLink())}" target="_blank" rel="noopener">${I.mapPin()} Ouvrir dans Google Maps</a>
          </div>
        </div>
      </div>
    </section>`;

  /* ================= CONDITIONS ================= */
  const conditions = () => `
    <section class="page">
      <div class="container container--narrow">
        ${breadcrumb("Conditions de location")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">Conditions générales</span>
          <h1>Conditions de location : tout, clairement.</h1>
          <p class="lead">Nous écrivons chaque condition avant la validation. Voici l'ensemble des règles qui s'appliquent à toutes nos locations. Aucune n'est cachée.</p>
        </div>
        <div class="conditions">
          ${D.CONDITIONS.map(
            (c, i) => `
            <article class="condition" data-reveal>
              <h2><em>${i + 1}.</em> ${c.title}</h2>
              ${c.text ? `<p>${c.text}</p>` : ""}
              ${
                c.list
                  ? `<ul>${c.list
                      .map((l) => `<li>${l}</li>`)
                      .join("")}</ul>`
                  : ""
              }
              ${c.note ? `<p class="note">${c.note}</p>` : ""}
            </article>`
          ).join("")}
        </div>
        <div style="margin-top:var(--space-12)">
          ${ctaBand({
            title: "Une condition pas claire ?",
            text: "On préfère que vous posiez la question avant. On vous répond par écrit, et le contrat reprendra exactement la même réponse.",
primary: callBtn(" Poser ma question"),
          })}
        </div>
      </div>
    </section>`;

  /* ================= FAQ ================= */
  const faq = () => `
    <section class="page">
      <div class="container container--narrow">
        ${breadcrumb("FAQ")}
        <div class="page-head" data-reveal>
          <span class="eyebrow">Questions fréquentes</span>
          <h1>Tout ce qu'il faut savoir avant de louer.</h1>
          <p class="lead">Documents, âge, caution, assurance, livraison, carburant : toutes les questions concrètes regroupées par catégorie.</p>
          <div class="btn-row">
            <a class="btn btn--primary" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} Poser ma question</a>
          </div>
        </div>
        <div class="faq-cats">
          ${D.FAQ_CATS.map(
            (cat) => `
            <div class="faq-cat" data-reveal>
              <h2>${cat.title}</h2>
              ${faqList(cat.items)}
            </div>`
          ).join("")}
        </div>
        <div style="margin-top:var(--space-12)">
          ${ctaBand({
            title: "Votre question n'est pas listée ?",
            text: "Appelez l'agence pour discuter de votre demande de location.",
            primary: callBtn(" Poser ma question"),
          })}
        </div>
      </div>
    </section>`;

  /* ================= CONFIRMATION ================= */
  const confirmed = () => {
    let r = null;
    try {
      r = JSON.parse(sessionStorage.getItem("lc_reservation") || "null");
    } catch (e) {
      r = null;
    }
    if (!r) return null;
    /* Parc vide : le récapitulatif s'affiche quand même, sans la fiche véhicule. */
    const v = D.VEHICLES.find((x) => x.name === r.vehicle) || D.VEHICLES[0] || null;
    const fmt = (d) =>
      d
        ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "—";
    return `
    <section class="page">
      <div class="container">
        <div class="confirm">
          <div data-reveal>
            <span class="confirm__check">${I.checkCircle()}</span>
            <span class="eyebrow">Demande bien reçue</span>
            <h1>Merci ${r.firstName}, on revient vers vous très vite.</h1>
            <p class="lead">Votre demande est enregistrée. <strong>Conservez la référence <code>${r.ref || ""}</code></strong> : elle nous permet de retrouver votre dossier immédiatement.<br />Nous vous appelons pour confirmer la disponibilité et le tarif final.</p>
            <div class="btn-row" style="margin-top:var(--space-6)">
              <a class="btn btn--primary btn--lg" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} Appeler ${escapeHtml(CFG.phonePrimary)}</a>
              <a class="btn btn--ghost btn--lg" href="tel:${phoneLink(CFG.phoneSecondaryTel)}">${I.phone()} ${escapeHtml(CFG.phoneSecondary)}</a>
            </div>
            <div class="confirm__steps">
              ${[
                "On vérifie la disponibilité du véhicule et nous vous appelons avec une <strong>confirmation écrite</strong> du tarif final.",
                "Une <strong>avance</strong> vous est demandée pour valider la réservation. Vous ne payez le solde qu'à la prise en charge.",
                "Le jour J, on vous accueille à l'endroit convenu avec votre voiture propre, prête, et l'assurance déjà incluse.",
              ]
                .map(
                  (s, i) => `
                <div class="confirm__step">
                  <b class="n">${i + 1}</b>
                  <p>${s}</p>
                </div>`
                )
                .join("")}
            </div>
            <div class="btn-row" style="margin-top:var(--space-8)">
              <a class="link-arrow" href="#/">${I.arrowLeft()} Retour à l'accueil</a>
            </div>
          </div>

          <aside class="recap" data-reveal data-reveal-delay="1">
            <div class="review__top">
              <h2 style="font-size:var(--fs-lg)">Récapitulatif de votre demande</h2>
              <span class="badge">À confirmer</span>
            </div>
            ${
              v
                ? `<div class="price-card__media" style="border-radius:var(--radius-sm)">
              <img src="${photo(v, 0)}" alt="${v.name}" style="height:110px" />
            </div>
            <div>
              <b style="color:var(--white)">${v.name}</b>
              <p class="note">dès ${money(v.priceFrom)} MAD / jour · caution ${money(v.deposit)} MAD</p>
            </div>`
                : `<div><b>${r.vehicle || "Véhicule"}</b>
              <p class="note">Tarif définitif confirmé par l'agence.</p></div>`
            }
            <div class="recap__row"><span>Client</span><b>${r.firstName} ${r.lastName}</b></div>
            <div class="recap__row"><span>Téléphone</span><b>${r.countryCode} ${r.phone}</b></div>
            ${r.licenceNumber ? `<div class="recap__row"><span>Permis</span><b>${r.licenceNumber}${r.licenceDate ? ` · ${fmt(r.licenceDate)}` : ""}</b></div>` : ""}
            ${r.passport ? `<div class="recap__row"><span>Passeport</span><b>${r.passport}</b></div>` : ""}
            <div class="recap__row"><span>Prise en charge</span><b>${r.pickup} · ${fmt(r.pickupDate)} ${r.pickupTime}</b></div>
            <div class="recap__row"><span>Retour</span><b>${r.ret} · ${fmt(r.returnDate)} ${r.returnTime}</b></div>
            ${r.babySeat ? `<div class="recap__row"><span>Siège bébé</span><b>${money(r.babySeat)} MAD / jour</b></div>` : ""}
            ${r.oneWay ? `<div class="recap__row"><span>Aller-retour</span><b>Supplément à confirmer</b></div>` : ""}
            ${r.estimate ? `<div class="recap__row"><span>Durée</span><b>${r.estimate.days} jour${r.estimate.days > 1 ? "s" : ""}</b></div>` : ""}
            ${r.estimate ? `<div class="recap__row"><span>Total estimé</span><b>${money(r.estimate.total)} MAD</b></div>` : ""}
          </aside>
        </div>
      </div>
    </section>`;
  };

  window.Pages = {
    home,
    vehiclesIndex,
    vehicleDetail,
    airports,
    pricing,
    about,
    contact,
    conditions,
    faq,
    confirmed,
  };
})();
