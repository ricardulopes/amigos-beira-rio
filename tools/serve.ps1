# Servidor estático mínimo para desenvolvimento local (Windows, sem dependências).
# Uso: powershell -ExecutionPolicy Bypass -File tools/serve.ps1 [-Port 8080]
param([int]$Port = 8080)
$root = Split-Path -Parent $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8';
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json';
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Servindo $root em http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404')
    } else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($file)
    }
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { Write-Host $_ } finally { $ctx.Response.Close() }
}
