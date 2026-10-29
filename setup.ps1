# Installation en une commande sur Windows (Docker Desktop requis)
# Clic droit sur le dossier > Ouvrir dans le terminal, puis :
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Continue'
# UTF-8 partout sinon les emojis des bios sont casses a l'import
$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
Set-Location $PSScriptRoot

function Write-Utf8NoBom($path, $text) {
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot $path), $text, (New-Object Text.UTF8Encoding $false))
}

Write-Host "`n=== slibart puant v2 : installation ===`n" -ForegroundColor Cyan

# 1. Docker
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker ne repond pas. Lance Docker Desktop puis relance ce script." -ForegroundColor Red
    exit 1
}

# 2. .env
if (-not (Test-Path .env)) {
    Write-Host "Creation du .env (les infos restent sur ton PC)" -ForegroundColor Yellow
    $token = Read-Host "Token du bot (Developer Portal > Bot > Reset Token)"
    $guild = Read-Host "ID du serveur Discord (clic droit sur le serveur > Copier l'identifiant, Entree pour passer)"
    $owner = Read-Host "Ton ID Discord pour les commandes admin (clic droit sur toi > Copier l'identifiant)"
    $chars = (48..57) + (65..90) + (97..122)
    $dbpass = -join ($chars | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    $env = Get-Content .env.example -Raw
    $env = $env -replace '(?m)^DISCORD_TOKEN=.*$', "DISCORD_TOKEN=$token"
    $env = $env -replace '(?m)^GUILD_ID=.*$', "GUILD_ID=$guild"
    $env = $env -replace '(?m)^OWNER_IDS=.*$', "OWNER_IDS=$owner"
    $env = $env -replace '(?m)^DB_PASSWORD=.*$', "DB_PASSWORD=$dbpass"
    Write-Utf8NoBom '.env' $env
    Write-Host ".env cree (mot de passe de base genere automatiquement)." -ForegroundColor Green
} else {
    Write-Host ".env deja present, on le garde." -ForegroundColor Green
}
$dbpass = ((Get-Content .env | Where-Object { $_ -match '^DB_PASSWORD=' }) -replace '^DB_PASSWORD=', '').Trim()

# 3. Base de donnees
Write-Host "`nDemarrage de la base..." -ForegroundColor Cyan
docker compose up -d db
for ($i = 0; $i -lt 60; $i++) {
    $state = docker inspect -f '{{.State.Health.Status}}' (docker compose ps -q db)
    if ($state -eq 'healthy') { break }
    Start-Sleep 2
}
if ($state -ne 'healthy') { Write-Host "La base ne demarre pas : docker compose logs db" -ForegroundColor Red; exit 1 }

# 4. Bot
Write-Host "`nConstruction et demarrage du bot..." -ForegroundColor Cyan
docker compose up -d --build bot
Write-Host "`nC'est lance. Logs ci-dessous (Ctrl+C pour quitter les logs, le bot continue de tourner)." -ForegroundColor Green
Write-Host "Arreter : docker compose down   |   Relancer apres modif : docker compose up -d --build`n"
docker compose logs -f bot
