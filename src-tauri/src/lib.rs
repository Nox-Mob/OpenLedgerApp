use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// The SQL plugin opens a pool of several connections, so BEGIN, the statements and COMMIT
/// can land on different connections and a "transaction" is not atomic. After the page
/// loads the database, this swaps in a pool with exactly one connection, so every change
/// and its history entry are saved together or not at all.
#[tauri::command]
async fn use_single_connection(app: tauri::AppHandle, db: String) -> Result<(), String> {
    let file = db
        .strip_prefix("sqlite:")
        .ok_or_else(|| "only sqlite databases are supported".to_string())?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(file);
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(10));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())?;
    let instances = app.state::<DbInstances>();
    let mut map = instances.0.write().await;
    if let Some(DbPool::Sqlite(old)) = map.insert(db, DbPool::Sqlite(pool)) {
        old.close().await;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![use_single_connection])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
