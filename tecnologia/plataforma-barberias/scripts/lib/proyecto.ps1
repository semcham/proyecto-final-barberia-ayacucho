# Funcionalidad 009 (research R01b): guardián del proyecto de Docker Compose, en PowerShell puro (no necesita Node).
# Uso en otro script:  & "$PSScriptRoot\..\scripts\lib\proyecto.ps1"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Código 0 si COMPOSE_PROJECT_NAME es un proyecto propio; 6 si falta o es el del responsable.
$proyecto = "$env:COMPOSE_PROJECT_NAME".Trim()
if ($proyecto -eq '') {
  [Console]::Error.WriteLine('Falta COMPOSE_PROJECT_NAME. Los scripts de 009 nunca usan el proyecto por defecto: fija uno propio, por ejemplo COMPOSE_PROJECT_NAME=barberias-verificacion.')
  exit 6
}
if ($proyecto.ToLowerInvariant() -eq 'plataforma-barberias') {
  [Console]::Error.WriteLine("COMPOSE_PROJECT_NAME=$proyecto es el proyecto de desarrollo del responsable: no se usa para medir ni verificar.")
  exit 6
}
exit 0
