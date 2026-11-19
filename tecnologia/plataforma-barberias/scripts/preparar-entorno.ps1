# Funcionalidad 009 (US3; research R03): genera el .env de DESARROLLO desde .env.example.
# Uso, desde tecnologia/plataforma-barberias/:  .\scripts\preparar-entorno.ps1 [-Subred a.b.c]
# Usa el Node del equipo (22 o mayor) si existe; si no, la imagen node:22 de Docker (la misma de Compose).
# Nunca escribe en un .env que ya exista: solo informa los NOMBRES de las variables que le faltan.
# Funciona en Windows PowerShell 5.1 y en PowerShell 7.
param(
  [string]$Subred
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$argumentos = @('scripts/preparar-entorno.mjs')
if ($Subred) { $argumentos += @('--subred', $Subred) }

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $mayor = [int](& node -p "process.versions.node.split('.')[0]")
  if ($mayor -ge 22) {
    & node @argumentos
    exit $LASTEXITCODE
  }
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  & docker run --rm -v "${raiz}:/w" -w /w node:22 node @argumentos
  exit $LASTEXITCODE
}

Write-Error 'Hace falta Node 22 o mayor, o Docker, para generar el .env.'
exit 1
