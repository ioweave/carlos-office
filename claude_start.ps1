#requires -Version 5.1

param(
    [switch]$Continue,
    [string]$Resume,
    [string]$Model
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

Write-Host '[start] Meridian Labs LLC - Claude Code launcher' -ForegroundColor Cyan

# ── Validate mutually exclusive Claude session options ─────────────────────────
if ($Continue -and $Resume) {
    Write-Host '[start] ERROR: Use either -Continue or -Resume, not both.' -ForegroundColor Red
    exit 1
}

# ── Prereq checks ──────────────────────────────────────────────────────────────
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host '[start] ERROR: python not on PATH. Run .\setup.ps1 first.' -ForegroundColor Red
    exit 1
}

& python -c "import graphify; from watchdog.observers import Observer" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[start] ERROR: graphify or watchdog missing. Run .\setup.ps1 first.' -ForegroundColor Red
    exit 1
}

if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
    Write-Host '[start] ERROR: graphify command not on PATH. Run .\setup.ps1 first.' -ForegroundColor Red
    exit 1
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host '[start] ERROR: ollama not on PATH. Install/configure Ollama, then re-run.' -ForegroundColor Red
    exit 1
}

& python -c "import openai" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[start] ERROR: Python package "openai" is missing.' -ForegroundColor Red
    Write-Host '[start] Fix: python -m pip install openai' -ForegroundColor Yellow
    Write-Host '[start] If Graphify was installed with uv, use: uv tool install "graphifyy[ollama]" --force' -ForegroundColor Yellow
    exit 1
}

# ── Model selection must happen before Graphify ────────────────────────────────
$defaultModel = 'glm-5.2:cloud'
# $defaultModel = 'minimax-m3:cloud'

if (-not $Model) {
    Write-Host ''
    $useDefaultModel = Read-Host "[start] Use default model ${defaultModel}? (Y/N) [Y]"

    if ([string]::IsNullOrWhiteSpace($useDefaultModel) -or $useDefaultModel.Trim().ToUpper() -eq 'Y') {
        $Model = $defaultModel
    } else {
        $customModel = Read-Host '[start] Enter Ollama model name, or press Enter to let Ollama/Graphify use its default'

        if (-not [string]::IsNullOrWhiteSpace($customModel)) {
            $Model = $customModel.Trim()
        }
    }
}

if ($Model) {
    $env:OLLAMA_MODEL = $Model

    # Graphify's Ollama backend uses an OpenAI-compatible client.
    # Any non-empty value suppresses the warning.
    if (-not $env:OLLAMA_API_KEY) {
        $env:OLLAMA_API_KEY = 'ollama'
    }

    Write-Host "[start] Ollama model set to: $Model" -ForegroundColor Cyan
} else {
    Write-Host '[start] No model explicitly selected; Ollama/Graphify defaults will be used.' -ForegroundColor Yellow
}

# ── Build or update Graphify graph ─────────────────────────────────────────────
$graphJson = Join-Path $root 'graphify-out\graph.json'

$graphifyBuildArgs = @('.', '--backend', 'ollama')
$graphifyUpdateArgs = @('.', '--update', '--backend', 'ollama')

if (-not (Test-Path $graphJson)) {
    Write-Host '[start] Graph missing — building with graphify + Ollama backend...' -ForegroundColor Yellow

    & graphify @graphifyBuildArgs

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $graphJson)) {
        Write-Host '[start] ERROR: graphify build failed.' -ForegroundColor Red
        Write-Host '[start] HINT: This project contains docs/images, so Graphify needs an LLM backend.' -ForegroundColor Yellow
        Write-Host '[start] HINT: Current backend: ollama.' -ForegroundColor Yellow
        Write-Host '[start] HINT: Check that Ollama is running and the model exists: ollama list' -ForegroundColor Yellow
        exit 1
    }

    Write-Host '[start] Graph built.' -ForegroundColor Green
} else {
    Write-Host '[start] Syncing graph with graphify + Ollama backend...' -ForegroundColor Cyan

    & graphify @graphifyUpdateArgs | Select-Object -Last 3

    if ($LASTEXITCODE -ne 0) {
        Write-Host '[start] ERROR: graphify incremental update failed.' -ForegroundColor Red
        Write-Host '[start] HINT: Check that Ollama is running and the selected model is available.' -ForegroundColor Yellow
        exit 1
    }

    Write-Host '[start] Graph synced.' -ForegroundColor Green
}

# ── Optional report generation ─────────────────────────────────────────────────
Write-Host '[start] Generating graph report...' -ForegroundColor Cyan

& graphify cluster-only $root | Select-Object -Last 3

if ($LASTEXITCODE -ne 0) {
    Write-Host '[start] WARNING: graph report generation failed. Continuing anyway.' -ForegroundColor Yellow
}

# ── Launch Claude ──────────────────────────────────────────────────────────────
$claudeArgs = @('launch', 'claude')
# $claudeCodeArgs = @()
$claudeCodeArgs = @('--dangerously-skip-permissions')

if ($Model) {
    $claudeArgs += @('--model', $Model)
}

if ($Continue) {
    $claudeCodeArgs += '--continue'
} elseif ($Resume) {
    $claudeCodeArgs += @('--resume', $Resume)
}

if ($claudeCodeArgs.Count -gt 0) {
    $claudeArgs += '--'
    $claudeArgs += $claudeCodeArgs
}

if ($Model) {
    Write-Host "[start] Launching Claude Code with model: $Model" -ForegroundColor Cyan
} else {
    Write-Host '[start] Launching Claude Code with default model resolution.' -ForegroundColor Cyan
}

Write-Host ''

& ollama @claudeArgs
