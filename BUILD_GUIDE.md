# DrawDB Desktop — Build, CI & Release Guide

A complete reference for agents (and humans) building, fixing, and releasing this
Tauri 2 desktop application. It documents the architecture, every command, the CI
workflow, the tagging/release process, and **every correction that was required to
get a green build and a working installer** — with the exact error messages so you
can recognize them instantly on similar projects.

Companion files:

- `BUILD_INSTRUCTIONS.md` — local developer setup (deep dive, cross-compilation).
- `README.md` — user-facing overview and media templates.
- `.github/workflows/build.yml` — the CI pipeline this document describes.

---

## 1. Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop shell | Tauri **2.12.x** (Rust) | `src-tauri/`, edition 2021 |
| Frontend | Svelte **5** (runes) + SvelteKit **2** + Vite **6** | adapter-static, SPA mode |
| Styling | Tailwind CSS **4** (via `@tailwindcss/vite`) | `src/app.css` |
| Package manager | **Bun** ≥ 1.1 | replaces npm entirely; also runs tests (`bun test`) |
| Toolchain | Rust **stable** (CI: `dtolnay/rust-toolchain@stable`) | MSVC on Windows, Apple toolchain on macOS |
| Tests | `bun test` | 7 tests, 2 files |
| Lint/typecheck | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` | **errors fail CI; warnings do not** |

Rust release profile (`src-tauri/Cargo.toml`):

```toml
[profile.release]
panic = "abort"      # smaller binary; turns panics into BEX64 WER crashes (see §7.4)
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

Tauri plugins (Rust side): `dialog`, `fs`, `shell`, `os`. Frontend mirrors them:
`@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `plugin-fs`, `plugin-shell`, `plugin-os`.

---

## 2. Prerequisites

### All platforms

```bash
# Bun 1.0+ — https://bun.sh
curl -fsSL https://bun.sh/install | bash          # macOS/Linux
# Windows: powershell -c "irm https://bun.sh/install.ps1 | iex"

# Rust stable — https://rustup.rs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Windows

- Visual Studio C++ Build Tools (“Desktop development with C++” workload)
- WebView2 runtime — pre-installed on Windows 10 1803+ / Windows 11
  (verify: `HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` → `pv`)

### macOS

```bash
xcode-select --install
```

