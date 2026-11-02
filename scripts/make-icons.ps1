Add-Type -AssemblyName System.Drawing
foreach ($size in @(192, 512)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#142a43'))
    $graphics.ScaleTransform(($size / 192.0), ($size / 192.0))
    $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#8fe0d0'), 6)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#8fe0d0'))
    $graphics.TranslateTransform(96, 96)
    $graphics.RotateTransform(45)
    $graphics.DrawEllipse($pen, -52, -24, 104, 48)
    $graphics.RotateTransform(-90)
    $graphics.DrawEllipse($pen, -52, -24, 104, 48)
    $graphics.FillEllipse($brush, -10, -10, 20, 20)
    $output = Join-Path $PSScriptRoot "..\public\icon-$size.png"
    $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
