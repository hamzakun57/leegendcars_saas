/**
 * Configuration du back-office.
 *
 * Les mêmes réglages que le site public (assets/js/data.js), lus sans charger
 * tout le catalogue : le back-office n'a besoin que de l'adresse du projet et
 * de la clé publique.
 *
 * Rappel : cette clé est publique par nature. Elle n'accorde aucun droit ; ce
 * sont les règles d'accès de la base (supabase/policies.sql) qui décident de
 * ce qu'un visiteur peut lire ou écrire. La clé « service_role » ne doit
 * jamais apparaître dans un fichier servi au navigateur.
 */
(function () {
  "use strict";
  const runtime = window.LCRuntimeConfig || {};
  const agencySlug =
    new URLSearchParams(location.search).get("agency") ||
    runtime.agencySlug ||
    localStorage.getItem("lc_agency_slug") ||
    "";
  window.LCAdminConfig = {
    supabaseUrl: runtime.supabaseUrl || "",
    supabaseAnonKey: runtime.supabaseAnonKey || "",
    source: runtime.source || "api",
    agencySlug,
  };
})();