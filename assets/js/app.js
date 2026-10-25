/* Leegend Cars — router, header, footer & interactions */
(function () {
  const D = window.DATA;
  const P = window.Pages;
  const I = window.Icons;
  const { CFG, wa } = D;
  const escapeHtml = D.escapeHtml;
  const phoneLink = (value) => String(value || "").replace(/[^\d+().-]/g, "");

  const root = document.getElementById("root");

  /* ---------- header ---------- */
  const headerHTML = () => `
    <header class="header" data-header>
      <div class="container header__inner">
        <a class="header__logo" href="#/" aria-label="${escapeHtml(CFG.brand)}">
          <span class="brand">${escapeHtml(CFG.brand)}</span>
        </a>
        <nav class="header__nav" aria-label="Navigation principale">
          ${D.NAV.map((n) => `<a href="${n.href}" data-nav="${n.href}">${n.label}</a>`).join("")}
        </nav>
        <div class="header__actions">
          <button class="burger" type="button" data-burger aria-label="Ouvrir le menu" aria-expanded="false"><span></span></button>
        </div>
      </div>
    </header>
    <div class="backdrop" data-backdrop></div>
    <div class="drawer" id="mobile-drawer" aria-label="Menu mobile" data-drawer>
      <div class="container">
        <nav class="drawer__nav">
          ${D.NAV.map((n) => `<a href="${n.href}" data-nav="${n.href}">${n.label}</a>`).join("")}
        </nav>
      </div>
    </div>`;

  /* ---------- footer ---------- */
  const FOOTER_LINKS = [
    { label: "Véhicules", href: "#/vehicules" },
    { label: "Prise en charge", href: "#/aeroports" },
    { label: "Prix & promos", href: "#/prix-promos" },
    { label: "Destinations", href: "#/", scroll: "destinations" },
    { label: "À propos", href: "#/a-propos" },
    { label: "Contact", href: "#/contact" },
    { label: "FAQ", href: "#/faq" },
    { label: "Conditions", href: "#/conditions" },
  ];

  const footerHTML = () => `
    <footer class="footer">
      <div class="container">
        <div class="footer__grid">
<div class="footer__brand">
            <a class="footer__logo" href="#/" aria-label="${escapeHtml(CFG.brand)}">
              <span class="brand">${escapeHtml(CFG.brand)}</span>
            </a>
            <p>Consultez les véhicules et envoyez une demande de réservation. Les tarifs et modalités sont confirmés par l'agence.</p>
          </div>
          <div>
            <h3 class="footer__title">Contact</h3>
            <ul class="footer__list">
              <li><a href="tel:${phoneLink(CFG.phonePrimaryTel)}">${escapeHtml(CFG.phonePrimary)}</a></li>
              <li><a href="tel:${phoneLink(CFG.phoneSecondaryTel)}">${escapeHtml(CFG.phoneSecondary)}</a></li>
              <li><span>${escapeHtml(CFG.address)}</span></li>
              <li><span>${escapeHtml(CFG.hours)}</span></li>
            </ul>
          </div>
          <div>
            <h3 class="footer__title">Liens utiles</h3>
            <ul class="footer__list">
              ${FOOTER_LINKS.map((l) => `<li><a href="${l.href}"${l.scroll ? ` data-scroll="${l.scroll}"` : ""}>${l.label}</a></li>`).join("")}
            </ul>
          </div>
          <div>
            <h3 class="footer__title">Réservation</h3>
            <ul class="footer__list">
              <li><span>Devis, disponibilités et confirmation écrite 7j/7.</span></li>
            </ul>
          </div>
        </div>
        <div class="footer__bottom">
          <span>© ${CFG.year} ${escapeHtml(CFG.brand)}. Tous droits réservés.</span>
          <span>${escapeHtml(CFG.tagline || "Location de voitures")}${CFG.city ? ` · ${escapeHtml(CFG.city)}` : ""}</span>
        </div>
      </div>
    </footer>
    <div class="sticky-cta" aria-label="Contact rapide">
      <a class="btn btn--ghost" href="tel:${phoneLink(CFG.phonePrimaryTel)}">${I.phone()} Appeler</a>
      <a class="btn btn--primary" href="tel:${phoneLink(CFG.phoneSecondaryTel)}">${I.phone()} ${escapeHtml(CFG.phoneSecondary)}</a>
    </div>`;

  /* ---------- reveal on scroll ---------- */
  let observer = null;
  const observeReveals = () => {
    const nodes = document.querySelectorAll("[data-reveal]:not(.is-in)");
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("is-in");
              observer.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -8% 0%" }
      );
    }
    nodes.forEach((n) => observer.observe(n));
  };

  /* ---------- routes ---------- */
  const parseHash = () => {
    let h = (location.hash || "#/").replace(/^#/, "");
    if (!h.startsWith("/")) h = "/" + h;
    return h;
  };

  const TITLES = {
    "/": `Location de voiture`,
    "/vehicules": "Tous nos véhicules",
    "/aeroports": "Prise en charge",
    "/prix-promos": "Prix & promos",
    "/a-propos": "À propos",
    "/contact": "Contact",
    "/conditions": "Conditions de location",
    "/faq": "FAQ",
  };

  let pendingScroll = null;

  const render = () => {
    const path = parseHash();
    const parts = path.split("/").filter(Boolean);
    let html = null;
    let title = CFG.brand;

    if (parts.length === 0) {
      html = P.home();
      title = `${CFG.brand} — ${TITLES["/"]}`;
    } else if (parts[0] === "vehicules" && parts.length === 1) {
      html = P.vehiclesIndex();
      title = `${TITLES["/vehicules"]} — ${CFG.brand}`;
    } else if (parts[0] === "vehicules" && parts.length === 2) {
      html = P.vehicleDetail(parts[1]);
      if (html) {
        const v = D.VEHICLES.find((x) => x.slug === parts[1]);
        title = `${v ? v.name : "Véhicule"} — Location ${CFG.brand}`;
      }
    } else if (parts[0] === "aeroports") {
      html = P.airports();
      title = `${TITLES["/aeroports"]} — ${CFG.brand}`;
    } else if (parts[0] === "prix-promos") {
      html = P.pricing();
      title = `${TITLES["/prix-promos"]} — ${CFG.brand}`;
    } else if (parts[0] === "a-propos") {
      html = P.about();
      title = `${TITLES["/a-propos"]} — ${CFG.brand}`;
    } else if (parts[0] === "contact") {
      html = P.contact();
      title = `${TITLES["/contact"]} — ${CFG.brand}`;
    } else if (parts[0] === "conditions") {
      html = P.conditions();
      title = `${TITLES["/conditions"]} — ${CFG.brand}`;
    } else if (parts[0] === "faq") {
      html = P.faq();
      title = `${TITLES["/faq"]} — ${CFG.brand}`;
    } else if (parts[0] === "reservation" && parts[1] === "confirmee") {
      html = P.confirmed();
      if (!html) {
        location.hash = "#/";
        return;
      }
      title = `Demande reçue — ${CFG.brand}`;
    }

    if (!html) {
      location.hash = "#/";
      return;
    }

    document.title = title;
    root.innerHTML = headerHTML() + `<main>${html}</main>` + footerHTML();
    document.body.classList.add("has-sticky-cta");
    closeDrawer();
    highlightNav(path);
    observeReveals();
    wireForms();
    wireThumbs();

    if (pendingScroll) {
      const id = pendingScroll;
      pendingScroll = null;
      const el = document.getElementById(id);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        return;
      }
    }
    window.scrollTo(0, 0);
  };

  const highlightNav = (path) => {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const href = a.getAttribute("data-nav").replace(/^#/, "");
      a.classList.toggle("is-active", path === href || (href !== "/" && path.startsWith(href)));
    });
  };

  /* ---------- drawer ---------- */
  const burger = () => document.querySelector("[data-burger]");
  const drawer = () => document.querySelector("[data-drawer]");
  const backdrop = () => document.querySelector("[data-backdrop]");

  const openDrawer = () => {
    drawer()?.classList.add("is-open");
    backdrop()?.classList.add("is-open");
    burger()?.classList.add("is-open");
    burger()?.setAttribute("aria-label", "Fermer le menu");
    burger()?.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
  };

  const closeDrawer = () => {
    drawer()?.classList.remove("is-open");
    backdrop()?.classList.remove("is-open");
    burger()?.classList.remove("is-open");
    burger()?.setAttribute("aria-label", "Ouvrir le menu");
    burger()?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
  };

  /* ---------- gallery thumbs ---------- */
  const wireThumbs = () => {
    const wrap = document.querySelector("[data-thumbs]");
    if (!wrap) return;
    const main = document.querySelector(".vgallery__main");
    wrap.querySelectorAll("[data-thumb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        wrap.querySelectorAll("[data-thumb]").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        main.style.animation = "none";
        void main.offsetWidth;
        main.src = btn.getAttribute("data-thumb");
        main.style.animation = "";
      });
    });
  };

  /* ---------- live reservation total ---------- */
  const daysBetween = (from, to) => {
    if (!from || !to) return 0;
    const a = new Date(from + "T00:00:00").getTime();
    const b = new Date(to + "T00:00:00").getTime();
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(1, Math.round((b - a) / 86400000));
  };

  /* Un véhicule ajouté depuis l'admin peut n'avoir aucun barème : on part alors
     du prix affiché, sinon le calcul du total interromprait la réservation. */
  const dailyFor = (vehicle, days) => {
    const tiers = Array.isArray(vehicle.tiers) ? vehicle.tiers : [];
    let price = Number(vehicle.priceFrom) || 0;
    if (tiers.length) {
      price = Number(tiers[0].price) || price;
      tiers.forEach((t) => {
        if (days >= t.days) price = Number(t.price) || price;
      });
    }
    return price;
  };

  const estimateTotal = (form, vehicle) => {
    const get = (n) => form.querySelector(`[name="${n}"]`);
    const days = daysBetween(get("pickupDate").value, get("returnDate").value);
    if (!days) return null;
    const daily = dailyFor(vehicle, days);
    const seatRate = parseInt(get("babySeat").value, 10) || 0;
    const seat = seatRate * days;
    const total = daily * days + seat;
    return { days, daily, seat, total };
  };

  const wireTotal = (form, vehicle) => {
    const out = form.querySelector("[data-rform-total]");
    if (!out) return;
    const daysOut = out.querySelector("[data-rtotal-days]");
    const dailyOut = out.querySelector("[data-rtotal-daily]");
    const seatRow = out.querySelector("[data-rtotal-seat-row]");
    const seatOut = out.querySelector("[data-rtotal-seat]");
    const totalOut = out.querySelector("[data-rtotal-total]");
    const oneWay = form.querySelector("[data-rform-oneway]");

    const update = () => {
      const e = estimateTotal(form, vehicle);
      if (e) {
        daysOut.innerHTML = `${e.days} jour${e.days > 1 ? "s" : ""}`;
        dailyOut.innerHTML = `${money(e.daily)} MAD`;
        seatRow.hidden = !e.seat;
        if (e.seat) seatOut.innerHTML = `${money(e.seat)} MAD`;
        totalOut.innerHTML = `${money(e.total)} MAD`;
      } else {
        daysOut.textContent = "—";
        dailyOut.textContent = "—";
        seatRow.hidden = true;
        totalOut.textContent = "—";
      }
      if (oneWay) {
        const pickup = form.querySelector('[name="pickup"]').value;
        const ret = form.querySelector('[name="ret"]').value;
        oneWay.hidden = !(pickup && ret && pickup !== ret);
      }
    };

    form
      .querySelectorAll('[name="pickupDate"], [name="returnDate"], [name="babySeat"], [name="pickup"], [name="ret"]')
      .forEach((el) => {
        el.addEventListener("change", update);
        el.addEventListener("input", update);
      });
    update();
  };

  /* ---------- reservation form ---------- */
  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  const setFieldError = (field, msg) => {
    const box = field.closest(".field");
    if (!box) return;
    box.classList.toggle("has-error", !!msg);
    let err = box.querySelector(".field__error");
    if (!err) {
      err = document.createElement("span");
      err.className = "field__error";
      box.appendChild(err);
    }
    err.textContent = msg || "";
  };

  const wireForms = () => {
    document.querySelectorAll("[data-rform]").forEach((form) => {
      const started = Date.now();
      const alertBox = form.querySelector("[data-form-alert]");
      const vehicle = form.getAttribute("data-vehicle");
      const price = form.getAttribute("data-price");
      const vehicleData = D.VEHICLES.find((x) => x.slug === form.getAttribute("data-slug"));
      if (vehicleData) wireTotal(form, vehicleData);

      const setAlert = (msg) => {
        if (!alertBox) return;
        alertBox.innerHTML = msg
          ? `<div class="rform__alert rform__alert--error">${msg}</div>`
          : "";
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        setAlert("");

        if (form.querySelector('[name="botcheck"]').value) {
          setAlert(
            "Un champ caché anti-spam a été rempli automatiquement par votre navigateur. Contactez-nous directement par téléphone."
          );
          return;
        }
        if (Date.now() - started < 600) {
          setAlert("Merci de prendre quelques secondes pour remplir le formulaire.");
          return;
        }

        const get = (n) => form.querySelector(`[name="${n}"]`);
        let ok = true;

        const req = (n, label) => {
          const el = get(n);
          const val = (el.value || "").trim();
          const bad = !val;
          setFieldError(el, bad ? `${label} requis.` : "");
          if (bad) ok = false;
          return val;
        };

        const firstName = req("firstName", "Prénom");
        const lastName = req("lastName", "Nom");
        const phoneRaw = (get("phone").value || "").replace(/[^\d]/g, "");
        if (phoneRaw.length < 8) {
          setFieldError(get("phone"), "Numéro de téléphone trop court.");
          ok = false;
        } else setFieldError(get("phone"), "");
        const pickup = req("pickup", "Lieu de prise en charge requis");
        const ret = req("ret", "Lieu de retour requis");
        const pickupDate = req("pickupDate", "Date de prise en charge requise");
        const pickupTime = req("pickupTime", "Heure de prise en charge requise");
        const returnDate = req("returnDate", "Date de retour requise");
        const returnTime = req("returnTime", "Heure de retour requise");
        const licenceNumber = req("licenceNumber", "Numéro de permis requis");
        const licenceDate = req("licenceDate", "Date du permis requise");
        const passport = (get("passport").value || "").trim();

        for (const [name, value, label] of [
          ["licenceDate", licenceDate, "Date du permis"],
          ["pickupDate", pickupDate, "Date de prise en charge"],
          ["returnDate", returnDate, "Date de retour"],
        ]) {
          if (value && !window.LCDateUtils?.isIsoDate(value)) {
            setFieldError(get(name), `${label} invalide.`);
            ok = false;
          }
        }

        if (licenceDate && licenceDate > pickupDate) {
          setFieldError(get("licenceDate"), "La date du permis doit être avant la prise en charge.");
          ok = false;
        }

        if (pickupDate && returnDate && returnDate < pickupDate) {
          setFieldError(get("returnDate"), "La date de retour doit être après la prise en charge.");
          ok = false;
        }

        if (!ok) {
          setAlert("Merci de corriger les champs surlignés.");
          form.querySelector(".has-error input, .has-error select")?.focus();
          return;
        }

        const countryCode = get("countryCode").value || "";
        const seatRate = parseInt(get("babySeat").value, 10) || 0;
        const notes = (get("notes").value || "").trim();
        const fmt = (d) =>
          new Date(d + "T00:00:00").toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });

        const estimate = vehicleData ? estimateTotal(form, vehicleData) : null;
        const oneWay = !!pickup && !!ret && pickup !== ret;
        const seatLabel = seatRate
          ? `Avec siège bébé (${seatRate} MAD/jour — ${money(seatRate * estimate.days)} MAD)`
          : "Sans";

        let msg = `Bonjour ${CFG.brand},\nJe souhaite réserver la ${vehicle}.\n\n👤 ${firstName} ${lastName}\n📞 ${countryCode} ${phoneRaw}\n🪪 Permis : ${licenceNumber} (délivré le ${fmt(licenceDate)})${
          passport ? `\n🛂 Passeport : ${passport}` : ""
        }`;

        msg += `\n\n📍 Prise en charge : ${pickup} le ${fmt(pickupDate)} à ${pickupTime}\n📍 Retour : ${ret} le ${fmt(returnDate)} à ${returnTime}\n👶 Siège bébé : ${seatLabel}`;
        if (oneWay) msg += `\n⚠️ Retour dans une autre ville : un supplément aller-retour sera ajouté.`;
        if (estimate) {
          msg += `\n\n💰 Estimation : ${estimate.days} jour${estimate.days > 1 ? "s" : ""} × ${money(estimate.daily)} MAD = ${money(estimate.daily * estimate.days)} MAD`;
          if (estimate.seat) msg += `\n＋ Siège bébé : ${money(estimate.seat)} MAD`;
          msg += `\n＝ Total estimé : ${money(estimate.total)} MAD`;
        }
        if (notes) msg += `\n\n📝 Remarques : ${notes}`;
        msg += `\n\nMerci de me confirmer la disponibilité et le tarif final.`;

        const payload = {
          vehicleSlug: form.getAttribute("data-slug"),
          firstName, lastName, countryCode, phone: phoneRaw,
          licenceNumber, licenceDate, passport,
          pickup, ret, pickupDate, pickupTime, returnDate, returnTime,
          babySeat: seatRate, notes,
        };

        const submitBtn = form.querySelector('button[type="submit"]');
        const submitLabel = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "Envoi en cours…";
        }

        /* Passe par LCData : selon la configuration, la demande part vers le
           serveur Express ou directement vers Supabase. Le formulaire ne fait
           aucune différence entre les deux. */
        window.LCData.envoyerReservation(payload)
          .then((data) => {
            if (!data.ok) {
              setAlert(data.error || "Votre demande n'a pas pu être envoyée. Merci de réessayer.");
              (data.fields || []).forEach((f) => setFieldError(get(f), "Champ invalide."));
              submitBtn.disabled = false;
              submitBtn.innerHTML = submitLabel;
              return;
            }
            try {
              sessionStorage.setItem(
                "lc_reservation",
                JSON.stringify({
                  vehicle,
                  price,
                  ref: data.ref,
                  firstName,
                  lastName,
                  phone: phoneRaw,
                  countryCode,
                  licenceNumber,
                  licenceDate,
                  passport,
                  pickup,
                  ret,
                  pickupDate,
                  pickupTime,
                  returnDate,
                  returnTime,
                  babySeat: seatRate,
                  oneWay,
                  estimate,
                  serverTotal: data.total,
                  summary: msg,
                })
              );
            } catch (err) {}
            location.hash = "#/reservation/confirmee";
          })
          .catch(() => {
            setAlert("Connexion impossible. Vérifiez votre internet et réessayez, ou appelez-nous au " + CFG.phonePrimary + ".");
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitLabel;
          });
      });
    });
  };

  /* ---------- global events ---------- */
  document.addEventListener("click", (e) => {
    const burgerBtn = e.target.closest("[data-burger]");
    if (burgerBtn) {
      drawer()?.classList.contains("is-open") ? closeDrawer() : openDrawer();
      return;
    }
    if (e.target.closest("[data-backdrop]")) {
      closeDrawer();
      return;
    }

    const scrollLink = e.target.closest("[data-scroll]");
    if (scrollLink) {
      e.preventDefault();
      const id = scrollLink.getAttribute("data-scroll");
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        pendingScroll = id;
        location.hash = "#/";
      }
      return;
    }

    const link = e.target.closest("a[href^='#']");
    if (link && drawer()?.classList.contains("is-open") && link.closest("[data-drawer]")) {
      closeDrawer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  window.addEventListener("scroll", () => {
    document.querySelector("[data-header]")?.classList.toggle("is-scrolled", window.scrollY > 8);
  });

  window.addEventListener("hashchange", render);

  /* ---------- boot ---------- */
  /* La flotte affichée vient de l'admin : on la relit avant le premier rendu,
     pour qu'un véhicule ajouté depuis le back-office apparaisse immédiatement
     sur le site. En cas d'échec, on garde la liste de secours inscrite dans
     data.js. */
  async function loadFleet() {
    try {
      const agence = await window.LCData.agence();
      if (agence) {
        const settings = agence.settings && typeof agence.settings === "object" ? agence.settings : {};
        const fields = [
          "tagline", "city", "phonePrimary", "phonePrimaryTel", "phoneSecondary",
          "phoneSecondaryTel", "address", "mapsUrl", "hours",
        ];
        D.CFG.brand = String(settings.brand || agence.name || "Votre agence");
        for (const field of fields) {
          if (typeof settings[field] === "string") D.CFG[field] = settings[field];
        }
        if (Array.isArray(settings.pickupLocations)) {
          const locations = [...new Set(
            settings.pickupLocations
              .filter((location) => typeof location === "string")
              .map((location) => location.trim())
              .filter((location) => location.length > 0 && location.length <= 100)
          )].slice(0, 50);
          D.PICKUP_LOCATIONS = locations.length ? locations : ["À convenir avec l'agence"];
        }
        const babySeatDaily = Number(settings.babySeatDaily);
        if (Number.isFinite(babySeatDaily) && babySeatDaily > 0 && babySeatDaily <= 5000) {
          D.BABY_SEAT_DAILY = Math.round(babySeatDaily);
        }
        document.title = `${D.CFG.brand} — Location de voiture`;
        document.querySelector('meta[name="description"]')?.setAttribute(
          "content",
          `${D.CFG.brand} — ${D.CFG.tagline || "Location de voitures"}${D.CFG.city ? ` à ${D.CFG.city}` : ""}.`
        );
        document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
        document.querySelector('meta[property="og:description"]')?.setAttribute(
          "content",
          `${D.CFG.brand} — ${D.CFG.tagline || "Location de voitures"}`
        );
      } else if (D.CFG.source === "supabase") {
        throw new Error("Agence introuvable. Vérifiez le slug d'agence du site.");
      }
      /* Un seul appel : la bibliothèque Supabase réessaie déjà toute seule en
         cas de coupure. Un second essai de notre côté ne faisait que doubler
         le temps d'attente avant d'afficher l'erreur. */
      const data = (await window.LCData.vehicles()).vehicles;
      if (!Array.isArray(data)) throw new Error("Réponse inattendue de la base.");
      /* Une liste vide, elle, veut dire « le parc est vide » : c'est l'état réel
         de l'agence quand elle n'a encore saisi aucune voiture. Afficher les
         véhicules de démonstration de data.js serait mensonger. */
      D.FLETTE_ERREUR = "";
      D.FLETTE_DETAIL = "";
      if (!data.length) {
        D.VEHICLES = [];
        return;
      }

      /* Un véhicule tout juste créé n'a pas toujours un prix, des photos ou du
         texte. On ne remplace donc une valeur que si elle est renseignée, et on
         garde la valeur de secours du même modèle pour le reste. */
      const secours = new Map((D.VEHICLES || []).map((v) => [v.slug, v]));
      D.VEHICLES = data.map((v) => {
        const s = secours.get(v.slug);
        if (!s) return v;
        const liste = (a, b) => (Array.isArray(a) && a.length ? a : b);
        return {
          ...s,
          ...v,
          priceFrom: v.priceFrom || s.priceFrom,
          deposit: v.deposit || s.deposit,
          approx: v.approx || s.approx,
          tagline: v.tagline || s.tagline,
          badge: v.badge || s.badge,
          accent: v.accent || s.accent,
          gallery: liste(v.gallery, s.gallery),
          description: liste(v.description, s.description),
          idealFor: liste(v.idealFor, s.idealFor),
          tiers: liste(v.tiers, s.tiers),
        };
      });
    } catch (e) {
      /* Distinguer « pas de véhicules » de « véhicules illisibles » : sans cela
         une coupure se présentait comme un garage vide, et l'agence perdait des
         demandes sans savoir qu'il y avait une panne. Le visiteur reçoit une
         phrase ; le détail technique reste dans la console et dans l'infobulle,
         pour que l'agence puisse nous le transmettre. */
      const brut = String((e && e.message) || "").replace(/^Error:\s*/, "");
      D.FLETTE_DETAIL = brut;
      D.FLETTE_ERREUR = /failed to fetch|network|load failed/i.test(brut)
        ? "Connexion à la base impossible."
        : /jwt|token|session|401|403/i.test(brut)
          ? "Session expirée."
          : brut || "La base n'a pas répondu.";
      console.warn("Flotte en ligne indisponible :", brut, e);
    }
  }

  loadFleet().finally(() => {
    if (!location.hash) location.hash = "#/";
    render();
  });
})();
