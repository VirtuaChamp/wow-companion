# WoW Companion

Ask an AI questions from inside WoW Forever, using your own Claude or Codex login.

> **Tested on Windows 11 only.** Other systems are untested and unsupported.

## What it does

You are stuck on a quest, or you wonder if an item is worth keeping. Type `/ai` and your question in the game. A window called "Claude" opens and the AI answers there.

The AI can see your character, your position, your quest log, your bags and your gear. It can look up quests, NPCs and items in the Forever world data. It can suggest a map waypoint, and the waypoint is only set when you click `[Set waypoint]`.

Your character details go to the AI provider you pick: Claude through the Claude Agent SDK that `pnpm install` adds to the project, Codex through your `codex` command-line tool. The AI has read-only access: no shell and no file writes. With Claude it may also run a web search, limited to wowhead.com, warcraft.wiki.gg and icy-veins.com. Codex has web search turned off.

## Requirements

- **Windows 11.** This is the only system the project was tested on. Other systems are untested and unsupported.
- **The WoW Forever game client**, the `_classic_beta_` flavour. Its executable is `WowB.exe`.
- **Windowed or borderless mode.** Exclusive fullscreen blocks the screen capture the project relies on. Keep the game window visible: not minimized, with the game interface shown (Alt+Z hides it) and nothing on top of the edge where the thin signal line appears. That is the top edge by default; the game setting "Signal line position" moves it to the bottom edge.
- **Node.js 24 (24.2.0 or newer).** The installer refuses an older 24 and every other major version (25, 26 and so on are untested). The repo pins 24.21.0 in `.node-version`, the version it is developed on.
- **pnpm.** The installer checks only that a `pnpm` command exists (a Corepack `pnpm` counts). The repo pins pnpm 12.6.0 in `package.json`; on the first `pnpm install`, pnpm or Corepack may download that pinned version into its own cache. That is treated like `pnpm install` fetching the project's packages.
- **git.**
- **At least one AI tool, installed and logged in:** Claude Code (`claude`) or the Codex CLI (`codex`). The installer checks that the command is on your PATH. It does not check that you are logged in. Cursor is supported in the code but ships disabled, so do not count on it.
  - Claude Code has to be installed so that you can log in with it. The companion does not run your `claude` command: it answers through the Claude Agent SDK, which brings its own copy of Claude Code, a `claude.exe` under `node_modules\.pnpm\@anthropic-ai+claude-agent-sdk-win32-x64@<version>\` that `pnpm install` puts in the project.
  - Codex is different: the companion runs your own `codex` command.
- **A local clone of QuestieDB.** It feeds the world database. The repo never downloads or ships QuestieDB data.

If something is missing, the installer stops and prints the command that fixes it. It never installs Node.js, git, pnpm or an AI command-line tool on your system itself. It does run `pnpm install`, and pnpm may download its own pinned version into its cache first. These are the commands it prints. If a Node.js of another major version is installed, it first tells you to uninstall that one:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --version 24.19.0
winget install --id pnpm.pnpm --exact
winget install --id Git.Git --exact
winget install --id Anthropic.ClaudeCode --exact
winget install --id OpenAI.Codex --exact
```

Log in once with the tool you installed, and check it worked:

```powershell
claude auth login
claude auth status
codex login
codex login status
```

## Quick start

1. Open PowerShell, move to the folder where you want the projects with `cd <folder>`, and get the two repositories. Each clone lands in that folder. QuestieDB can live anywhere; the installer asks for its path.

   ```powershell
   git clone https://github.com/VirtuaChamp/wow-companion.git
   git clone https://github.com/Questie/QuestieDB.git
   ```

