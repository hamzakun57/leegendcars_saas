/**
 * Source de données du site public.
 *
 * Deux modes, pour que rien ne disparaisse :
 *   - « api »      : le serveur Express répond (fonctionnement en local)
 *   - « supabase » : le navigateur interroge Supabase directement (Netlify)
 *
 * Les deux exposent exactement la même interface, avec les mêmes formes de
 * données : le site, l'admin et leurs gabarits ne savent pas quel est actif.
 *
 * Les méthodes ne s'appuient pas sur « this » mais sur des références
 * explicites : appelées depuis un autre contexte (iframe, module bundlé,
 * proxy), elles restent correctes.
 */
(function () {
  "use strict";

  const cfg = () => (window.DATA && window.DATA.CFG) || {};

  /* ---------------- mode « api » : l'existant, inchangé ---------------- */
  const viaApi = {
    async vehicles() {
      const r = await fetch("/api/vehicles", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    },
    async envoyerReservation(payload) {
      const r = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: r.ok, ...(await r.json().catch(() => ({}))) };
    },
  };

  /* ---------------- mode « supabase » ---------------- */
  let client = null;
  const getClient = () => {
    if (client) return client;
    const c = cfg();
    if (!c.supabaseUrl || !c.supabaseAnonKey) {
      throw new Error("Configuration Supabase manquante dans data.js.");
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Client Supabase absent : lancez « npm run build ».");
    }
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" },
      global: { fetch: tenantFetch },
    });
    return client;
  };

  const message = (e) => (e && e.message) || "Erreur Supabase";
  const agencySlug = () => cfg().agencySlug || "";
  const tenantFetch = (input, init = {}) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const slug = agencySlug();
    if (slug) headers.set("x-agency-slug", slug);
    return fetch(input, { ...init, headers });
  };

  /* Les colonnes JSON sont du texte ; les anciennes versions de l'admin
     avaient stocké des objets plutôt que des chemins. */
  function liste(brut) {
    try {
      const v = typeof brut === "string" ? JSON.parse(brut || "[]") : brut;
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  /* Le site attend des clés en camelCase : on traduit une seule fois ici,
     exactement comme le fait la route publique du serveur. */
  const enVehiculePublic = (v) => ({
    id: v.slug,
    slug: v.slug,
    name: v.name,
    tagline: v.tagline || [v.modele, v.transmission].filter(Boolean).join(" · "),
    transmission: v.transmission || "Automatique",
    fuel: v.energie || v.fuel || "Essence",
    doors: v.doors || 5,
    seats: v.seats || 5,
    priceFrom: v.price_from || 0,
    deposit: v.deposit || 0,
    approx: v.approx || 0,
    sort_order: Number(v.sort_order) || 0,
    badge: v.badge || "",
    accent: v.accent || "",
    gallery: liste(v.gallery),
    description: liste(v.description),
    idealFor: liste(v.ideal_for),
    tiers: liste(v.tiers),
  });

  const nbJours = (d1, d2) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d1 || "") || !/^\d{4}-\d{2}-\d{2}$/.test(d2 || "")) return 0;
    const ms = new Date(d2 + "T00:00:00") - new Date(d1 + "T00:00:00");
    return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86400000)) : 0;
  };

  /* Chaque fonction est nommée et référencée directement : pas de « this ». */
  function vehicules() {
    return getClient()
      .from("vehicles")
      .select("*")
      .eq("active", 1)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) throw new Error(message(error));
        const vehicles = (data || []).map(enVehiculePublic);
        vehicles.sort(
          (a, b) =>
            (a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER) -
              (b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER) ||
            String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" })
        );
        return { vehicles };
      });
  }

  function vehicule(slug) {
    return getClient()
      .from("vehicles")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(message(error));
        return data ? enVehiculePublic(data) : null;
      });
  }

  function premierVehicule() {
    return vehicules().then((f) => f.vehicles[0] || null);
  }

  function agence() {
    const slug = agencySlug();
    if (!slug || demandeApi()) return Promise.resolve(null);
    return getClient()
      .from("agencies")
      .select("id, slug, name, settings")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(message(error));
        return data || null;
      });
  }

  /* Le tarif est recalculé ici avec exactement la même règle que le serveur :
     barème par durée, puis supplément siège bébé. Un client qui rogne la page
     n'obtient pas un prix truqué, et le total affiché reste le total écrit. */
  function pricing({ vehicle, from, to, babySeat = 0 }) {
    return Promise.resolve(vehicle ? vehicule(vehicle) : premierVehicule()).then((v) => {
      if (!v) throw new Error("Véhicule introuvable");
      const jours = nbJours(from, to);
      let daily = v.priceFrom;
      for (const t of v.tiers) if (jours >= t.days) daily = t.price;
      const seatTotal = Number(babySeat || 0) * jours;

      return getClient()
        .from("blocked_dates")
        .select("*")
        .eq("vehicle_slug", v.slug)
        .then(({ data, error }) => {
          if (error) throw new Error(message(error));
          const chevauche = (data || []).filter(
            (b) => (!from || b.end_date >= from) && (!to || b.start_date <= to)
          );
          return {
            vehicle: v.slug,
            days: jours,
            daily,
            seatTotal,
            total: daily * jours + seatTotal,
            blocked: chevauche,
            available: chevauche.length === 0,
          };
        });
    });
  }

  /* La référence est tirée sur le client : elle ne sert qu'à l'affichage
     immédiat. Un agent peut la ressaisir, l'unicité est garantie en base. */
  function envoyerReservation(payload) {
    const p = payload || {};
    return Promise.resolve(p.vehicleSlug ? vehicule(p.vehicleSlug) : premierVehicule()).then((v) => {
      if (p.vehicleSlug && !v) {
        return { ok: false, error: "Champs invalides", fields: ["vehicleSlug"] };
      }

      const manquant = [];
      if (!p.firstName) manquant.push("firstName");
      if (!p.lastName) manquant.push("lastName");
      if (!/^\+?[\d\s().-]{6,25}$/.test(p.phone || "")) manquant.push("phone");
      if (!p.licenceNumber) manquant.push("licenceNumber");
      if (!window.LCDateUtils?.isIsoDate(p.licenceDate)) manquant.push("licenceDate");
      if (!p.pickup) manquant.push("pickup");
      if (!p.ret) manquant.push("ret");
      if (!window.LCDateUtils?.isIsoDate(p.pickupDate)) manquant.push("pickupDate");
      if (!window.LCDateUtils?.isIsoDate(p.returnDate)) manquant.push("returnDate");
      if (manquant.length) return { ok: false, error: "Champs invalides", fields: manquant };

      return pricing({
        vehicle: v && v.slug,
        from: p.pickupDate,
        to: p.returnDate,
        babySeat: p.babySeat,
      }).then((tarif) => {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let ref = "LC-";
        for (let i = 0; i < 6; i++) ref += alphabet[Math.floor(Math.random() * alphabet.length)];

        const ligne = {
          ref,
          first_name: p.firstName,
          last_name: p.lastName,
          country_code: p.countryCode || "",
          phone: p.phone,
          licence_number: p.licenceNumber,
          licence_date: p.licenceDate,
          passport: p.passport || "",
          vehicle_slug: v ? v.slug : "",
          vehicle_name: v ? v.name : "",
          pickup: p.pickup,
          ret: p.ret,
          pickup_date: p.pickupDate,
          pickup_time: p.pickupTime || "",
          return_date: p.returnDate,
          return_time: p.returnTime || "",
          baby_seat: Number(p.babySeat) || 0,
          one_way: p.pickup !== p.ret ? 1 : 0,
          days: tarif.days,
          daily: tarif.daily,
          seat_total: tarif.seatTotal,
          total: tarif.total,
          notes: p.notes || "",
          summary: [
            `Réservation — ${p.firstName} ${p.lastName}`,
            `Téléphone : ${p.countryCode || ""} ${p.phone}`,
            `Permis : ${p.licenceNumber}`,
            `Véhicule : ${v ? v.name : "—"}`,
            `Prise en charge : ${p.pickup} le ${p.pickupDate} à ${p.pickupTime || ""}`,
            `Retour : ${p.ret} le ${p.returnDate} à ${p.returnTime || ""}`,
            tarif.days ? `Estimation : ${tarif.days} jour(s) × ${tarif.daily} MAD = ${tarif.total} MAD` : "",
          ].filter(Boolean).join("\n"),
          /* Le déclencheur en base écrase ces champs de toute façon : autant ne
             pas envoyer de valeurs que l'on usurperait. */
          status: "nouvelle",
        };

        return getClient()
          .from("reservations")
          .insert(ligne)
          .then(({ error }) => {
            if (error) return { ok: false, error: message(error) };
            return {
              ok: true,
              ref,
              days: tarif.days,
              daily: tarif.daily,
              seatTotal: tarif.seatTotal,
              total: tarif.total,
            };
          });
      });
    });
  }

  /* ---------------- sélection du mode ---------------- */
  /* « auto » : Supabase s'il est configuré, le serveur sinon. */
  const demande = cfg().source || "auto";
  const choisi = demande === "auto" ? (cfg().supabaseUrl ? "supabase" : "api") : demande;
  function demandeApi() {
    return choisi !== "supabase";
  }

  window.LCData =
    choisi === "supabase"
      ? { mode: choisi, agence, vehicles: vehicules, pricing, vehicule, envoyerReservation }
      : { mode: choisi, agence, vehicles: viaApi.vehicles, envoyerReservation: viaApi.envoyerReservation };
})();
