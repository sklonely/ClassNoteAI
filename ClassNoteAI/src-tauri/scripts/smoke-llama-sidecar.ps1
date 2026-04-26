param(
    [string]$BinaryDir = "resources/binaries",
    [string]$ModelPath = "",
    [int]$Port = 18080,
    [switch]$ExpectCuda
)

$ErrorActionPreference = "Stop"

$server = Join-Path $BinaryDir "llama-server.exe"
if (!(Test-Path $server)) {
    throw "llama-server.exe not found under $BinaryDir"
}

Write-Host "[llama-smoke] version:"
& $server --version
if ($LASTEXITCODE -ne 0) {
    throw "llama-server --version failed with exit code $LASTEXITCODE"
}

if (!$ModelPath) {
    Write-Host "[llama-smoke] no model path supplied; binary load smoke passed."
    exit 0
}

if (!(Test-Path $ModelPath)) {
    throw "Model file not found: $ModelPath"
}

$log = Join-Path ([System.IO.Path]::GetTempPath()) "classnoteai-llama-smoke-$Port.log"
Remove-Item -Force $log -ErrorAction SilentlyContinue

$args = @(
    "-m", $ModelPath,
    "-ngl", "99",
    "-c", "1024",
    "--port", "$Port",
    "--host", "127.0.0.1",
    "--no-jinja",
    "--temp", "0.0"
)

Write-Host "[llama-smoke] starting $server on port $Port"
$process = Start-Process `
    -FilePath $server `
    -ArgumentList $args `
    -WorkingDirectory $BinaryDir `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardError $log `
    -RedirectStandardOutput ([System.IO.Path]::GetTempFileName())

try {
    $deadline = (Get-Date).AddSeconds(45)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 | Out-Null
            $healthy = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (!$healthy) {
        Get-Content $log -ErrorAction SilentlyContinue
        throw "llama-server health check timed out"
    }

    $body = @{
        model = "local"
        messages = @(@{ role = "user"; content = "Reply with OK only." })
        max_tokens = 4
        temperature = 0
    } | ConvertTo-Json -Depth 5
    $response = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$Port/v1/chat/completions" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 30
    $text = $response.choices[0].message.content
    if (!$text) {
        throw "llama-server returned an empty completion"
    }

    if ($ExpectCuda) {
        $logText = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($logText -notmatch "CUDA|ggml_cuda|loaded CUDA") {
            throw "CUDA was expected but the llama-server log did not mention CUDA"
        }
    }

    Write-Host "[llama-smoke] completion: $text"
} finally {
    if ($process -and !$process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
}
