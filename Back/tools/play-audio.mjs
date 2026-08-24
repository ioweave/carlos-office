import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

const tool = {
  name: "play-audio",
  description: "Plays audio from a local file or HTTP(S) URL. Prefers VLC when available, then falls back to ffplay, mpv, and native platform players.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Local filesystem path, file:// URL, or HTTP(S) audio URL.",
      },
      volume: {
        type: "number",
        description: "Playback volume from 0 to 100. Defaults to 80.",
        minimum: 0,
        maximum: 100,
      },
      blocking: {
        type: "boolean",
        description: "Wait for playback to finish before returning. Defaults to false.",
        default: false,
      },
      cleanup: {
        type: "boolean",
        description: "Delete a downloaded temporary file after playback. Defaults to true.",
        default: true,
      },
      timeoutMs: {
        type: "number",
        description: "HTTP download timeout in milliseconds. Defaults to 30000.",
        default: 30000,
      },
    },
    required: ["source"],
  },
  output: {
    type: "object",
    properties: {
      played: { type: "boolean" },
      source: { type: "string" },
      origin: { type: "string", enum: ["filesystem", "web"] },
      localPath: { type: "string" },
      platform: { type: "string" },
      player: { type: "string" },
      blocking: { type: "boolean" },
      volume: { type: "number" },
    },
  },
  async execute(inputs = {}) {
    const source = typeof inputs.source === "string" ? inputs.source.trim() : "";
    const volume = inputs.volume ?? 80;
    const blocking = inputs.blocking ?? false;
    const cleanup = inputs.cleanup ?? true;
    const timeoutMs = inputs.timeoutMs ?? 30000;

    if (!source) throw new Error("source must be a non-empty string");
    if (typeof volume !== "number" || volume < 0 || volume > 100) {
      throw new Error("volume must be a number between 0 and 100");
    }
    if (typeof blocking !== "boolean") throw new Error("blocking must be a boolean");
    if (typeof cleanup !== "boolean") throw new Error("cleanup must be a boolean");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");

    const origin = /^https?:\/\//i.test(source) ? "web" : "filesystem";
    let localPath;
    let tempDir = null;

    if (origin === "web") {
      const downloaded = await download(source, timeoutMs);
      localPath = downloaded.path;
      tempDir = downloaded.directory;
    } else {
      localPath = source.startsWith("file://") ? fileURLToPath(source) : resolve(source);
      const info = await stat(localPath).catch(() => null);
      if (!info?.isFile()) throw new Error(`Audio source is not a file: ${localPath}`);
    }

    try {
      const playback = await play(localPath, volume, blocking);

      if (tempDir && cleanup) {
        if (blocking) await rm(tempDir, { recursive: true, force: true });
        else playback.child.once("close", () => void rm(tempDir, { recursive: true, force: true }));
      }

      return {
        played: true,
        source,
        origin,
        localPath,
        platform: process.platform,
        player: playback.player,
        blocking,
        volume,
      };
    } catch (error) {
      if (tempDir && cleanup) await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  },
};

