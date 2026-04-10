param(
    [string]$TaskName = "HomeCommandCenterAgent",
    [int]$Port = 5000,
    [string]$Token = "",
    [string]$AllowedProgramsFile = "allowed-programs.txt"
)

$ErrorActionPreference = "Stop"

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentFile = Join-Path $agentDir "agent.py"

if (-not (Test-Path $agentFile)) {
    throw "agent.py nicht gefunden: $agentFile"
}

$python = $null
$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if ($pyCmd) {
    $python = $pyCmd.Source
} else {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        $python = $pythonCmd.Source
    }
}

if (-not $python) {
    throw "Kein Python gefunden. Bitte Python installieren (oder py Launcher)."
}

$allowedArg = $AllowedProgramsFile
if (-not [System.IO.Path]::IsPathRooted($allowedArg)) {
    $allowedArg = Join-Path $agentDir $allowedArg
}

$args = "\"$agentFile\" --port $Port --allowed \"$allowedArg\""
if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $args += " --token \"$Token\""
}

$action = New-ScheduledTaskAction -Execute $python -Argument $args -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Autostart Task angelegt: $TaskName"
Write-Host "Teststart jetzt mit: Start-ScheduledTask -TaskName \"$TaskName\""