### Linux (Debian/Ubuntu) — also done automatically in CI

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev
```

---

## 3. Local commands

| Command | What it does |
|---|---|
| `bun install` | Install JS dependencies (Tauri CLI is a dev dependency — no global install) |
| `bun run dev` | Vite dev server only (browser preview, no native menus/fs) |
| `bun run tauri:dev` | Desktop app in dev mode with hot reload |
| `bun run build` | Production frontend build → `build/` (`beforeBuildCommand` of tauri) |
| `bun run tauri:build` | Full production build: vite build + `cargo build --release` + bundling |
| `bun run lint` | `svelte-kit sync && svelte-check` — exit ≠ 0 on **errors** (warnings pass) |
| `bun run test` | `bun test` |
| `bunx tauri build --target <triple>` | Build for an explicit target triple |

Cross-compilation targets:

```bash
bunx tauri build --target x86_64-pc-windows-msvc   # Windows (from Windows)
bunx tauri build --target x86_64-apple-darwin      # macOS Intel
bunx tauri build --target aarch64-apple-darwin     # macOS Apple Silicon
bunx tauri build --target x86_64-unknown-linux-gnu # Linux
```

Installer output locations (from `src-tauri/target/<triple>/release/bundle/`):

| Platform | Format | Path |
|---|---|---|
| Windows | NSIS `.exe` only (MSI disabled) | `bundle/nsis/DrawDB_1.0.0_x64-setup.exe` (~1.9 MB) |
| macOS | `.dmg` (+ `.app`) | `bundle/dmg/DrawDB_1.0.0_x64.dmg` (~2.5 MB) |
| Linux | `.deb` / `.rpm` / `.AppImage` | `bundle/deb/…deb`, `bundle/rpm/…rpm`, `bundle/appimage/…AppImage` (~2.5 / 2.5 / 77 MB) |

> The AppImage is ~77 MB by design: it bundles WebKitGTK/GTK for portability.
> The `.deb`/`.rpm` use distro libraries and stay ~2.5 MB.

Config validation before building:

```powershell
Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json | Out-Null   # must not throw
```

---

## 4. Key files

```
.github/workflows/build.yml     CI: check → build (matrix) → release (tag-gated)
src-tauri/tauri.conf.json       App + bundle + plugin config (schema-validated at build)
src-tauri/Cargo.toml            Rust crate + release profile
src-tauri/capabilities/default.json  ACL permissions (what JS may call)
src/lib/stores/*.ts             Svelte stores (diagram, transform, connect, …)
src/lib/components/Canvas/      Canvas.svelte, Table.svelte, Relationship.svelte, …
src/lib/components/SidePanel/   Tab bar + Tables/Relationships/Areas/Notes/Types/Enums tabs
```

---

## 5. CI workflow (`.github/workflows/build.yml`)

### 5.1 Triggers

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']        # releases are produced ONLY from tags
  pull_request: { branches: [main] }
  workflow_dispatch:
permissions: { contents: write }
```

### 5.2 Jobs

```
check (Lint & Test, ubuntu)
   └─ build (matrix, needs: check)
        ├─ windows-x64  → windows-latest   target x86_64-pc-windows-msvc
        ├─ macos-x64    → macos-latest     target x86_64-apple-darwin
        └─ linux-x64    → ubuntu-22.04     target x86_64-unknown-linux-gnu
             └─ release (needs: build, only on refs/tags/*)
```

- **check**: `bun install` → `bun run lint` → `bun run test`.
- **build**: Rust stable + `swatinem/rust-cache@v2` (`workspaces: src-tauri -> target`),
  Linux apt deps, `bunx tauri build --target <triple>`, then **upload-artifact with
  per-platform installer globs** and `if-no-files-found: error`.
- **release**: `download-artifact` with `merge-multiple: true` → single
  `softprops/action-gh-release@v2` call → **draft** release with `files: installers/**/*`
  and `fail_on_unmatched_files: true`.

### 5.3 Per-platform installer globs (matrix `installers`)

```yaml
windows-x64: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
macos-x64:   src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg
linux-x64:   |
  src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb
  src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm
  src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/*.AppImage
```

> **Never** use `bundle/**/*` — see correction §7.11 (241 junk assets / 335 MB).

### 5.4 Cross-repository publishing (fork → main repo)

This repo is built by CI on a **fork** because the owner account has a GitHub
Actions billing lock. The release job therefore publishes across repos:

```yaml
token: ${{ secrets.RAINMAN_TOKEN }}        # PAT stored in the FORK's secrets
repository: rainman456/drawdb-desktop      # target (owner) repository
draft: true                                # always draft; human publishes
```

Requirements:
- `secrets.RAINMAN_TOKEN` must exist in the repository where the workflow RUNS (fork),
  with `contents: write` on the target repo.
- Workflow file must live on the pushed tag's commit (tags carry it — fork `main`
  may be behind, that's fine).

### 5.5 Why one release job (rate limits)

Early design had **4 matrix jobs racing** to upload to the same release. Result:
GitHub **secondary rate limit** → 2 of 4 jobs failed at “Draft GitHub release”,
leaving a broken half-populated draft. The fix is the current design: builds only
*upload artifacts*; one serial `release` job attaches files to GitHub once.

---

## 6. Tags & releases

### 6.1 Rules learned the hard way

1. **Tags must be pushed with `git push`.** Tags created through the GitHub UI or
   `POST /repos/.../tags` do **not** reliably fire `push` workflows (empirically:
   tag `v1.0.0` created via API produced **zero** runs).
2. **Re-running a failed run reuses the OLD workflow file.** If you fixed
   `.github/workflows/build.yml`, you must push a **new tag** — re-runs won't see it.
3. A tag push transfers the whole commit tree to the fork, even if the fork's
   `main` branch is behind/diverged. You do **not** need to sync the fork's branch.
4. Release only fires on `refs/tags/*` — pushes to `main` run check + builds but
   never create releases.
5. The tag namespace is `v*` (e.g. `v1.1.4`). The installer *file names* come from
   `version` in `src-tauri/tauri.conf.json` (currently `1.0.0`) and do not change
   per tag.
6. Releases are created as **drafts** — invisible to the public until published.

### 6.2 Canonical release procedure (this project's accounts)

```powershell
# 1. Commit your work on main
git add -A
git commit -m "fix: ..."

# 2. Push to the owner's repository (requires owner auth)
gh auth switch --user rainman456
git push origin main

# 3. Create the tag and push it to the FORK where CI runs (requires fork auth)
gh auth switch --user foxyan-ru
git tag v1.1.5
git push https://github.com/foxyan-ru/drawdb-desktop v1.1.5

# 4. Watch the run (builds are remote — zero local load)
gh run list --repo foxyan-ru/drawdb-desktop --limit 1
gh run view <RUN_ID> --repo foxyan-ru/drawdb-desktop --json status,conclusion,jobs
# inspect a failing job's log:
gh run view <RUN_ID> --repo foxyan-ru/drawdb-desktop --log-failed

# 5. Publish the draft on the owner repo
gh auth switch --user rainman456
$rels = gh api repos/rainman456/drawdb-desktop/releases | ConvertFrom-Json
$rel  = $rels | Where-Object { $_.tag_name -eq 'v1.1.5' } | Select-Object -First 1
gh api -X PATCH "repos/rainman456/drawdb-desktop/releases/$($rel.id)" -f draft=false
```

### 6.3 Deleting a bad draft

```powershell
gh api -X DELETE repos/rainman456/drawdb-desktop/releases/<RELEASE_ID>
```

### 6.4 gh CLI quirks (PowerShell)

- **Do not use `--jq` with double quotes** in PowerShell — quotes/`>` get stripped or
  mangled by the shell. Parse instead:

  ```powershell
  gh run view <ID> --json status,conclusion,jobs | ConvertFrom-Json
  (gh api repos/OWNER/REPO/releases | ConvertFrom-Json) | Where-Object { ... }
  ```

- `gh auth switch --user <name>` flips the active account; confirm with
  `gh auth status` (the account with `Active account: true` owns pushes/API writes).
- Fork = `foxyan-ru/drawdb-desktop` (CI), origin = `rainman456/drawdb-desktop` (release).

---

## 7. Corrections catalog

Every error below actually occurred in this project. Each entry: **error → cause → fix**.

### 7.1 Capability identifier typo (build-time, Rust)

```
error: `fs:allow-readdir` is not a valid permission identifier
```

- **Cause:** hand-written ACL identifier; Tauri v2 generates `fs:allow-read-dir` (camel-cased `readDir`).
- **Fix:** in `src-tauri/capabilities/default.json`, replace with `fs:allow-read-dir`.
  Always validate hand-written identifiers against the plugin's generated permission list.

### 7.2 `bundle.windows.targets` is invalid in Tauri v2 (build-time, schema)

```
Error "tauri.conf.json" error on bundle > windows: Additional properties are not allowed ('targets' was unexpected)
```

- **Cause:** Tauri v1 allowed per-section target overrides; v2's `WindowsConfig` has no
  `targets` field. The schema enforcing this is **embedded in the Tauri CLI**, not the
  `$schema` URL in the file.
- **Fix:** remove `bundle.windows.targets` and control formats via the **top-level**
  `bundle.targets` list:

  ```json
  "bundle": { "targets": ["app", "dmg", "deb", "rpm", "appimage", "nsis"] }
  ```

  Valid `BundleType` values: `deb`, `rpm`, `appimage`, `msi`, `nsis`, `app`, `dmg`.
  (Omit `msi` to stop producing MSI installers.)
- **Foreign kinds are safe:** the bundler only warns and skips types unsupported on the
  current OS (`log::warn!("ignoring {}", ...)` in `tauri-bundler`), so one global list
  works for all three platforms.

### 7.3 Startup panic: v1-style plugin config (runtime, silent)

Symptom: **double-click does nothing** — no window, no error dialog.

Diagnosis (see §7.4 for the full method) reveals:

```
thread 'main' panicked at src/lib.rs:199:
error while running DrawDB: PluginInitialization("dialog",
"Error deserializing 'plugins.dialog' within your Tauri configuration:
invalid type: map, expected unit")
```

- **Cause:** `tauri.conf.json` carried Tauri **v1** plugin blocks:
  - `"dialog": { "all": true }` — v2 dialog plugin config type is **unit** (`()`); any map fails.
  - `"fs": { "scope": {...} }` — v2 fs config only has `requireLiteralLeadingDot`;
    scopes moved to **capabilities** (`$APPDATA/**` etc. are granted there already).
- **Fix:** delete those blocks. Keep only what v2 accepts:

  ```json
  "plugins": { "shell": { "open": true } }
  ```

  Plugin *registration* (`.plugin(dialog::init())` in Rust) is independent of config —
  removing config does not remove the plugin; permissions stay in `capabilities/default.json`.

### 7.4 Silent startup crashes on Windows (diagnosis playbook)

Caused by `panic = "abort"` + `windows_subsystem = "windows"`: a Rust panic becomes a
**WER crash event with no console output**. Step-by-step:

```powershell
# 1. Look for crash events in the last hours
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddHours(-3)} |
  Where-Object { $_.Message -match 'drawdb|tauri|webview' } |
  Select-Object TimeCreated, Id, ProviderName
#    BEX64, Id 1001 → native crash; check P1 (app) and P8 (exception code, e.g. c0000409)

# 2. Read the WER report for fault module + loaded modules
$dir = Get-ChildItem 'C:\ProgramData\Microsoft\Windows\WER\ReportQueue' -Filter 'AppCrash_<name>*' -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content (Join-Path $dir.FullName 'Report.wer') -Raw
#    Sig[3] Fault Module Name, Sig[7] Exception Code, LoadedModule[*] = what was loaded at crash

# 3. THE decisive step: relaunch with stderr redirected to capture the Rust panic
$exe = "$env:LOCALAPPDATA\<App>\<app>.exe"
$p = Start-Process $exe -RedirectStandardOutput "$env:TEMP\o.txt" -RedirectStandardError "$env:TEMP\e.txt" -PassThru
Start-Sleep 6
"running: $(-not $p.HasExited); exit: $($p.ExitCode)"
Get-Content "$env:TEMP\e.txt" -Raw          # ← the actual panic message lives here

# 4. Rule out environment
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled   # Defender status
try { Get-MpThreatDetection -ErrorAction Stop } catch {}         # quarantine
# WebView2 runtime:
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' | Select-Object pv
```

If no crash event exists and the process stays alive but nothing appears:
Defender/SmartScreen likely quarantined the **unsigned** NSIS installer or binary —
check **Windows Security → Protection history**, or file → Properties → **Unblock**.

### 7.5 Svelte 5 runes migration (lint-time errors)

- Stores read as `let x = someStore` + `$:` need conversion to:

  ```ts
  let items = $state<T[]>([]);
  $effect(() => someStore.subscribe((v) => { items = v; }));
  const filtered = $derived(...);
  ```

- Module-level `export const saveState = ...` built from Svelte-4 constructs →
  use `writable()` from `svelte/store`.
- Template conditionals using `currentModal` → `$state<number>()` etc.
- TS: interface fields read by renderers must exist — e.g. `Relationship.color?: string`.

### 7.6 `class:` directive cannot parse Tailwind variants (parse error)

```
Error: Expected token >   (src/.../Table.svelte)
class:dark:bg-purple-900/40={isConnectSource(field)}
```

- **Cause:** Svelte's `class:name` directive does not accept `:` (variants) or `/`
  (opacity) in the name.
- **Fix:** interpolate into the `class` string instead:

  ```svelte
  class="... {isConnectSource(field) ? 'bg-purple-50 dark:bg-purple-900/40' : ''}"
  ```

### 7.7 Type import shadowing a component (TS)

```
Error: Duplicate identifier 'Relationship'
Error: 'Relationship' only refers to a type, but is being used as a value here
```

- **Cause:** `import Relationship from './Relationship.svelte'` (component) collided
  with `type Relationship` from constants.
- **Fix:** alias the type import:

  ```ts
  import Relationship from './Relationship.svelte';
  import { type Relationship as RelationshipType } from '$lib/data/constants';
  ```

### 7.8 DOM APIs on SVG/foreignObject elements (TS)

`exportImage.ts` passes SVG elements to helpers expecting `HTMLElement` — cast at
boundary: `svgEl as unknown as HTMLElement` (three sites).

### 7.9 Tauri menu types (TS)

`menu.ts` used Tauri menu classes only as types → `import type { MenuItem as MenuItemInstance, ... }`.

### 7.10 Workflow gate hid build failures

Early workflow restricted the `build` job with
`if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')`,
so plain pushes to `main` only ran lint/tests and **build breaks surfaced at tag time**.
**Fix:** removed the gate — every push builds all three platforms; tags only add the release job.

### 7.11 Uploading `bundle/**/*` exploded the release (assets/rate limit)

- **Symptom:** 241 assets, 335.6 MB per release — including `libwebkit2gtk-4.1.so.0`
  (85.8 MB) and every AppDir internal file; real installers buried at the bottom;
  concurrent uploads then tripped a **secondary rate limit**.
- **Fix:** precise per-platform globs (§5.3) + single serial `release` job (§5.5).
  Result: exactly 5 assets, ~87 MB total.

### 7.12 Removed artifacts (product decisions)

- **MSI** removed — Windows is exe-only (`bundle.targets` excludes `msi`).
- **macOS aarch64** removed from the matrix (Intel `.dmg` only).
  (Local Apple Silicon builds still work via `--target aarch64-apple-darwin`, but the
  `bundle.targets` list includes `app`/`dmg` only — adjust if you re-enable it.)

### 7.13 npm → bun conversion

The project runs entirely on Bun (`bun.lock`, `bun run`, `bun test`). Do not introduce
`package-lock.json`/npm scripts — CI uses `oven-sh/setup-bun@v2` only.

---

## 8. Post-fix verification checklist

Run before tagging:

```powershell
bun run lint                          # 0 errors required (warnings OK)
bun run test                          # all pass
Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json | Out-Null   # valid JSON
```

If the impeccable skill is active, also run once over changed UI files:

```bash
node <skill-base>/scripts/detect.mjs --json <changed files>
```

After CI finishes:

- [ ] All jobs green: `check`, 3 × `build`, `release`
- [ ] Draft exists with **exactly** the expected installers (5 assets: exe, dmg, deb, rpm, AppImage)
- [ ] No `.msi`, no `.so`/AppDir internals, no aarch64 dmg
- [ ] Draft published (`PATCH ... draft=false`)
- [ ] Smoke test on a real machine: install → app opens → create table →
      drag field grip-dot to another table's field → relationship line appears

---

## 9. Diagnostic command cheat sheet

```powershell
# --- CI / GitHub ---
gh run list --repo <owner>/<repo> --limit 5
gh run view <ID> --repo <owner>/<repo> --json status,conclusion,jobs | ConvertFrom-Json
gh run view <ID> --repo <owner>/<repo> --log-failed
gh api repos/<owner>/<repo>/releases | ConvertFrom-Json
gh auth switch --user <account>            # switch active gh account
gh auth status

# --- Repo / tags ---
git tag -l
git push <fork-url> v1.2.3
git ls-remote --tags <fork-url>            # verify tag landed

# --- Tauri config ---
Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json | Out-Null
# tauri.conf.json validation errors appear during `tauri build` with paths like
#   "tauri.conf.json" error on bundle > windows: ...

# --- Frontend ---
bun install
bun run lint
bun run test

# --- Windows runtime ---
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddHours(-3)} |
  Where-Object { $_.Message -match 'BEX64|AppHang' }
Start-Process $exe -RedirectStandardError "$env:TEMP\e.txt" -PassThru   # capture panics
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled
```

---

## 10. Known environment constraints (read before changing CI)

- **Owner account (`rainman456`) has an Actions billing lock** → workflows must run on
  the fork (`foxyan-ru/drawdb-desktop`); releases are published cross-repo with
  `secrets.RAINMAN_TOKEN`.
- **Developer machine is hardware-constrained** → never run `cargo build` /
  `tauri:build` locally for verification; rely on CI builds (remote) and
  `bun run lint` / `bun test` (cheap) for local gates.
- Both `gh` accounts may be logged in simultaneously; pushes fail with 403 until you
  `gh auth switch` to the account that owns the target remote.
