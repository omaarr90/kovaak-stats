mod db;
mod parser;
mod playtime;
mod tracking;
mod types;

use std::env;
use std::path::PathBuf;

use db::Database;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tracking::TrackerHandle;
use types::{AppSettings, PlaylistRecord, ScenarioRef, StatsOverview, UpdateSettingsInput};

use types::PlaytimeSummary;

const APP_DATA_FOLDER: &str = "com.omaarr90.kovaakstats";
const TRAY_SHOW_MENU_ID: &str = "tray-show";
const TRAY_QUIT_MENU_ID: &str = "tray-quit";
const HIDDEN_TO_TRAY_EVENT: &str = "app://hidden-to-tray";

#[derive(Clone)]
struct AppState {
  db: Database,
  tracker: TrackerHandle,
}

fn app_data_dir() -> PathBuf {
  env::var("LOCALAPPDATA")
    .map(PathBuf::from)
    .unwrap_or_else(|_| env::temp_dir())
    .join(APP_DATA_FOLDER)
}

fn app_database_path() -> PathBuf {
  app_data_dir().join("tracking.sqlite")
}

fn tracked_stats_overview(state: &AppState) -> Result<StatsOverview, String> {
  state.db.get_stats_overview_with_diagnostics(
    state.tracker.active_contribution(),
    state.tracker.diagnostics(),
  )
}

fn sync_runtime_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let autostart = app.autolaunch();
  if settings.start_with_windows {
    autostart
      .enable()
      .map_err(|error| format!("failed to enable start with Windows: {error}"))?;
  } else {
    autostart
      .disable()
      .map_err(|error| format!("failed to disable start with Windows: {error}"))?;
  }

  Ok(())
}

fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window is unavailable".to_string())?;

  let _ = window.unminimize();
  window
    .show()
    .map_err(|error| format!("failed to show main window: {error}"))?;
  window
    .set_focus()
    .map_err(|error| format!("failed to focus main window: {error}"))?;
  Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let tray_menu = MenuBuilder::new(app)
    .text(TRAY_SHOW_MENU_ID, "Show KovaaK Stats")
    .text(TRAY_QUIT_MENU_ID, "Quit")
    .build()?;

  let mut tray_builder = TrayIconBuilder::with_id("main")
    .menu(&tray_menu)
    .tooltip("KovaaK Stats")
    .show_menu_on_left_click(false);

  if let Some(icon) = app.default_window_icon().cloned() {
    tray_builder = tray_builder.icon(icon);
  }

  let _ = tray_builder.build(app)?;
  Ok(())
}

#[tauri::command]
fn get_kovaak_playtime() -> Result<PlaytimeSummary, String> {
  playtime::read_kovaak_playtime()
}

#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
  state.db.get_settings()
}

#[tauri::command]
fn update_app_settings(
  app: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  input: UpdateSettingsInput,
) -> Result<AppSettings, String> {
  let settings = state.db.update_settings(input)?;
  sync_runtime_settings(&app, &settings)?;
  Ok(settings)
}

#[tauri::command]
fn get_tracked_stats_overview(state: tauri::State<'_, AppState>) -> Result<StatsOverview, String> {
  tracked_stats_overview(&state)
}

#[tauri::command]
fn get_tracking_scenarios(state: tauri::State<'_, AppState>) -> Result<Vec<ScenarioRef>, String> {
  state.db.get_scenarios(state.tracker.active_contribution())
}

#[tauri::command]
fn get_playlist_records(state: tauri::State<'_, AppState>) -> Result<Vec<PlaylistRecord>, String> {
  state.db.get_playlists()
}

#[tauri::command]
fn create_playlist_record(
  state: tauri::State<'_, AppState>,
  name: String,
) -> Result<PlaylistRecord, String> {
  state.db.create_playlist(&name)
}

#[tauri::command]
fn set_playlist_record_mappings(
  state: tauri::State<'_, AppState>,
  playlist_id: i64,
  scenario_paths: Vec<String>,
) -> Result<Vec<PlaylistRecord>, String> {
  state.db.set_playlist_mappings(playlist_id, scenario_paths)?;
  state.db.get_playlists()
}

#[tauri::command]
fn request_app_quit(app: tauri::AppHandle) -> Result<(), String> {
  app.exit(0);
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None::<Vec<&str>>,
    ))
    .on_menu_event(|app, event| match event.id().as_ref() {
      TRAY_SHOW_MENU_ID => {
        if let Err(error) = show_main_window(app) {
          log::error!("failed to restore main window from tray: {error}");
        }
      }
      TRAY_QUIT_MENU_ID => {
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|app, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        if let Err(error) = show_main_window(app) {
          log::error!("failed to restore main window from tray click: {error}");
        }
      }
    })
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }

      if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<AppState>();
        match state.db.get_settings() {
          Ok(settings) if settings.minimize_to_tray => {
            api.prevent_close();
            if let Err(error) = window.hide() {
              log::error!("failed to hide window to tray: {error}");
              return;
            }
            if let Err(error) = window.app_handle().emit(HIDDEN_TO_TRAY_EVENT, ()) {
              log::error!("failed to emit hidden-to-tray event: {error}");
            }
          }
          Ok(_) => {}
          Err(error) => {
            log::error!("failed to read settings while handling close request: {error}");
          }
        }
      }
    })
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      let db = Database::new(app_database_path());
      db.init_schema()?;
      let settings = db.get_settings()?;
      sync_runtime_settings(app.handle(), &settings)?;
      build_tray(app.handle())?;

      let tracker = TrackerHandle::default();
      tracking::start_tracking_loop(db.clone(), tracker.clone());
      app.manage(AppState { db, tracker });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_kovaak_playtime,
      get_app_settings,
      update_app_settings,
      get_tracked_stats_overview,
      get_tracking_scenarios,
      get_playlist_records,
      create_playlist_record,
      set_playlist_record_mappings,
      request_app_quit
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
