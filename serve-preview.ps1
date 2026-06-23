$root = Join-Path $PSScriptRoot 'public'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:3000/')
$listener.Start()
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relative = $context.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    $file = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $file = Join-Path $root 'index.html' }
    $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $context.Response.ContentType = switch ($extension) {
      '.html' { 'text/html; charset=utf-8' }
      '.css'  { 'text/css; charset=utf-8' }
      '.js'   { 'application/javascript; charset=utf-8' }
      '.svg'  { 'image/svg+xml' }
      default { 'application/octet-stream' }
    }
    $bytes = [IO.File]::ReadAllBytes($file)
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
}
