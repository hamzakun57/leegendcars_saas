# ============================================================================
# Leegend Cars — hébergement de la copie SaaS
# ============================================================================
# La copie SaaS et l'application historique de l'agence doivent rester sur des
# projets Supabase séparés. Ne jamais lancer une migration ou un déploiement
# contre la configuration Supabase de l'agence.
#
# 0. Préparer un nouveau projet Supabase pour le SaaS
# ----------------------------------------------------------------------------
# Configurer uniquement les variables SAAS_* de .env.example. Le build, le
# setup et l'import refusent le project ref historique; le setup et l'import
# vérifient aussi que l'URL PostgreSQL pointe sur le même projet.
# `npm run db:setup:saas` applique le schéma, les policies, les fonctions et la
# migration multi-agences au projet indiqué par SAAS_DATABASE_URL.
#
# Créer un propriétaire et son agence :
#   npm run agency:create -- <slug> "<nom de l'agence>" <email-propriétaire>
# Exemple :
#   npm run agency:create -- agence-exemple "Agence Exemple" admin@exemple.ma
# Le mot de passe est généré et affiché une seule fois si l'e-mail n'existe pas.
# Le propriétaire configure ensuite le nom public, les contacts, les horaires,
# les lieux de prise en charge et le supplément siège bébé dans Réglages.
#
# Déployer le site avec SAAS_DATA_SOURCE=supabase, SAAS_PROJECT_REF,
# SAAS_SUPABASE_URL et SAAS_SUPABASE_ANON_KEY configurés dans l'environnement
# du build Netlify. SAAS_AGENCY_SLUG est facultatif; sinon le site reçoit
# l'agence depuis `?agency=<slug>`.
#
# Aucun import de l'application existante n'est lancé par ces commandes. Pour
# reprendre des données, créer une sauvegarde, choisir explicitement les
# données/fichiers et réaliser un import contrôlé dans le nouveau projet SaaS.
# Le script d'import refuse une agence cible déjà occupée et exige :
#   npm run migrate:sqlite -- --agency <slug> --confirm-target
# Il n'a pas été exécuté. Ne le lancer qu'après validation de l'agence cible,
# des fichiers locaux et d'une sauvegarde exploitable.
# La facturation récurrente automatique est hors périmètre de la V1.
#
# Le mode Express / `npm run db:setup` ci-dessous reste un mode mono-agence
# historique et ne constitue pas une installation multi-tenant.
#
# ---------------------------------------------------------------------------
# Le site est désormais « client-first » :
#
#   Netlify          sert les fichiers (site public + back-office)
#   Supabase Auth    authentifie l'administrateur
#   Supabase Postgres  les données
#   Supabase Storage   les fichiers (photos, CIN, contrats)
#   Supabase Edge Functions  ce qui doit rester côté serveur :
#                     envoi de fichiers, contrat, facture, signature à distance
#
# Le serveur Express (dossier server/) est conservé et fonctionne toujours :
# il sert au développement local et sert de filet si un hébergeur Node est
# préféré. L'interface choisit son chemin toute seule, sans changer d'écran.
#
# ---------------------------------------------------------------------------
# 1. Préparer la base
# ---------------------------------------------------------------------------
#   npm run db:setup:saas # projet SaaS séparé; migration tenant incluse
#
# 2. Compte administrateur
# ---------------------------------------------------------------------------
#   npm run agency:create -- <slug> "<nom de l'agence>" admin@exemple.ma
#   → affiche un mot de passe généré, affiché une seule fois
#
# 3. Construire les fichiers statiques
# ---------------------------------------------------------------------------
#   npm run build
#   Produit : runtime-config.js, vendor/supabase.js, admin-assets/, admin/index.html,
#   admin/login.html et les gabarits de documents pour les Edge Functions.
#   Les pages d'administration sont générées depuis server/views.js : il n'y a
#   donc qu'une seule version de l'écran.
#
# 4. Déployer les Edge Functions
# ---------------------------------------------------------------------------
#   npm install -g supabase
#   supabase login
#   supabase link --project-ref "$SAAS_PROJECT_REF"
#   supabase functions deploy upload
#   supabase functions deploy document
#   supabase functions deploy signature
#
# 5. Déployer le site sur Netlify
# ---------------------------------------------------------------------------
#   git push          # Netlify déclenche « npm run build » automatiquement
#
# Aucune variable d'environnement n'est nécessaire chez Netlify : la seule
# clé présente dans le navigateur est la clé publique « anon », et elle ne
# donne aucun droit — les règles d'accès (supabase/policies.sql) décident de
# tout. La clé « service_role » reste exclusivement dans les Edge Functions,
# où Supabase la fournit automatiquement.
#
# ---------------------------------------------------------------------------
# Où va quoi
# ---------------------------------------------------------------------------
# | Élément            | Stockage                                  |
# |--------------------|-------------------------------------------|
# | Flotte             | table vehicles                            |
# | Réservations       | table reservations (+ payments, attachments)|
# | Clients            | table clients                             |
# | Maintenance        | table maintenance                         |
# | Photos, CIN, PDF   | bucket Storage « uploads »                 |
# | Connexion admin    | Supabase Auth + table admin_accounts       |
# | Contrats, factures | Edge Function « document »                 |
# | Signature          | Edge Function « signature »                |
#
# ---------------------------------------------------------------------------
# Sécurité en place
# ---------------------------------------------------------------------------
# - RLS activée sur toutes les tables, sans policy pour le rôle « anon ».
# - Un visiteur ne peut que lire la flotte active et envoyer une demande.
# - Un déclencheur force toute demande entrante à « nouvelle » : ni statut,
#   ni numéro de facture, ni encaissement, ni signature ne peuvent être
#   usurpés, même avec la clé publique.
# - Un compte connecté non administrateur n'accède à rien de plus.
# - Les Edge Functions exigent un administrateur authentifié, sauf la
#   signature, protégée par un jeton de 24 octets aléatoires.
# - Les fichiers sont validés sur leur signature binaire, jamais sur leur
#   nom : un script renommé en .jpg est refusé.
#
# ---------------------------------------------------------------------------
# Vérifier que tout va bien
# ---------------------------------------------------------------------------
#   npm test        # 238 contrôles sur les 9 suites
#
# Chaque suite est autonome et nettoie ce qu'elle a créé.
#
# ---------------------------------------------------------------------------
# Répartition des modes
# ---------------------------------------------------------------------------
# assets/js/data.js       source + clé publique injectées au build depuis SAAS_*
# server/public/admin-config.js   même configuration et agence active
#
# « auto » utilise Supabase s'il est configuré, le serveur sinon.
#