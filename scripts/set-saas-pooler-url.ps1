$ErrorActionPreference = "Stop"

$envPath = Join-Path (Get-Location) ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env est absent. Configurez d'abord le projet SaaS de test."
}

$content = [System.IO.File]::ReadAllText($envPath)
$refMatch = [regex]::Match($content, "(?m)^SAAS_PROJECT_REF=([a-z0-9]+)\s*$")
if (-not $refMatch.Success) {
  throw "SAAS_PROJECT_REF est absent ou invalide dans .env."
}

$projectRef = $refMatch.Groups[1].Value.ToLowerInvariant()
if ($projectRef -eq "dqygspzmndcsbkxeiulm") {
  throw "Le projet Supabase historique de l'agence est interdit."
}

$databaseUrl = [System.Net.NetworkCredential]::new(
  "",
  (Read-Host "Session pooler URI PostgreSQL port 5432 (saisie masquée)" -AsSecureString)
).Password

try {
  $uri = [Uri]$databaseUrl
} catch {
  throw "URI PostgreSQL invalide. Encodez les caractères spéciaux du mot de passe (par ex. @ en %40)."
}

$username = [Uri]::UnescapeDataString(($uri.UserInfo -split ":", 2)[0])
$poolerRef = ""
if ($uri.Host -match "^[a-z0-9.-]+\.pooler\.supabase\.com$" -and $username -match "^postgres\.([a-z0-9]+)$") {
  $poolerRef = $Matches[1].ToLowerInvariant()
}

if (
  $uri.Scheme -notin @("postgres", "postgresql") -or
  $uri.Port -ne 5432 -or
  $poolerRef -ne $projectRef
) {
  throw "URI refusée : utilisez le Session pooler, port 5432, du même projet."
}

$pattern = "(?m)^SAAS_DATABASE_URL=.*$"
if ([regex]::Matches($content, $pattern).Count -ne 1) {
  throw "La variable SAAS_DATABASE_URL doit apparaître une seule fois dans .env."
}

$updated = [regex]::Replace(
  $content,
  $pattern,
  [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    "SAAS_DATABASE_URL=$databaseUrl"
  },
  1
)
[System.IO.File]::WriteAllText(
  $envPath,
  $updated,
  [System.Text.UTF8Encoding]::new($false)
)

$databaseUrl = $content = $updated = $null
Write-Host "URI Session pooler enregistrée; projet, utilisateur et port vérifiés. Aucune valeur secrète affichée." -ForegroundColor Green
