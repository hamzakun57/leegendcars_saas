$ErrorActionPreference = "Stop"

$envPath = Join-Path (Get-Location) ".env"
if (Test-Path -LiteralPath $envPath) {
  throw ".env existe déjà. Arrêt pour ne pas écraser une configuration."
}

Write-Host "Utilisez uniquement le nouveau projet Supabase de test." -ForegroundColor Yellow
Write-Host "Révoquez d'abord la clé secrète publiée dans le chat; ne la saisissez pas." -ForegroundColor Yellow

$projectRef = (Read-Host "Project ID / ref").Trim().ToLowerInvariant()
$projectUrl = (Read-Host "Project URL (https://<ref>.supabase.co)").Trim().TrimEnd("/")
$agencySlug = "agence-test-1"

$anonKey = [System.Net.NetworkCredential]::new(
  "",
  (Read-Host "Publishable key (saisie masquée)" -AsSecureString)
).Password
$databaseUrl = [System.Net.NetworkCredential]::new(
  "",
  (Read-Host "URI PostgreSQL Session pooler, port 5432 (saisie masquée)" -AsSecureString)
).Password
$serviceKey = [System.Net.NetworkCredential]::new(
  "",
  (Read-Host "Nouvelle secret/service_role key après rotation (saisie masquée)" -AsSecureString)
).Password

if ($projectRef -eq "dqygspzmndcsbkxeiulm") {
  throw "Le projet Supabase historique de l'agence est interdit."
}

$parsedProjectUrl = [Uri]$projectUrl
if (
  $parsedProjectUrl.Scheme -ne "https" -or
  $parsedProjectUrl.Host -ne "$projectRef.supabase.co"
) {
  throw "Le Project URL ne correspond pas au Project ID."
}

if ($agencySlug -notmatch "^[a-z0-9]+(-[a-z0-9]+)*$") {
  throw "Le slug agence est invalide."
}

try {
  $parsedDatabaseUrl = [Uri]$databaseUrl
} catch {
  throw "URI PostgreSQL invalide. Dans le mot de passe, encodez les caractères spéciaux (par ex. @ en %40), sans crochets autour du mot de passe."
}
if ($parsedDatabaseUrl.Scheme -notin @("postgres", "postgresql")) {
  throw "L'URL de base doit être PostgreSQL."
}

$databaseUser = [Uri]::UnescapeDataString(($parsedDatabaseUrl.UserInfo -split ":", 2)[0])
$databaseRef = ""
if ($parsedDatabaseUrl.Host.StartsWith("db.") -and $parsedDatabaseUrl.Host.EndsWith(".supabase.co")) {
  $databaseRef = $parsedDatabaseUrl.Host.Split(".")[1].ToLowerInvariant()
} elseif (
  $parsedDatabaseUrl.Host.EndsWith(".pooler.supabase.com") -and
  $databaseUser.StartsWith("postgres.")
) {
  $databaseRef = $databaseUser.Substring("postgres.".Length).ToLowerInvariant()
}

if ($databaseRef -ne $projectRef) {
  throw "L'URI PostgreSQL ne correspond pas au projet attendu. Choisissez le Session pooler, port 5432."
}
if (-not $anonKey -or -not $serviceKey) {
  throw "Clé publique ou nouvelle clé secrète manquante."
}

$lines = @(
  "SAAS_PROJECT_REF=$projectRef"
  "SAAS_SUPABASE_URL=$projectUrl"
  "SAAS_DATABASE_URL=$databaseUrl"
  "SAAS_SUPABASE_ANON_KEY=$anonKey"
  "SAAS_SUPABASE_SERVICE_ROLE_KEY=$serviceKey"
  "SAAS_DATA_SOURCE=supabase"
  "SAAS_AGENCY_SLUG=$agencySlug"
)
[System.IO.File]::WriteAllText(
  $envPath,
  ($lines -join [Environment]::NewLine) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)

$anonKey = $databaseUrl = $serviceKey = $lines = $null
Write-Host ".env créé; URL du projet et URI PostgreSQL vérifiées. Aucune clé n'a été affichée." -ForegroundColor Green
