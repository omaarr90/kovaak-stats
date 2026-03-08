mod playtime;
mod types;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use types::PlaytimeSummary;

#[derive(Clone)]
struct AppState {
  allow_exit: Arc<AtomicBool>,
}

#[tauri::command]
fn get_kovaak_playtime() -> Result<PlaytimeSummary, String> {
  playtime::read_kovaak_playtime()
}

#[tauri::command]
fn request_app_quit(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  state.allow_exit.store(true, Ordering::SeqCst);
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
    .setup(|app| {
      let allow_exit = Arc::new(AtomicBool::new(false));
      app.manage(AppState { allow_exit });
      setup_tray(app).map_err(std::io::Error::other)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_kovaak_playtime, request_app_quit])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::App) -> Result<(), String> {
  let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
    .map_err(|error| format!("failed to create tray menu item: {error}"))?;
  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
    .map_err(|error| format!("failed to create tray menu item: {error}"))?;
  let menu = Menu::with_items(app, &[&show_item, &quit_item])
    .map_err(|error| format!("failed to create tray menu: {error}"))?;
  let icon = app.default_window_icon().cloned();
  let app_handle = app.handle().clone();

  let mut tray_builder = TrayIconBuilder::with_id("main")
    .menu(&menu)
    .tooltip("KovaaK Stats")
    .on_menu_event(move |app, event| match event.id().as_ref() {
      "show" => show_main_window(app),
      "quit" => {
        if let Some(state) = app.try_state::<AppState>() {
          state.allow_exit.store(true, Ordering::SeqCst);
        }
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(move |tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window(&tray.app_handle());
      }
    });

  if let Some(window_icon) = icon {
    tray_builder = tray_builder.icon(window_icon);
  }

  tray_builder
    .build(&app_handle)
    .map_err(|error| format!("failed to build tray icon: {error}"))?;
  Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}
