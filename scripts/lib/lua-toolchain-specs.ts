type LuaArchiveSpec = {
  version: string;
  url: string;
  sha256: string;
  format: "zip" | "targz";
  binaryInArchive: string;
  linkName: string;
  luacFileName: string;
};

type LuacheckBinarySpec = {
  version: string;
  url: string;
  sha256: string;
  fileName: string;
};

type PlatformSpecs = {
  lua: LuaArchiveSpec;
  luacheck: LuacheckBinarySpec;
};

export type SupportedPlatform = "win32-x64" | "linux-x64";

export const resolveSupportedPlatform = (): SupportedPlatform | undefined => {
  if (process.platform === "win32" && process.arch === "x64") {
    return "win32-x64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  return undefined;
};

const luaVersion = "5.1.5";
const luacheckVersion = "1.2.0";

export const specsByPlatform: Record<SupportedPlatform, PlatformSpecs> = {
  "win32-x64": {
    lua: {
      version: luaVersion,
      url: "https://sourceforge.net/projects/luabinaries/files/5.1.5/Tools%20Executables/lua-5.1.5_Win64_bin.zip/download",
      sha256: "5f34cf7d40a20a587ea351482a4207d93b92ef6f1983e910a13338253819fe93",
      format: "zip",
      binaryInArchive: "lua5.1.exe",
      linkName: "lua.exe",
      luacFileName: "luac5.1.exe",
    },
    luacheck: {
      version: luacheckVersion,
      url: `https://github.com/lunarmodules/luacheck/releases/download/v${luacheckVersion}/luacheck.exe`,
      sha256: "0f1c69c4d09f1ebb4d8df14c215e4553e2e639bd4cb7bf3c639b0daa6198317b",
      fileName: "luacheck.exe",
    },
  },
  "linux-x64": {
    lua: {
      version: luaVersion,
      url: "https://sourceforge.net/projects/luabinaries/files/5.1.5/Tools%20Executables/lua-5.1.5_Linux515_64_bin.tar.gz/download",
      sha256: "88c4ca5863b2690e4e56e84bfc4059c497d60d9d344662da204aa456fedaf6bf",
      format: "targz",
      binaryInArchive: "lua5.1",
      linkName: "lua",
      luacFileName: "luac5.1",
    },
    luacheck: {
      version: luacheckVersion,
      url: `https://github.com/lunarmodules/luacheck/releases/download/v${luacheckVersion}/luacheck`,
      sha256: "d68da17fca0697d9e2fb04201f3884abd259fa558b3a449bccaed47f1390defc",
      fileName: "luacheck",
    },
  },
};
