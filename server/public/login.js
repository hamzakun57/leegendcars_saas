/**
 * Connexion du back-office.
 *
 * Deux modes, comme le reste :
 *   - « supabase » : Supabase Auth (e-mail + mot de passe), session conservée
 *   - « api »      : le serveur Express et son ancien mécanisme par cookie
 *
 * Dans les deux cas, le formulaire ne demande qu'un e-mail et un mot de passe.
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const msg = (text, kind = "err") => {
    $("#msg").innerHTML = text ? `<div class="${kind}">${esc(text)}</div>` : "";
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CFG = window.LCAdminConfig || {};
  const viaSupabase = CFG.source === "supabase";

  let client = null;
  const tenantFetch = (input, init = {}) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const agencyId = localStorage.getItem("lc_agency_id");
    if (agencyId) headers.set("x-agency-id", agencyId);
    if (CFG.agencySlug) headers.set("x-agency-slug", CFG.agencySlug);
    return fetch(input, { ...init, headers });
  };
  const getClient = () => {
    if (client) return client;
    if (!window.supabase) throw new Error("Client Supabase absent : lancez « npm run build ».");
    client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "lc_admin_session" },
      global: { fetch: tenantFetch },
    });
    return client;
  };

  const choisirAgence = async (user) => {
    const { data, error } = await getClient()
      .from("agency_memberships")
      .select("agency_id, is_default, agencies(slug)")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("is_default", { ascending: false });
    if (error) throw new Error(error.message);
    const memberships = data || [];
    const selected = CFG.agencySlug
      ? memberships.find((m) => m.agencies?.slug === CFG.agencySlug)
      : memberships[0];
    if (!selected) throw new Error("Ce compte n'appartient pas à cette agence.");
    localStorage.setItem("lc_agency_id", selected.agency_id);
    localStorage.setItem("lc_agency_slug", selected.agencies.slug);
  };

  const form = $("#f");
  if (!form) return;

  /* Un agent qui a déjà une session valide n'a rien à ressaisir. */
  if (viaSupabase) {
    getClient()
      .auth.getSession()
      .then(async ({ data }) => {
        if (data?.session) {
          await choisirAgence(data.session.user);
          location.replace("/admin/");
        }
      })
      .catch(() => {});
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("");
    const bouton = form.querySelector('button[type="submit"]');
    const libelle = bouton ? bouton.textContent : "";
    if (bouton) bouton.disabled = true;

    const email = $("#u").value.trim();
    const password = $("#p").value;
    if (!email || !password) {
      if (bouton) bouton.disabled = false;
      return msg("Renseignez votre e-mail et votre mot de passe.");
    }

    try {
      if (viaSupabase) {
        localStorage.removeItem("lc_agency_id");
        localStorage.removeItem("lc_agency_slug");
        const { data, error } = await getClient().auth.signInWithPassword({ email, password });
        if (error || !data?.user) {
          if (bouton) bouton.disabled = false;
          return msg(error?.message || "E-mail ou mot de passe incorrect.");
        }
        await choisirAgence(data.user);
        /* Connecté, mais peut-être pas administrateur : la page d'accueil
           vérifiera elle-même le rôle et refusera l'accès si besoin. */
        location.replace("/admin/");
      } else {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (bouton) bouton.disabled = false;
          return msg(data.error || "Identifiants incorrects");
        }
        location.href = "/admin";
      }
    } catch (err) {
      if (bouton) bouton.disabled = false;
      msg(err.message || "Connexion impossible.");
      if (bouton) bouton.textContent = libelle;
    }
  });
})();