const download = async (url, timeoutMs) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Could not download audio: HTTP ${response.status}`);

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_DOWNLOAD_BYTES) {
    throw new Error("Audio file exceeds the 50 MB limit");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("Audio file exceeds the 50 MB limit");

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const byType = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/x-wav": ".wav",
  }[contentType];
  const fromUrl = extname(new URL(url).pathname);
  const extension = byType || (fromUrl.length <= 8 ? fromUrl : "") || ".audio";
  const directory = await mkdtemp(join(tmpdir(), "carlos-office-audio-"));
  const path = join(directory, `audio${extension}`);
  await writeFile(path, bytes);
  return { path, directory };
};

const play = async (path, volume, blocking) => {
  const candidates = playerCandidates(path, volume);
  const errors = [];

  for (const candidate of candidates) {
    if (candidate.path && !existsSync(candidate.path)) continue;

    try {
      const child = await run(candidate.command, candidate.args, candidate.env, blocking);
      return { player: candidate.name, child };
    } catch (error) {
      errors.push(`${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No audio player could play the file. ${errors.join(" | ")}`);
};

const run = (command, args, env, blocking) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, {
    detached: !blocking,
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });

  let settled = false;
  const fail = error => {
    if (settled) return;
    settled = true;
    reject(error);
  };

  child.once("error", fail);

  if (blocking) {
    child.once("close", code => {
      if (settled) return;
      settled = true;
      if (code === 0) resolveRun(child);
      else reject(new Error(`${command} exited with code ${code}`));
    });
    return;
  }

  child.once("spawn", () => {
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveRun(child);
    }, 350);
  });
  child.once("close", code => {
    if (!settled && code !== 0) fail(new Error(`${command} exited with code ${code}`));
  });
});

const playerCandidates = (path, volume) => {
  const vlcVolume = String(Math.round(volume * 2.56));
  const ffplay = ["-nodisp", "-autoexit", "-loglevel", "error", "-volume", String(volume), path];
  const mpv = ["--no-video", "--really-quiet", `--volume=${volume}`, path];

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const vlcArgs = ["--intf", "dummy", "--play-and-exit", "--no-video", "--quiet", "--volume", vlcVolume, path];

    return [
      ...(programFiles ? [{ name: "vlc", command: join(programFiles, "VideoLAN", "VLC", "vlc.exe"), path: join(programFiles, "VideoLAN", "VLC", "vlc.exe"), args: vlcArgs }] : []),
      ...(programFilesX86 ? [{ name: "vlc", command: join(programFilesX86, "VideoLAN", "VLC", "vlc.exe"), path: join(programFilesX86, "VideoLAN", "VLC", "vlc.exe"), args: vlcArgs }] : []),
      { name: "vlc", command: "vlc.exe", args: vlcArgs },
      { name: "ffplay", command: "ffplay.exe", args: ffplay },
      { name: "mpv", command: "mpv.exe", args: mpv },
      windowsMediaPlayer(path, volume),
    ];
  }

  if (process.platform === "darwin") {
    const vlc = "/Applications/VLC.app/Contents/MacOS/VLC";
    return [
      { name: "vlc", command: vlc, path: vlc, args: ["--intf", "dummy", "--play-and-exit", "--no-video", "--quiet", "--volume", vlcVolume, path] },
      { name: "cvlc", command: "cvlc", args: ["--play-and-exit", "--no-video", "--quiet", path] },
      { name: "ffplay", command: "ffplay", args: ffplay },
      { name: "mpv", command: "mpv", args: mpv },
      { name: "afplay", command: "afplay", args: ["-v", String(volume / 100), path] },
    ];
  }

  return [
    { name: "cvlc", command: "cvlc", args: ["--play-and-exit", "--no-video", "--quiet", "--volume", vlcVolume, path] },
    { name: "vlc", command: "vlc", args: ["--intf", "dummy", "--play-and-exit", "--no-video", "--quiet", "--volume", vlcVolume, path] },
    { name: "ffplay", command: "ffplay", args: ffplay },
    { name: "mpv", command: "mpv", args: mpv },
    { name: "paplay", command: "paplay", args: [`--volume=${Math.round((volume / 100) * 65536)}`, path] },
    { name: "aplay", command: "aplay", args: [path] },
  ];
};

const windowsMediaPlayer = (path, volume) => ({
  name: "windows-media-player",
  command: "powershell.exe",
  args: [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "Add-Type -AssemblyName PresentationCore",
      "$player = New-Object System.Windows.Media.MediaPlayer",
      "$player.Open([System.Uri]::new($env:CARLOS_AUDIO_FILE))",
      "for ($i = 0; $i -lt 200 -and -not $player.NaturalDuration.HasTimeSpan; $i++) { Start-Sleep -Milliseconds 50 }",
      "if (-not $player.NaturalDuration.HasTimeSpan) { throw 'Could not load audio media' }",
      "$player.Volume = [double]$env:CARLOS_AUDIO_VOLUME",
      "$player.Play()",
      "Start-Sleep -Milliseconds ([Math]::Ceiling($player.NaturalDuration.TimeSpan.TotalMilliseconds) + 200)",
      "$player.Close()",
    ].join("; "),
  ],
  env: {
    CARLOS_AUDIO_FILE: path,
    CARLOS_AUDIO_VOLUME: String(volume / 100),
  },
});

export default tool;
export { tool };
