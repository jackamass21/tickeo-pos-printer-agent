Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath($rect, $radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(139, 24, 246)), ([System.Drawing.Color]::FromArgb(75, 34, 214)), 45
$g.FillRectangle($brush, $rect)

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$purple = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(109, 25, 216))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(109, 25, 216)), 12
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$ticket = New-Object System.Drawing.Drawing2D.GraphicsPath
$ticket.AddPolygon([System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 54, 48),
  (New-Object System.Drawing.Point 157, 35),
  (New-Object System.Drawing.Point 175, 55),
  (New-Object System.Drawing.Point 207, 59),
  (New-Object System.Drawing.Point 224, 165),
  (New-Object System.Drawing.Point 205, 181),
  (New-Object System.Drawing.Point 193, 223),
  (New-Object System.Drawing.Point 91, 236),
  (New-Object System.Drawing.Point 75, 215),
  (New-Object System.Drawing.Point 43, 211),
  (New-Object System.Drawing.Point 27, 103),
  (New-Object System.Drawing.Point 48, 88)
))
$matrix = New-Object System.Drawing.Drawing2D.Matrix
$matrix.RotateAt(-8, (New-Object System.Drawing.PointF 128, 128))
$ticket.Transform($matrix)
$g.FillPath($white, $ticket)

$inner = New-Object System.Drawing.Rectangle 75, 77, 100, 112
$innerPath = New-RoundedRectPath $inner 22
$g.DrawPath($pen, $innerPath)

$play = New-Object System.Drawing.Drawing2D.GraphicsPath
$play.AddPolygon([System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 111, 102),
  (New-Object System.Drawing.Point 111, 164),
  (New-Object System.Drawing.Point 162, 133)
))
$g.FillPath($purple, $play)

$printerBody = New-Object System.Drawing.Rectangle 138, 130, 93, 64
$paper = New-Object System.Drawing.Rectangle 158, 99, 54, 43
$receipt = New-Object System.Drawing.Rectangle 157, 178, 58, 52
$paperPath = New-RoundedRectPath $paper 8
$printerPath = New-RoundedRectPath $printerBody 14
$g.FillPath($white, $paperPath)
$g.FillPath($white, $printerPath)
$g.FillRectangle($white, $receipt)
$g.DrawPath($pen, $printerPath)
$g.DrawPath($pen, $paperPath)
$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(139, 24, 246)), 5
$g.DrawLine($linePen, 166, 195, 207, 195)
$g.DrawLine($linePen, 164, 208, 210, 208)
$g.FillEllipse($purple, 213, 151, 12, 12)

$pngPath = Join-Path $assets "icon.png"
$icoPath = Join-Path $assets "icon.ico"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$icon.Save($stream)
$stream.Close()

$g.Dispose()
$bmp.Dispose()
$ticket.Dispose()
$innerPath.Dispose()
$play.Dispose()
$paperPath.Dispose()
$printerPath.Dispose()
$brush.Dispose()
$white.Dispose()
$purple.Dispose()
$pen.Dispose()
$linePen.Dispose()

Write-Host "Generated $pngPath and $icoPath"
