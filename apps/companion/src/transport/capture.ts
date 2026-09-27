import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cell, CellGrid } from "./grid.ts";
import { parseCellGridFile } from "./grid.ts";

export type FrameSource = {
  next(): Promise<CellGrid | undefined>;
  close(): void;
};

export function createGridFileSource(path: string): FrameSource {
  return {
    async next(): Promise<CellGrid | undefined> {
      let text: string;
      try {
        text = await readFile(path, "utf-8");
      } catch {
        return undefined;
      }
      const parsed = parseCellGridFile(text);
      return parsed.ok ? parsed.value : undefined;
    },
    close(): void {},
  };
}

export type ScreenCaptureConfig = {
  windowProcessName: string;
  gridWidthCells: number;
  gridHeightCells: number;
  cellPhysicalSize: number;
  powershellPath?: string;
  captureTimeoutMs?: number;
  onCaptureError?: (error: unknown) => void;
};

const PURE_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0, 255],
  [0, 255, 0],
  [0, 255, 255],
  [255, 0, 0],
  [255, 0, 255],
  [255, 255, 0],
  [255, 255, 255],
];

function classifyChannel(value: number): 0 | 1 {
  return value >= 128 ? 1 : 0;
}

export function classifyCell(r: number, g: number, b: number): Cell {
  const rBit = classifyChannel(r);
  const gBit = classifyChannel(g);
  const bBit = classifyChannel(b);
  const index = PURE_COLORS.findIndex(
    ([pr, pg, pb]) => pr === rBit * 255 && pg === gBit * 255 && pb === bBit * 255,
  );
  return (index === -1 ? 0 : index) as Cell;
}

export function bgr24BufferToCells(
  pixels: Uint8Array,
  strideBytes: number,
  gridWidthCells: number,
  gridHeightCells: number,
  cellPhysicalSize: number,
): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < gridHeightCells; row += 1) {
    for (let col = 0; col < gridWidthCells; col += 1) {
      const px = col * cellPhysicalSize + Math.floor(cellPhysicalSize / 2);
      const py = row * cellPhysicalSize + Math.floor(cellPhysicalSize / 2);
      const offset = py * strideBytes + px * 3;
      const b = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const r = pixels[offset + 2] ?? 0;
      cells.push(classifyCell(r, g, b));
    }
  }
  return cells;
}

function buildCaptureScript(): string {
  return [
    "param([string]$ProcessName,[int]$RegionWidth,[int]$RegionHeight)",
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
    "$blank = New-Object byte[] ($RegionWidth * $RegionHeight * 3)",
    "while ($true) {",
    "  $line = $reader.ReadLine()",
    "  if ($line -eq $null) { break }",
    "  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  if ($proc -eq $null -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {",
    "    $stdout.Write($blank, 0, $blank.Length)",
    "    $stdout.Flush()",
    "    continue",
    "  }",
    "  $origin = New-Object WowC.Native+POINT",
    "  $origin.X = 0",
    "  $origin.Y = 0",
    "  [WowC.Native]::ClientToScreen($proc.MainWindowHandle, [ref]$origin) | Out-Null",
    "  $bmp = New-Object System.Drawing.Bitmap $RegionWidth, $RegionHeight",
    "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
    "  $g.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size($RegionWidth, $RegionHeight)))",
    "  $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $RegionWidth, $RegionHeight)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)",
    "  $bytes = New-Object byte[] ($data.Stride * $RegionHeight)",
    "  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)",
    "  $bmp.UnlockBits($data)",
    "  $g.Dispose()",
    "  $bmp.Dispose()",
    "  $stdout.Write($bytes, 0, $bytes.Length)",
    "  $stdout.Flush()",
    "}",
  ].join("\n");
}

type ReadResult = { kind: "data"; buffer: Buffer } | { kind: "closed" } | { kind: "timeout" };

const DEFAULT_CAPTURE_TIMEOUT_MS = 2000;

function readExact(
  child: ChildProcessWithoutNullStreams,
  byteLength: number,
  timeoutMs: number,
): Promise<ReadResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    function cleanup(): void {
      child.stdout.off("data", onData);
      child.off("close", onClose);
      clearTimeout(timer);
    }

    function onData(chunk: Buffer): void {
      if (settled) {
        return;
      }
      chunks.push(chunk);
      received += chunk.length;
      if (received >= byteLength) {
        settled = true;
        cleanup();
        resolve({ kind: "data", buffer: Buffer.concat(chunks).subarray(0, byteLength) });
      }
    }

    function onClose(): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({ kind: "closed" });
    }

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({ kind: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", onData);
    child.on("close", onClose);
  });
}

export function createScreenCaptureSource(config: ScreenCaptureConfig): FrameSource {
  const widthPx = config.gridWidthCells * config.cellPhysicalSize;
  const heightPx = config.gridHeightCells * config.cellPhysicalSize;
  const strideBytes = widthPx * 3;
  const frameByteLength = strideBytes * heightPx;
  const captureTimeoutMs = config.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const scriptPath = join(tmpdir(), `wowc-capture-${process.pid}-${Date.now()}.ps1`);
  writeFileSync(scriptPath, buildCaptureScript(), "utf-8");

  let closed = false;
  let child: ChildProcessWithoutNullStreams;

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
        String(widthPx),
        String(heightPx),
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

  return {
    async next(): Promise<CellGrid | undefined> {
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
      const result = await readExact(child, frameByteLength, captureTimeoutMs);
      if (result.kind === "timeout") {
        config.onCaptureError?.(new Error("screen capture: read timed out"));
        respawnChild();
        return undefined;
      }
      if (result.kind === "closed") {
        if (!closed) {
          config.onCaptureError?.(new Error("screen capture: child process closed"));
          respawnChild();
        }
        return undefined;
      }
      return bgr24BufferToCells(
        result.buffer,
        strideBytes,
        config.gridWidthCells,
        config.gridHeightCells,
        config.cellPhysicalSize,
      );
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
