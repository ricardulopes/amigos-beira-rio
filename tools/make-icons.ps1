# Gera, a partir do escudo oficial (JPEG com fundo branco), o escudo com fundo transparente e os ícones do PWA.
#   img/escudo-abr.png         escudo recortado (fundo transparente), usado no cabeçalho e na tela inicial
#   icons/icon-192.png         ícone "any" (fundo transparente)
#   icons/icon-512.png         ícone "any" (fundo transparente)
#   icons/icon-maskable-512.png ícone "maskable" (fundo azul #002B7F, escudo dentro da área segura)
#   icons/apple-touch-180.png  ícone para iOS (fundo azul, sem transparência)
# Uso: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
param([string]$Source = 'Escudo Pelada Beira Rio.jpeg')
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ShieldCutter {
  // Remove o fundo claro ligado às bordas (preenchimento por inundação) e suaviza a borda.
  public static Bitmap Cut(Bitmap src, int hardMin, int softMin) {
    int w = src.Width, h = src.Height;
    Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
    BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int[] px = new int[w * h];
    Marshal.Copy(d.Scan0, px, 0, px.Length);
    bool[] bg = new bool[w * h];
    Queue<int> q = new Queue<int>();
    Func<int, int> mn = (c) => Math.Min((c >> 16) & 255, Math.Min((c >> 8) & 255, c & 255));
    for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h - 1) * w + x); }
    for (int y = 0; y < h; y++) { q.Enqueue(y * w); q.Enqueue(y * w + w - 1); }
    while (q.Count > 0) {
      int i = q.Dequeue();
      if (bg[i] || mn(px[i]) < hardMin) continue;
      bg[i] = true;
      int x = i % w, y = i / w;
      if (x > 0) q.Enqueue(i - 1);
      if (x < w - 1) q.Enqueue(i + 1);
      if (y > 0) q.Enqueue(i - w);
      if (y < h - 1) q.Enqueue(i + w);
    }
    int[] outPx = new int[w * h];
    for (int i = 0; i < px.Length; i++) {
      if (bg[i]) { outPx[i] = 0; continue; }
      int x = i % w, y = i / w;
      bool edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      int c = px[i];
      if (edge) {
        // pixel de transição: separa a mistura com o branco do fundo
        double wt = Math.Max(0, Math.Min(1, (mn(c) - softMin) / (double)(hardMin - softMin)));
        double a = 1 - wt;
        if (a <= 0.02) { outPx[i] = 0; continue; }
        int r = Clamp((((c >> 16) & 255) - 255 * wt) / a), gg = Clamp((((c >> 8) & 255) - 255 * wt) / a), b = Clamp(((c & 255) - 255 * wt) / a);
        outPx[i] = ((int)(a * 255) << 24) | (r << 16) | (gg << 8) | b;
      } else outPx[i] = c | unchecked((int)0xFF000000);
    }
    Marshal.Copy(outPx, 0, d.Scan0, outPx.Length);
    bmp.UnlockBits(d);
    return bmp;
  }
  static int Clamp(double v) { return (int)Math.Max(0, Math.Min(255, Math.Round(v))); }

  // Retângulo mínimo com pixels visíveis.
  public static Rectangle Bounds(Bitmap bmp) {
    int w = bmp.Width, h = bmp.Height, x0 = w, y0 = h, x1 = -1, y1 = -1;
    BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int[] px = new int[w * h];
    Marshal.Copy(d.Scan0, px, 0, px.Length);
    bmp.UnlockBits(d);
    for (int i = 0; i < px.Length; i++) {
      if (((px[i] >> 24) & 255) < 16) continue;
      int x = i % w, y = i / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root $Source
if (-not (Test-Path $srcPath)) { throw "Escudo não encontrado: $srcPath" }
New-Item -ItemType Directory -Force (Join-Path $root 'icons') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'img') | Out-Null

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$cut = [ShieldCutter]::Cut($src, 228, 120)
$box = [ShieldCutter]::Bounds($cut)
$shield = $cut.Clone($box, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$src.Dispose(); $cut.Dispose()

function New-Canvas([int]$w, [int]$h, $bg) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  if ($bg) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  return @($bmp, $g)
}

# Desenha o escudo centralizado ocupando `fill` da altura do quadrado.
function Save-Icon([int]$size, [string]$name, [double]$fill, $bg) {
  $bmp, $g = New-Canvas $size $size $bg
  $h = [double]$size * $fill
  $w = $h * $shield.Width / $shield.Height
  $g.DrawImage($shield, [float](($size - $w) / 2), [float](($size - $h) / 2), [float]$w, [float]$h)
  $bmp.Save((Join-Path $root "icons\$name"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$blue = [System.Drawing.ColorTranslator]::FromHtml('#002B7F')

# Escudo para a interface (altura 480 px: nítido até em telas de alta densidade).
$eh = 480; $ew = [int][Math]::Round($eh * $shield.Width / $shield.Height)
$bmp, $g = New-Canvas $ew $eh $null
$g.DrawImage($shield, 0, 0, $ew, $eh)
$bmp.Save((Join-Path $root 'img\escudo-abr.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Save-Icon 192 'icon-192.png' 0.96 $null
Save-Icon 512 'icon-512.png' 0.96 $null
Save-Icon 512 'icon-maskable-512.png' 0.66 $blue
Save-Icon 180 'apple-touch-180.png' 0.84 $blue
Save-Icon 32 'favicon-32.png' 1.0 $null
$shield.Dispose()
Write-Host "Escudo e ícones gerados em $root\img e $root\icons"
