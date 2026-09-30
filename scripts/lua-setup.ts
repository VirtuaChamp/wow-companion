import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { downloadVerified } from "./lib/download.ts";
import { extractTarGz, extractZip } from "./lib/extract.ts";
import { parseToolSelection } from "./lib/lua-setup-args.ts";
import { resolveSupportedPlatform, specsByPlatform } from "./lib/lua-toolchain-specs.ts";

const platform = resolveSupportedPlatform();
if (!platform) {
  console.error(
    `unsupported platform/arch: ${process.platform}-${process.arch}; only win32-x64 and linux-x64 are supported`,
  );
  process.exit(1);
}
const specs = specsByPlatform[platform];

const toolsDir = join(process.cwd(), ".tools");
const lua51Dir = join(toolsDir, "lua51");
const luacheckDir = join(toolsDir, "luacheck");
const luaMarker = join(lua51Dir, ".installed.json");
const luacheckMarker = join(luacheckDir, ".installed.json");

const readMarker = (markerPath: string): string | undefined => {
  if (!existsSync(markerPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as { sha256?: string };
  return parsed.sha256;
};

const setupLua = async (): Promise<number> => {
  const linkPath = join(lua51Dir, specs.lua.linkName);
  if (readMarker(luaMarker) === specs.lua.sha256 && existsSync(linkPath)) {
    console.log(`lua ${specs.lua.version} already installed at ${linkPath}`);
    return 0;
  }
  rmSync(lua51Dir, { recursive: true, force: true });
  mkdirSync(lua51Dir, { recursive: true });
  const archivePath = join(
    toolsDir,
    `lua-${specs.lua.version}-${platform}.${specs.lua.format === "zip" ? "zip" : "tar.gz"}`,
  );
  const downloadResult = await downloadVerified({
    url: specs.lua.url,
    sha256: specs.lua.sha256,
    destPath: archivePath,
  });
  if (!downloadResult.ok) {
    console.error(`lua download failed: ${JSON.stringify(downloadResult.error)}`);
    return 1;
  }
  const extractResult =
    specs.lua.format === "zip"
      ? extractZip(archivePath, lua51Dir)
      : extractTarGz(archivePath, lua51Dir);
  if (!extractResult.ok) {
    console.error(`lua extract failed: ${JSON.stringify(extractResult.error)}`);
    return 1;
  }
  const binaryPath = join(lua51Dir, specs.lua.binaryInArchive);
  if (!existsSync(binaryPath)) {
    console.error(`expected binary missing after extraction: ${binaryPath}`);
    return 1;
  }
  copyFileSync(binaryPath, linkPath);
  chmodSync(binaryPath, 0o755);
  chmodSync(linkPath, 0o755);
  writeFileSync(
    luaMarker,
    JSON.stringify({ sha256: specs.lua.sha256, version: specs.lua.version }, undefined, 2),
  );
  console.log(`lua ${specs.lua.version} installed at ${linkPath}`);
  return 0;
};

const setupLuacheck = async (): Promise<number> => {
  const binaryPath = join(luacheckDir, specs.luacheck.fileName);
  if (readMarker(luacheckMarker) === specs.luacheck.sha256 && existsSync(binaryPath)) {
    console.log(`luacheck ${specs.luacheck.version} already installed at ${binaryPath}`);
    return 0;
  }
  mkdirSync(luacheckDir, { recursive: true });
  const downloadResult = await downloadVerified({
    url: specs.luacheck.url,
    sha256: specs.luacheck.sha256,
    destPath: binaryPath,
  });
  if (!downloadResult.ok) {
    console.error(`luacheck download failed: ${JSON.stringify(downloadResult.error)}`);
    return 1;
  }
  chmodSync(binaryPath, 0o755);
  writeFileSync(
    luacheckMarker,
    JSON.stringify(
      { sha256: specs.luacheck.sha256, version: specs.luacheck.version },
      undefined,
      2,
    ),
  );
  console.log(`luacheck ${specs.luacheck.version} installed at ${binaryPath}`);
  return 0;
};

const main = async (): Promise<void> => {
  const selection = parseToolSelection(process.argv.slice(2));
  if (!selection.ok) {
    console.error(selection.error);
    process.exitCode = 1;
    return;
  }
  mkdirSync(toolsDir, { recursive: true });
  const luaExit = await setupLua();
  const luacheckExit = selection.value.luacheck ? await setupLuacheck() : 0;
  process.exitCode = luaExit !== 0 ? luaExit : luacheckExit;
};

await main();
