param(
    [int]$Port = 5000,
    [string]$Token = "",
    [string]$AllowedProgramsFile = ".\\allowed-programs.txt"
)

$ErrorActionPreference = "Stop"

function Write-JsonResponse {
    param(
        [Parameter(Mandatory=$true)]$Context,
        [int]$StatusCode = 200,
        [hashtable]$Body = @{}
    )

    $json = ($Body | ConvertTo-Json -Depth 8)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = "application/json; charset=utf-8"
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Get-JsonBody {
    param([Parameter(Mandatory=$true)]$Request)

    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    $text = $reader.ReadToEnd()
    $reader.Close()

    if ([string]::IsNullOrWhiteSpace($text)) {
        return @{}
    }

    return ($text | ConvertFrom-Json)
}

function Is-TokenValid {
    param([Parameter(Mandatory=$true)]$Request)

    if ([string]::IsNullOrWhiteSpace($Token)) {
        return $true
    }

    $auth = [string]$Request.Headers["Authorization"]
    if ($auth.StartsWith("Bearer ")) {
        $value = $auth.Substring(7).Trim()
        return $value -eq $Token
    }

    return $false
}

function Get-AllowedPrograms {
    if (-not (Test-Path $AllowedProgramsFile)) {
        return @()
    }

    return Get-Content $AllowedProgramsFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

function Start-AllowedProgram {
    param([string]$Name)

    $allowed = Get-AllowedPrograms
    if (-not $allowed -or -not ($allowed -contains $Name)) {
        throw "Programm nicht in allow-list: $Name"
    }

    Start-Process -FilePath $Name | Out-Null
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://*:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Windows Agent laeuft auf $prefix"
if ($Token) {
    Write-Host "Token-Schutz aktiv"
} else {
    Write-Host "Warnung: Token-Schutz aus"
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $path = $req.Url.AbsolutePath.ToLowerInvariant()
        $method = $req.HttpMethod.ToUpperInvariant()

        if (-not (Is-TokenValid -Request $req)) {
            Write-JsonResponse -Context $ctx -StatusCode 401 -Body @{ ok = $false; message = "unauthorized" }
            continue
        }

        if ($method -eq "GET" -and $path -eq "/health") {
            Write-JsonResponse -Context $ctx -Body @{ ok = $true; host = $env:COMPUTERNAME; time = (Get-Date).ToString("s") }
            continue
        }

        if ($method -eq "POST" -and $path -eq "/program/start") {
            $body = Get-JsonBody -Request $req
            $name = [string]$body.name

            if ([string]::IsNullOrWhiteSpace($name)) {
                Write-JsonResponse -Context $ctx -StatusCode 400 -Body @{ ok = $false; message = "name fehlt" }
                continue
            }

            try {
                Start-AllowedProgram -Name $name
                Write-JsonResponse -Context $ctx -Body @{ ok = $true; started = $name }
            } catch {
                Write-JsonResponse -Context $ctx -StatusCode 400 -Body @{ ok = $false; message = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "POST" -and $path -eq "/program/stop") {
            $body = Get-JsonBody -Request $req
            $name = [string]$body.name

            if ([string]::IsNullOrWhiteSpace($name)) {
                Write-JsonResponse -Context $ctx -StatusCode 400 -Body @{ ok = $false; message = "name fehlt" }
                continue
            }

            Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-JsonResponse -Context $ctx -Body @{ ok = $true; stopped = $name }
            continue
        }

        if ($method -eq "POST" -and $path -eq "/monitor/off") {
            $source = @"
using System;
using System.Runtime.InteropServices;
public class MonitorControl {
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
            Add-Type -TypeDefinition $source -ErrorAction SilentlyContinue | Out-Null
            [MonitorControl]::SendMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2) | Out-Null
            Write-JsonResponse -Context $ctx -Body @{ ok = $true; action = "monitor/off" }
            continue
        }

        Write-JsonResponse -Context $ctx -StatusCode 404 -Body @{ ok = $false; message = "route not found" }
    } catch {
        Write-Host "Agent error: $($_.Exception.Message)"
    }
}
