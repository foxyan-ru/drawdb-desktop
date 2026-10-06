# DrawDB Desktop - Build Instructions

## Prerequisites

### All Platforms
- **Node.js** 20+ (https://nodejs.org)
- **Rust** stable toolchain (https://rustup.rs)
- **npm** (comes with Node.js)

### Windows
- Microsoft Visual Studio C++ Build Tools
- WebView2 (pre-installed on Windows 10 1803+ and Windows 11)

### macOS
- Xcode Command Line Tools: `xcode-select --install`

### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev
```

## Setup

1. **Clone or navigate to the project directory:**
   ```bash
   cd drawdb-desktop
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Install Tauri CLI (if not already installed):**
   ```bash
   npm install -g @tauri-apps/cli
   ```

## Development

Run the app in development mode with hot-reload:

```bash
npm run tauri:dev
```

This starts the Vite dev server and the Tauri window simultaneously. Changes to Svelte files reload instantly; changes to Rust files trigger a recompile.

## Building for Production

### Build the executable:

```bash
npm run tauri:build
```

This produces optimized, distributable binaries in `src-tauri/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| **Windows** | `src-tauri/target/release/bundle/msi/DrawDB_1.0.0_x64_en-US.msi` and `src-tauri/target/release/bundle/nsis/DrawDB_1.0.0_x64-setup.exe` |
| **macOS** | `src-tauri/target/release/bundle/dmg/DrawDB_1.0.0_aarch64.dmg` or `DrawDB_1.0.0_x64.dmg` |
| **Linux** | `src-tauri/target/release/bundle/deb/draw-db-desktop_1.0.0_amd64.deb` and `src-tauri/target/release/bundle/appimage/DrawDB_1.0.0_amd64.AppImage` |

### Cross-compilation targets:

```bash
# Windows (from Windows)
npm run tauri build -- --target x86_64-pc-windows-msvc

# macOS Apple Silicon
npm run tauri build -- --target aarch64-apple-darwin

# macOS Intel
npm run tauri build -- --target x86_64-apple-darwin

# Linux
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

## GitHub Actions CI/CD

The included `.github/workflows/build.yml` workflow automatically builds for all platforms when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This creates a draft GitHub Release with installers for Windows (MSI + NSIS), macOS (DMG), and Linux (DEB + AppImage).

## Project Structure

```
drawdb-desktop/
├── src/                          # SvelteKit frontend
│   ├── routes/                   # SvelteKit pages
│   │   ├── +layout.svelte        # Root layout
│   │   ├── +layout.ts            # SSR disabled, prerendered
│   │   └── +page.svelte          # Main editor page
│   ├── lib/
│   │   ├── components/           # Svelte components
│   │   │   ├── Canvas/           # SVG diagram canvas
│   │   │   ├── SidePanel/        # Side panel with tabs
│   │   │   ├── Header/           # Toolbar and modals
│   │   │   └── ui/               # Reusable UI primitives
│   │   ├── stores/               # Svelte stores (state management)
│   │   ├── data/                 # Constants, types, databases
│   │   ├── utils/                # SQL export, path calculation
│   │   └── i18n/                 # Internationalization
│   ├── app.html                  # HTML shell
│   └── app.css                   # Global styles + Tailwind
├── src-tauri/                    # Tauri/Rust backend
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   └── lib.rs                # Tauri commands (file I/O, settings)
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   └── capabilities/             # Tauri security permissions
├── static/                       # Static assets
├── .github/workflows/build.yml   # CI/CD pipeline
├── package.json                  # Node.js dependencies
├── svelte.config.js              # SvelteKit config (static adapter)
├── vite.config.ts                # Vite config with Tauri integration
└── tsconfig.json                 # TypeScript config
```

## Key Design Decisions

- **SvelteKit + Static Adapter**: The frontend is pre-rendered as static HTML/JS for Tauri to load. No server-side rendering.
- **Svelte 5 Runes**: Uses `$state`, `$derived`, `$effect`, `$props` for reactive state management.
- **Svelte Stores**: Replace React Context with Svelte writable/derived stores for global state.
- **Tauri File System**: Diagrams are saved as `.ddb` JSON files in the app data directory, replacing browser IndexedDB.
- **Native Dialogs**: File open/save dialogs use Tauri's dialog plugin for native OS integration.
- **Tailwind CSS 4**: All styling via utility classes, no UI component library dependency.
- **Optimized Release Build**: Rust compiled with LTO, single codegen unit, and symbol stripping for minimal binary size.
- **Low Memory**: No Electron overhead; Tauri uses the OS webview (~10-30MB RAM vs Electron's ~100-300MB).

## Enhancements Over Web Version

1. **Native file dialogs** for open/save/export
2. **Filesystem-based storage** instead of browser IndexedDB
3. **System dark/light mode** detection
4. **Smaller memory footprint** (~20MB vs ~200MB+ for Electron)
5. **Native window management** (resize, minimize, maximize)
6. **Cross-platform installers** generated automatically
7. **Auto-save to filesystem** with configurable interval
8. **Recent files** tracking
9. **Better performance** from Svelte's compiled reactivity vs React's virtual DOM
10. **Offline-first** - no network dependency

## Troubleshooting

### "cargo not found"
Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### WebView2 missing (Windows)
Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### Build fails on Linux
Install all system dependencies listed in the Prerequisites section.

### "permission denied" on macOS
Run: `chmod +x src-tauri/target/release/bundle/macos/DrawDB.app/Contents/MacOS/DrawDB`
