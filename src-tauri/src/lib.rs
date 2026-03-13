mod playtime;
mod types;

use types::PlaytimeSummary;

#[tauri::command]
fn get_kovaak_playtime() -> Result<PlaytimeSummary, String> {
  playtime::read_kovaak_playtime()
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
    .invoke_handler(tauri::generate_handler![get_kovaak_playtime, request_app_quit])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
