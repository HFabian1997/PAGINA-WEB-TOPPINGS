param(
  [string]$Dir = "C:\Users\FABIAN\Downloads\conectar-hostinger-v3\toppings\assets\img"
)

Add-Type -AssemblyName System.Drawing

$heroLike = @("hero", "promo-banner", "zona-secreta-bg", "nosotros-local")

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)

function Resize-And-Save($path, $maxWidth, $quality) {
  $bytesBefore = (Get-Item $path).Length
  $img = [System.Drawing.Image]::FromFile($path)
  try {
    $w = $img.Width
    $h = $img.Height
    if ($w -gt $maxWidth) {
      $newW = $maxWidth
      $newH = [int]([math]::Round($h * ($maxWidth / $w)))
    } else {
      $newW = $w
      $newH = $h
    }
    $bmp = New-Object System.Drawing.Bitmap($newW, $newH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $newW, $newH)
    $g.Dispose()

    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$quality)
    $tmpPath = "$path.tmp"
    $bmp.Save($tmpPath, $jpegCodec, $encoderParams)
    $bmp.Dispose()
    $img.Dispose()
    Move-Item -Force $tmpPath $path
  } catch {
    $img.Dispose()
    throw
  }
  $bytesAfter = (Get-Item $path).Length
  $name = Split-Path $path -Leaf
  "{0,-22} {1,4}x{2,-4}  {3,7} KB -> {4,7} KB" -f $name, $newW, $newH, [int]($bytesBefore/1024), [int]($bytesAfter/1024)
}

Get-ChildItem $Dir -Filter *.jpg | ForEach-Object {
  $base = $_.BaseName
  if ($heroLike -contains $base) {
    Resize-And-Save $_.FullName 1800 78
  } else {
    Resize-And-Save $_.FullName 1100 78
  }
}