2. Close the game, then double-click `install.cmd` in the `wow-companion` folder.
3. Answer the questions. The installer asks for your game folder (the one holding `WowB.exe`; if you type the path of `WowB.exe` itself it uses the folder around it), a model id for every provider it finds on your PATH, and the path of your QuestieDB clone. It asks which provider answers by default only when it finds both `claude` and `codex`; with one, that one is the default. It stops with a clear message if anything is missing or wrong.
4. Start the game, then double-click `start.cmd`. Keep its window open while you play. To stop the companion, press Ctrl+C in that window. Windows may ask "Terminate batch job (Y/N)?"; answer `Y`.
5. In the game, type `/ai hello` in any chat box.

From a terminal opened in the `wow-companion` folder, run `.\install.cmd` and `.\start.cmd`. PowerShell needs the leading `.\`.

### What the installer does

- Checks Node.js, pnpm, git and an AI CLI, and prints the fix for each missing one. It never installs Node.js, git, pnpm or an AI CLI on your system: it prints the command and stops. For pnpm it only checks that the command exists.
- Runs `pnpm install --frozen-lockfile`. pnpm may first download the pnpm version this project pins into its own cache, then it installs the project's packages.
- Creates `config.json` from `config.example.json`, only if it does not exist. It never overwrites an existing one; it checks it with the companion's own rules and checks that `wowPath` holds `WowB.exe`, and stops with a message naming the problem if either check fails. Providers it did not find on your PATH, and Cursor, are written as disabled.
- Downloads a small Lua 5.1.5 interpreter into the project's `.tools/` folder, checksum verified. It installs nothing on your system. The database build needs it.
- Builds `data/questie.sqlite` from your QuestieDB clone.
- Copies the addon into your game folder and creates the reply slots (see Uninstalling for the list).
- After the database build and after the addon copy, checks that the files those steps must leave are really there, and stops if not.

It is safe to run again: close any `start.cmd` window first. Once `config.json` exists, the installer keeps it and does not ask for the game folder again. If `data/questie.sqlite` exists, it asks before rebuilding and asks for the QuestieDB path only if you answer `y`. If the database does not exist yet, for example because a first run stopped early, it asks for the QuestieDB path directly.

## First chat in game

Type `/ai hello` in any chat box. The "Claude" window opens if it is hidden, and your question shows up as a bubble on the right. The reply appears on the left.

- **The window.** The chat list is on the left, with a "New chat" button. Click a chat to resume it. Right-click a chat to rename or delete it. Right-click any bubble and choose "Copy text" to copy it.
- **The minimap button.** Left-click opens or closes the window. Right-click opens the settings.
- **Settings.** Open Options > AddOns > WoW Companion, or type `/ai settings`. You can change the AI provider, the model and the effort, and tick "This chat only" to change those three for one chat only. "Text size" and "Show minimap button" apply to the whole window. "Signal line position" chooses "Top edge" (the default) or "Bottom edge" for the thin line the addon uses to talk to the companion. The line is normally invisible. While the companion runs it blinks briefly: every 10 seconds to say the game is there, whenever your character or game data changes (the addon checks every 2 seconds), about every 60 seconds to resend everything, and whenever you send a question. Move it if another addon or overlay covers it.
- **Mentions.** In the window's own input line, type `@` and two letters. A list of quests in your log and items in your bags or on your character pops up. Tab or Enter accepts.
- **Commands.** `/ai help` prints them: `/ai <text>`, `new`, `chat <name>`, `settings`, `report`, `reset`, `cancel`, `help`, `context`. `/ai context` prints how many equipped items and bag items the game side has.

## Configuration

`config.json` sits at the repo root. Git ignores it, so your values stay on your machine. The installer creates it; edit it by hand to change anything later. This is `config.example.json`, with placeholders:

```json
{
  "wowPath": "<folder holding WowB.exe, the _classic_beta_ flavour folder>",
  "provider": "claude",
  "providers": {
    "claude": {
      "enabled": true,
      "model": "<model id the claude CLI offers>",
      "effort": "medium",
      "models": []
    },
    "codex": {
      "enabled": true,
      "model": "<model id the codex CLI offers>",
      "effort": "medium",
      "models": ["<model id the codex CLI offers>"]
    },
    "cursor": {
      "enabled": false,
      "model": "<model id the cursor CLI offers>",
      "models": []
    }
  },
  "companionPort": 47831,
  "slotCount": 200,
  "timeoutMs": 600000
}
```

| Field                    | What it does                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wowPath`                | The folder that holds `WowB.exe`. Not the top-level install folder. In JSON, write every backslash twice (`D:\\Games\\Wow`) or use forward slashes (`D:/Games/Wow`).                                                                                               |
| `provider`               | The provider used first: `claude`, `codex` or `cursor`.                                                                                                                                                                                                            |
| `providers.<id>.enabled` | Turns a provider on or off. Cursor ships as `false`. The installer also writes `false` for a provider it did not find, and that provider keeps the example's placeholder `model`: replace the placeholder with a real model id before you set `enabled` to `true`. |
| `providers.<id>.model`   | The model id to use. It must be a real id for that provider. `claude --help` documents `--model`; `codex debug models` lists the Codex catalog.                                                                                                                    |
| `providers.<id>.effort`  | How hard the model reasons: `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Leave it out for a provider that has no effort setting.                                                                                                                          |
| `providers.<id>.models`  | The models the game's Model dropdown offers. Claude lists its own, so this is only a fallback there. Codex has no live list yet, so `providers.codex.models` needs at least one real id, or Codex has no model to pick.                                            |
| `companionPort`          | The port of the companion's local API. It binds to `127.0.0.1` only.                                                                                                                                                                                               |
| `slotCount`              | How many reply slots the companion uses. Leave it at 200: setup always creates 200.                                                                                                                                                                                |
| `timeoutMs`              | How long a provider run may take, in milliseconds. 600000 is ten minutes.                                                                                                                                                                                          |

The provider, model and effort you pick in the game settings are saved in `apps/companion/state/settings.json`. The three values in `config.json` (`provider`, and the `model` and `effort` of that provider) apply only while that file does not exist, so editing them later changes nothing. To apply them again: close the `start.cmd` window, delete `apps/companion/state/settings.json`, and run `start.cmd`. The model and effort you set with "This chat only" are stored in that file too and are reset along with it. Each existing chat keeps its own provider: that is stored in `apps/companion/state/chats.json`, not in `settings.json`. To change one chat's provider, tick "This chat only" in the game settings and pick the provider there. You can also change the three global values in the game settings instead of deleting the file.

If you edit `config.json` by hand, close the `start.cmd` window and run `start.cmd` again.

## Updating

```powershell
git pull
```

Close the `start.cmd` window if it is open. Then double-click `install.cmd` again and answer `n` when it offers to rebuild the database, unless your QuestieDB clone changed. To pick up new QuestieDB data, run `git pull` inside your QuestieDB clone, run `install.cmd`, and answer `y`.

Restart the game afterwards, then run `start.cmd` again. Re-running the install recreates the signal files, and the game only sees files that existed when it launched.

## Uninstalling

The install creates these folders inside `<game folder>\Interface\AddOns\`:

- `WoWCompanion`
- `WoWCompanion_R001` to `WoWCompanion_R200`
- `WoWCompanion_Signals`

Close the game and the `start.cmd` window, put your game folder in the first line, and run this in PowerShell. It removes exactly those folders and nothing else. Every path is used literally, so brackets and other special characters in your folder name are safe:

```powershell
$addons = '<game folder holding WowB.exe>\Interface\AddOns'
foreach ($name in 'WoWCompanion', 'WoWCompanion_Signals') {
  $path = Join-Path $addons $name
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
Get-ChildItem -LiteralPath $addons -Directory |
  Where-Object { $_.Name -match '^WoWCompanion_R(00[1-9]|0[1-9][0-9]|1[0-9][0-9]|200)$' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
```

If your folder name contains a single quote, write it twice inside the quotes.

The installer modifies your project and game folders. Additionally, pnpm may populate a shared cache under %LOCALAPPDATA%\pnpm (you can clean it with `pnpm store prune`). The game may also have written its own saved-variables file, `WoWCompanion.lua`, in the `WTF\Account\<account>\SavedVariables` folder of your game folder. Deleting it is optional. Delete the `wow-companion` folder to remove the rest: `config.json`, `data/`, `.tools/` and `apps/companion/state/` all live inside it.

## Troubleshooting

**The installer says something is missing.** It prints the fix. Run it, close the window, and run `install.cmd` again. A new window is needed so Windows sees the new program. If it says your Node.js is another major version than 24, do the two steps it prints in order: uninstall that Node.js first, then install Node.js 24.

**The installer keeps asking for the game folder.** It wants the folder that holds `WowB.exe`, and it checks that the file is there.

**The installer keeps asking for the QuestieDB path.** It wants a checkout that has a `data\Forever` folder and a `support\Forever\Zones\areaIdToUiMapId.lua` file.

**`start.cmd` says config.json or the database was not found.** Run `install.cmd` first.

**`start.cmd` prints "config.json is missing or not valid JSON: copy config.example.json and fill it in".** `config.json` is missing, or it is not valid JSON. A common cause is a single backslash in `wowPath`: write every backslash twice, or use forward slashes. Running `install.cmd` creates a fresh file if you delete the broken one.

**`start.cmd` prints a line like `[wowc] config.json: wowPath is missing`.** The field it names is missing or invalid in `config.json`. Fix it. See Configuration.

**The settings panel says "Companion offline".** The companion is not running. Run `start.cmd` and keep its window open.

**The game prints "WoW Companion: reply signals not working on this client, restart the game after setup".** Restart the game. It only sees the signal files that existed when it launched.

**The game prints "WoW Companion: reply slots exhausted, close start.cmd, run install.cmd (or pnpm run addon:setup), then restart the game", or the `start.cmd` window prints "[wowc] reply slots exhausted: close start.cmd, run install.cmd (or pnpm run addon:setup), then restart the game". Replies may also stop or not come back after `/reload`.** `/reload` does not refill the reply slots. Do what the message says: close the `start.cmd` window, run `install.cmd` (or `pnpm run addon:setup`), restart the game, and run `start.cmd` again.

**The window shows "[Claude] provider not installed."** The companion could not start that provider. Close the `start.cmd` window first. For Codex, check that `codex` is on your PATH and open a new window after installing it. For Claude, run `pnpm install --frozen-lockfile` again in the project folder, so the Agent SDK's own copy of Claude Code is in place. Then run `start.cmd` again.

**The window shows "[Claude] provider needs sign-in."** Log in with `claude auth login` or `codex login`.

**The window shows "[Claude] provider disabled in settings."** That provider is turned off. Check its `enabled` field in `config.json`, or pick another provider in the game settings.

**The window shows "[Claude] busy".** The chat is still answering the last question. Wait, or type `/ai cancel`.

**The game prints "WoW Companion: can't read its signal line. Show the interface (Alt+Z) if it is hidden."** The companion has been running for 20 seconds and the game's first message has still not been read. Show the game interface (Alt+Z hides it). Check that the game runs windowed or borderless, is not minimized, and that nothing covers the signal line. Try the other edge in Options > AddOns > WoW Companion > "Signal line position". The game prints a second line with this one, "WoW Companion: turn off anti-aliasing and screen overlays and set render scale to 100% in Options > Graphics, or move the line in Options > AddOns > WoW Companion." Try that next: turn off anti-aliasing, set the render scale to 100%, and turn off screen overlays and colour filters (Discord, GeForce and Steam overlays, f.lux).

**The `start.cmd` window prints "[wowc] the signal line is visible but no frame decodes; check the video settings".** The companion sees the line but cannot decode it. Turn off anti-aliasing, set the render scale to 100% in Options > Graphics, and turn off screen overlays and colour filters (Discord, GeForce and Steam overlays, f.lux). Or move the line to the other edge with "Signal line position".

**The `start.cmd` window prints "[wowc] addon and companion versions differ, run pnpm run addon:setup (or install.cmd) and restart the game".** The addon in the game folder and the companion are different versions. Close the `start.cmd` window, run `install.cmd`, restart the game, and run `start.cmd` again.

**The `start.cmd` window prints lines starting with `[wowc] capture:`.** Either the companion's screen capture process failed (`capture: Error: screen capture: ...`), or it could not write a reply slot or signal file in your game folder (`capture: Error: slots.write: ...`, or a file system error). Check that `wowPath` in `config.json` is the folder that holds `WowB.exe`, run `install.cmd` again (it recreates those files), then restart the game.

**The database build says "run pnpm run lua:setup first".** Run `pnpm run lua:setup`, then `install.cmd` again.

## How it stays within Blizzard's terms

The project follows one hard rule, recorded in `docs/adr/0001-stay-within-blizzard-terms-of-service.md`: no simulated keyboard or mouse input, no game action the addon performs without your own click, and no reading of the game's memory. The addon draws a thin line of coloured cells along the top or bottom edge of the game window. It is normally invisible and blinks briefly while the companion runs, on the schedule described under Settings, and whenever you send a question. The companion reads it from your screen. Replies come back as addon files that the game loads. This is the project's own rule, not a statement from Blizzard.

## For contributors

Run the checks in this order, and stop at the first failure. `pnpm run lua:setup` comes right after the install because `pnpm test` runs tests that need the Lua interpreter it downloads. Windows PowerShell 5.1 does not understand `&&`, so run them one at a time, or chain them in Git Bash or PowerShell 7.

```powershell
pnpm install --frozen-lockfile
pnpm run lua:setup
pnpm run lint
pnpm run knip
pnpm run typecheck
pnpm test
pnpm run lua:test
pnpm run lua:lint
pnpm run guard
pnpm run format:check
```

What each one does:

- `pnpm run lint` runs oxlint. `pnpm run format:check` runs oxfmt in check mode.
- `pnpm run knip` finds unused code and dependencies.
- `pnpm run typecheck` runs `tsc -b` with the strict settings from D18.
- `pnpm test` runs vitest. Run one file with `pnpm test scripts/setup.test.ts`.
- `pnpm run lua:setup` downloads Lua 5.1.5 and luacheck into `.tools/`. The Lua tests need it. The installer runs `node scripts/lua-setup.ts --lua-only`, which skips luacheck.
- `pnpm run lua:test` runs every `tests/lua/*_test.lua` under Lua 5.1.5, the client's dialect.
- `pnpm run lua:lint` runs luacheck and bans Lua 5.2+ syntax in `addon/`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -CheckOnly` runs only the installer's prerequisite checks and exits 0 or 1. Use it to test the checks without installing anything.
- `pnpm run guard` checks the "Must not change" rules: no game input calls, no protected addon calls, no secrets or absolute user paths in tracked files.

Where to read more:

- `AGENTS.md` holds the rules for every contributor, human or AI.
- `docs/README.md` indexes the specs and decisions.
- `docs/specs/wow-companion-v1.md` is the spec, with decisions D1 to D18.
- `docs/client-facts.md` records what is known about the game client, with sources.
- `docs/adr/` holds the binding decisions.
- `docs/versions.md` records the dependency versions.

Work trunk-based. Branch `feature/*` or `fix/*` from `master`, open a pull request, and squash merge. Title every pull request as a conventional commit (`feat:`, `fix:`, `chore:` and so on). `release-please` reads those titles to version the repo. Never commit a secret, a character name, a realm name or an absolute user path.

## License

The project is licensed under the MIT license (decision D13, `Copyright (c) 2026 VirtuaChamp`). The `LICENSE` file will be added with the repo automation (spec slice 04).
