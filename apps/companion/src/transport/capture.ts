import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINE_MAX_ROWS, LINE_ROW_HEIGHT_PX } from "./grid.ts";
import type { LineCapture, Strip } from "./line-reader.ts";

export type FrameSource = {
  next(): Promise<LineCapture | undefined>;
  close(): void;
};

const CAPTURE_STRIP_ROWS = LINE_MAX_ROWS * LINE_ROW_HEIGHT_PX + 2;
const HEADER_BYTES = 8;
const CAPTURE_MAGIC = [0x57, 0x43, 0x4c, 0x31] as const;
const MAX_CAPTURE_WIDTH_PX = 16_384;

export type ScreenCaptureConfig = {
  windowProcessName: string;
  stripRows?: number;
  powershellPath?: string;
  captureTimeoutMs?: number;
  onCaptureError?: (error: unknown) => void;
};

export type CaptureHeader = { kind: "width"; widthPx: number } | { kind: "desync" };

export function parseCaptureHeader(header: Uint8Array): CaptureHeader {
  if (header.length !== HEADER_BYTES || CAPTURE_MAGIC.some((byte, i) => header[i] !== byte)) {
    return { kind: "desync" };
  }
  const widthPx = new DataView(header.buffer, header.byteOffset, header.byteLength).getInt32(
    CAPTURE_MAGIC.length,
    true,
  );
  return widthPx < 0 || widthPx > MAX_CAPTURE_WIDTH_PX
    ? { kind: "desync" }
    : { kind: "width", widthPx };
}

export function bgrStride(widthPx: number): number {
  return Math.ceil((widthPx * 3) / 4) * 4;
}

export function stripsFromBuffer(
  widthPx: number,
  stripRows: number,
  buffer: Uint8Array,
): LineCapture | undefined {
  const stride = bgrStride(widthPx);
  const stripBytes = stride * stripRows;
  if (widthPx <= 0 || buffer.length < stripBytes * 2) {
    return undefined;
  }
  const strip = (edge: Strip["edge"], from: number): Strip => ({
    edge,
    width: widthPx,
    rows: stripRows,
    stride,
    pixels: buffer.subarray(from, from + stripBytes),
  });
  return { strips: [strip("top", 0), strip("bottom", stripBytes)] };
}

function buildCaptureScript(): string {
  return [
    "param([string]$ProcessName,[int]$StripRows)",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -Namespace WowC -Name Native -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);',
    '[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);',
    "public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "public struct POINT { public int X; public int Y; }",
    "'@",
    "[WowC.Native]::SetProcessDPIAware() | Out-Null",
    "$stdout = [Console]::OpenStandardOutput()",
    "$stdin = [Console]::OpenStandardInput()",
    "$reader = New-Object System.IO.StreamReader($stdin)",
    "function Send-Header([int]$width) {",
    "  $magic = [byte[]](0x57, 0x43, 0x4C, 0x31)",
    "  $stdout.Write($magic, 0, 4)",
    "  $head = [BitConverter]::GetBytes($width)",
    "  $stdout.Write($head, 0, 4)",
    "}",
    "function Grab-Strip([int]$x, [int]$y, [int]$w, [int]$rows) {",
    "  $bmp = New-Object System.Drawing.Bitmap $w, $rows",
    "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
    "  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $rows)))",
    "  $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $rows)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)",
    "  $bytes = New-Object byte[] ($data.Stride * $rows)",
    "  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)",
    "  $bmp.UnlockBits($data)",
    "  $g.Dispose()",
    "  $bmp.Dispose()",
    "  return ,$bytes",
    "}",
    "while ($true) {",
    "  $line = $reader.ReadLine()",
    "  if ($line -eq $null) { break }",
    "  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  if ($proc -eq $null -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {",
    "    Send-Header 0",
    "    $stdout.Flush()",
    "    continue",
    "  }",
    "  $rect = New-Object WowC.Native+RECT",
    "  [WowC.Native]::GetClientRect($proc.MainWindowHandle, [ref]$rect) | Out-Null",
    "  $w = $rect.Right - $rect.Left",
    "  $h = $rect.Bottom - $rect.Top",
    "  if ($w -lt 1 -or $h -lt (2 * $StripRows)) {",
    "    Send-Header 0",
    "    $stdout.Flush()",
    "    continue",
    "  }",
    "  $origin = New-Object WowC.Native+POINT",
    "  $origin.X = 0",
    "  $origin.Y = 0",
    "  [WowC.Native]::ClientToScreen($proc.MainWindowHandle, [ref]$origin) | Out-Null",
    "  $top = Grab-Strip $origin.X $origin.Y $w $StripRows",
    "  $bottom = Grab-Strip $origin.X ($origin.Y + $h - $StripRows) $w $StripRows",
    "  Send-Header $w",
    "  $stdout.Write($top, 0, $top.Length)",
    "  $stdout.Write($bottom, 0, $bottom.Length)",
    "  $stdout.Flush()",
    "}",
  ].join("\n");
}

