# ============================================================
#  Sube a Hostinger SOLO los archivos que cambiaron.
#
#  No borra nada: reemplaza esos archivos y deja el resto igual
#  (a diferencia del despliegue normal, que reemplaza public_html
#  entera). Los datos de clientes viven fuera de public_html, así
#  que no los toca de ninguna manera.
#
#  La contraseña se pide acá y se manda directo a Hostinger.
#  No se guarda en ningún archivo ni queda en el historial.
#
#  Para correrlo:
#    powershell -ExecutionPolicy Bypass -File tools\subir-a-hostinger.ps1
# ============================================================

$ErrorActionPreference = "Stop"

# Los cuatro archivos y adónde va cada uno dentro de public_html
$raiz = Split-Path -Parent $PSScriptRoot
$archivos = @(
  @{ local = "$raiz\admin\admin.js";        remoto = "public_html/admin/" },
  @{ local = "$raiz\main.js";               remoto = "public_html/" },
  @{ local = "$raiz\api\locked.php";        remoto = "public_html/api/" },
  @{ local = "$raiz\api\locked-lib.php";    remoto = "public_html/api/" }
)

foreach ($a in $archivos) {
  if (-not (Test-Path $a.local)) { throw "No encuentro $($a.local)" }
}

Write-Host ""
Write-Host "  Datos de FTP" -ForegroundColor Cyan
Write-Host "  Los encontrás en hPanel -> Archivos -> Cuentas FTP" -ForegroundColor DarkGray
Write-Host ""

$servidor = Read-Host "  Servidor FTP (ej: ftp.tudominio.com)"
$usuario  = Read-Host "  Usuario FTP  (ej: u123456789.tusitio)"
$clave    = Read-Host "  Contrasena" -AsSecureString

# La contraseña se pasa a curl por stdin (--config -), nunca como
# argumento: así no aparece en la lista de procesos ni en el historial.
$plana = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($clave))

$servidor = $servidor -replace '^ftps?://', '' -replace '/+$', ''
$fallos = 0

try {
  Write-Host ""
  foreach ($a in $archivos) {
    $nombre = Split-Path $a.local -Leaf
    Write-Host ("  Subiendo {0,-16} -> {1}" -f $nombre, $a.remoto) -NoNewline

    $cfg = @(
      "url = `"ftp://$servidor/$($a.remoto)`"",
      "user = `"$usuario`:$plana`"",
      "upload-file = `"$($a.local)`"",
      "ftp-create-dirs",
      "silent",
      "show-error"
    ) -join "`n"

    $salida = $cfg | & curl.exe --config - 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  OK" -ForegroundColor Green
    } else {
      $fallos++
      Write-Host "  FALLO" -ForegroundColor Red
      Write-Host "    $salida" -ForegroundColor DarkRed
    }
  }
} finally {
  # que la contraseña no quede dando vueltas en memoria
  $plana = $null
  [GC]::Collect()
}

Write-Host ""
if ($fallos -gt 0) {
  Write-Host "  Fallaron $fallos archivo(s). Revisa el servidor y el usuario." -ForegroundColor Red
  Write-Host "  Si dice 'Access denied', el usuario o la contrasena no son los correctos." -ForegroundColor DarkGray
  exit 1
}

# ---- comprobar que de verdad llego ----
# Se pide el archivo al sitio en vivo y se busca la linea arreglada.
# Si sigue apareciendo la vieja, algo no se subio donde debia.
Write-Host "  Comprobando en el sitio en vivo..." -ForegroundColor Cyan
$url = "https://powderblue-curlew-614934.hostingersite.com/admin/admin.js?_=" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
try {
  $js = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
  if ($js -match '\$\$\("\[data-lk\]') {
    Write-Host "  Listo: el panel ya tiene el arreglo." -ForegroundColor Green
    Write-Host "  Abrilo en una pestana nueva o con Ctrl+F5." -ForegroundColor DarkGray
  } else {
    Write-Host "  El archivo subio pero el sitio sigue devolviendo el viejo." -ForegroundColor Yellow
    Write-Host "  Puede ser cache del servidor: espera un minuto y volve a correr esto." -ForegroundColor DarkGray
  }
} catch {
  Write-Host "  No pude comprobarlo desde aca, pero la subida no dio error." -ForegroundColor Yellow
}
Write-Host ""
