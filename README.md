# KovaaK Stats Desktop App

Windows-first Tauri + React desktop app that reads KovaaK `session.sav` data and tracks:

- Total active scenario playtime
- Per-scenario playtime
- Per-playlist playtime (manual mapping by full scenario path)

The app starts from zero and records playtime while it is running.

## Requirements (Windows)

- Node.js 20+
- Rust toolchain (install from [rustup.rs](https://rustup.rs/))
- Visual Studio Build Tools (MSVC + Windows SDK)
- WebView2 Runtime (already present on most Windows systems)

## Install

```bash
npm install
```

## Run Frontend Only

```bash
npm run dev
```

## Run Desktop App

```bash
npm run tauri dev
```

## Build Desktop App

```bash
npm run tauri build
```

## Notes

- Default session file path: `%LOCALAPPDATA%\FPSAimTrainer\Saved\SaveGames\session.sav`
- You can override session path in the app settings.
- Tray behavior and startup preference are configurable in the settings panel.