type ReadResult = { kind: "data"; buffer: Buffer } | { kind: "closed" } | { kind: "timeout" };

type ByteReader = {
  read(byteLength: number, timeoutMs: number): Promise<ReadResult>;
};

const DEFAULT_CAPTURE_TIMEOUT_MS = 2000;

function createByteReader(child: ChildProcessWithoutNullStreams): ByteReader {
  let buffered = Buffer.alloc(0);
  let closed = false;
  let wake: (() => void) | undefined;

  child.stdout.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    wake?.();
  });
  child.on("close", () => {
    closed = true;
    wake?.();
  });

  return {
    read(byteLength: number, timeoutMs: number): Promise<ReadResult> {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve({ kind: "timeout" });
        }, timeoutMs);
        function settle(): void {
          if (buffered.length >= byteLength) {
            clearTimeout(timer);
            wake = undefined;
            const taken = buffered.subarray(0, byteLength);
            buffered = buffered.subarray(byteLength);
            resolve({ kind: "data", buffer: taken });
            return;
          }
          if (closed) {
            clearTimeout(timer);
            wake = undefined;
            resolve({ kind: "closed" });
          }
        }
        wake = settle;
        settle();
      });
    },
  };
}

export function createScreenCaptureSource(config: ScreenCaptureConfig): FrameSource {
  const stripRows = config.stripRows ?? CAPTURE_STRIP_ROWS;
  const captureTimeoutMs = config.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const scriptPath = join(tmpdir(), `wowc-capture-${process.pid}-${Date.now()}.ps1`);
  writeFileSync(scriptPath, buildCaptureScript(), "utf-8");

  let closed = false;
  let child: ChildProcessWithoutNullStreams;
  let reader: ByteReader;

  function spawnChild(): ChildProcessWithoutNullStreams {
    const next = spawn(
      config.powershellPath ?? "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        config.windowProcessName,
        String(stripRows),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    next.on("error", (error) => {
      config.onCaptureError?.(error);
    });
    next.stdin.on("error", (error) => {
      config.onCaptureError?.(error);
    });
    next.stderr.resume();
    reader = createByteReader(next);
    return next;
  }

  function respawnChild(): void {
    if (closed) {
      return;
    }
    child.stdin.destroy();
    child.kill();
    child = spawnChild();
  }

  child = spawnChild();

  async function readOrRespawn(byteLength: number): Promise<Buffer | undefined> {
    const result = await reader.read(byteLength, captureTimeoutMs);
    if (result.kind === "data") {
      return result.buffer;
    }
    if (result.kind === "timeout") {
      config.onCaptureError?.(new Error("screen capture: read timed out"));
      respawnChild();
    } else if (!closed) {
      config.onCaptureError?.(new Error("screen capture: child process closed"));
      respawnChild();
    }
    return undefined;
  }

  return {
    async next(): Promise<LineCapture | undefined> {
      if (closed) {
        return undefined;
      }
      try {
        child.stdin.write("c\n");
      } catch (error) {
        config.onCaptureError?.(error);
        respawnChild();
        return undefined;
      }
      const header = await readOrRespawn(HEADER_BYTES);
      if (header === undefined) {
        return undefined;
      }
      const parsed = parseCaptureHeader(header);
      if (parsed.kind === "desync") {
        config.onCaptureError?.(new Error("screen capture: out of step with the capture process"));
        respawnChild();
        return undefined;
      }
      const widthPx = parsed.widthPx;
      if (widthPx === 0) {
        return undefined;
      }
      const body = await readOrRespawn(bgrStride(widthPx) * stripRows * 2);
      return body === undefined ? undefined : stripsFromBuffer(widthPx, stripRows, body);
    },
    close(): void {
      closed = true;
      child.stdin.destroy();
      child.kill();
      try {
        unlinkSync(scriptPath);
      } catch (error) {
        config.onCaptureError?.(error);
      }
    },
  };
}
