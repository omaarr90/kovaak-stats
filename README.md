# KovaaK Stats

Windows-first Tauri + React desktop app for reading KovaaK's local files and showing:

- Total challenge time from KovaaK `stats/*.csv`
- Per-playlist time from KovaaK playlist JSON files
- Per-scenario time from KovaaK stats CSV files
- Search filters for playlists and scenarios

The app does not use Steam playtime. It reads KovaaK files directly.

## Download

### Option 1: Clone with Git

```powershell
git clone https://github.com/omaarr90/kovaak-stats.git
cd kovaak-stats
```

### Option 2: Download ZIP

1. Open the GitHub repo page.
2. Click `Code`.
3. Click `Download ZIP`.
4. Extract the ZIP.
5. Open the extracted `kovaak-stats` folder in a terminal.

## Requirements

Install these on Windows before running the app:

- Node.js 20+
- Rust toolchain from [rustup.rs](https://rustup.rs/)
- Visual Studio Build Tools with MSVC + Windows SDK
- WebView2 Runtime

## Install Dependencies

```powershell
npm install
```

## Run The Desktop App

```powershell
npm run tauri dev
```

This starts the Tauri desktop app in development mode.

## Run The Frontend Only

```powershell
npm run dev
```

This only starts the Vite frontend. The desktop features and file parsing come from the Tauri backend.

## Build A Production App

```powershell
npm run tauri build
```

The built desktop app will be created under the Tauri build output folders after the build finishes.

## Useful Dev Commands

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Where The Data Comes From

The app reads KovaaK files from these locations:

- Challenge stats CSVs:
  `C:\Program Files (x86)\Steam\steamapps\common\FPSAimTrainer\FPSAimTrainer\stats`
- Playlist definitions:
  `C:\Program Files (x86)\Steam\steamapps\common\FPSAimTrainer\FPSAimTrainer\Saved\SaveGames\Playlists`

It also checks Steam library paths from `libraryfolders.vdf`, so KovaaK does not need to be installed only in the default library.

## Notes

- Total time is calculated from each KovaaK stats CSV using the challenge start time and the timestamp in the filename.
- Per-playlist time is derived by matching recorded scenario time against the scenarios currently listed in each playlist JSON file.
- Because KovaaK stats CSV files do not store a historical playlist ID per run, playlist totals are based on current playlist membership rather than an exact historical playlist session log.
- If the app shows no time, make sure you have completed some KovaaK challenges so CSV files exist in the `stats` folder.
