use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_fs::FsExt;
mod atomic_download;
mod open_files;

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

use tauri::{WebviewUrl, WebviewWindowBuilder};

use std::sync::Mutex;
#[cfg(desktop)]
use tauri_plugin_cli::CliExt;

#[cfg(desktop)]
const MAX_RECENT_FILES: usize = 10;

#[derive(Default)]
struct OpenFiles(Mutex<open_files::OpenFileQueue>);

#[derive(serde::Serialize)]
struct StartupState {
    desktop: bool,
    files: Vec<String>,
}

fn audio_file_path(value: &str) -> Result<std::path::PathBuf, String> {
    let path = if value.starts_with("file://") {
        reqwest::Url::parse(value)
            .map_err(|e| e.to_string())?
            .to_file_path()
            .map_err(|_| "Invalid file URL".to_string())?
    } else {
        std::path::PathBuf::from(value)
    };
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !path.is_file()
        || !matches!(
            extension.as_str(),
            "mp3" | "ogg" | "m4a" | "aac" | "wav" | "flac"
        )
    {
        return Err("Please choose an audio file".into());
    }
    Ok(path)
}

fn allow_audio_file(app: &tauri::AppHandle, value: &str) -> Result<std::path::PathBuf, String> {
    let path = audio_file_path(value)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(path)
}

fn queue_open_file(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let path = allow_audio_file(app, value)?;
    let path = if cfg!(mobile) {
        reqwest::Url::from_file_path(path)
            .map_err(|_| "Invalid file path".to_string())?
            .to_string()
    } else {
        path.to_string_lossy().into_owned()
    };
    let state = app.state::<OpenFiles>();
    let mut state = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(path) = state.push(path) {
        app.emit(
            "open-file",
            serde_json::json!({ "desktop": cfg!(desktop), "path": path }),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn frontend_ready(app: tauri::AppHandle) -> Result<StartupState, String> {
    let state = app.state::<OpenFiles>();
    let mut state = state.0.lock().map_err(|e| e.to_string())?;
    Ok(StartupState {
        desktop: cfg!(desktop),
        files: state.ready(),
    })
}

#[tauri::command]
async fn download_file(app: tauri::AppHandle, url: String, filename: String) -> Result<(), String> {
    use futures_util::StreamExt;
    if !atomic_download::valid_cache_filename(&filename) {
        return Err("Invalid podcast cache filename".into());
    }
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid podcast audio URL".into());
    }
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("podcast-cache-v2");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let dest = cache_dir.join(&filename);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "MP3ChapterPlayer/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/") || value.starts_with("application/json"))
    {
        return Err("The podcast host did not return an audio file".into());
    }

    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = atomic_download::PendingDownload::new(&dest).map_err(|e| e.to_string())?;
    let mut last_pct: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_chunk(&chunk).map_err(|e| e.to_string())?;
        if let Some(total) = total.filter(|total| *total > 0) {
            let pct = (file.received.saturating_mul(100) / total).min(100);
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({ "filename": filename, "percent": pct }),
                );
            }
        }
    }

    file.complete(total).map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&dest)
        .map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_file(&dest)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
fn recent_files_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("recent_files.json")
}

#[cfg(desktop)]
fn load_recent_files(app: &tauri::AppHandle) -> Vec<String> {
    let path = recent_files_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(desktop)]
fn save_recent_files(app: &tauri::AppHandle, files: &[String]) {
    let path = recent_files_path(app);
    if let Ok(json) = serde_json::to_string_pretty(files) {
        std::fs::write(&path, json).ok();
    }
}

#[cfg(desktop)]
fn build_menu(
    app: &tauri::AppHandle,
    recent_files: &[String],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // App menu
    let about = PredefinedMenuItem::about(app, Some("MP3 Chapter Player"), None)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    let app_menu = SubmenuBuilder::new(app, "App")
        .item(&about)
        .item(&quit)
        .build()?;

    // File menu
    let open = MenuItemBuilder::with_id("open", "Open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let open_podcast = MenuItemBuilder::with_id("open_podcast", "Open Podcast Episode\u{2026}")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;

    let mut file_menu_builder = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&open_podcast);

    // Open Recent submenu
    if !recent_files.is_empty() {
        let mut recent_submenu = SubmenuBuilder::new(app, "Open Recent");
        for (i, path) in recent_files.iter().enumerate() {
            let filename = path.rsplit(['/', '\\']).next().unwrap_or(path);
            let item =
                MenuItemBuilder::with_id(format!("recent_file_{}", i), filename).build(app)?;
            recent_submenu = recent_submenu.item(&item);
        }
        recent_submenu = recent_submenu.separator();
        let clear_recent = MenuItemBuilder::with_id("clear_recent", "Clear Menu").build(app)?;
        recent_submenu = recent_submenu.item(&clear_recent);
        let recent_submenu = recent_submenu.build()?;
        file_menu_builder = file_menu_builder.item(&recent_submenu);
    }

    let close_window = PredefinedMenuItem::close_window(app, Some("Close Window"))?;
    file_menu_builder = file_menu_builder.item(&close_window);
    let file_menu = file_menu_builder.build()?;

    // Playback menu
    let play_pause = MenuItemBuilder::with_id("play_pause", "Play/Pause")
        .accelerator("Space")
        .build(app)?;
    let seek_forward = MenuItemBuilder::with_id("seek_forward", "Seek Forward 10s")
        .accelerator("L")
        .build(app)?;
    let seek_backward = MenuItemBuilder::with_id("seek_backward", "Seek Backward 10s")
        .accelerator("J")
        .build(app)?;
    let go_to_beginning =
        MenuItemBuilder::with_id("go_to_beginning", "Go to Beginning").build(app)?;
    let go_to_end = MenuItemBuilder::with_id("go_to_end", "Go to End").build(app)?;
    let volume_up = MenuItemBuilder::with_id("volume_up", "Increase Volume")
        .accelerator("Up")
        .build(app)?;
    let volume_down = MenuItemBuilder::with_id("volume_down", "Decrease Volume")
        .accelerator("Down")
        .build(app)?;
    let mute = MenuItemBuilder::with_id("mute", "Mute/Unmute")
        .accelerator("M")
        .build(app)?;
    let increase_speed = MenuItemBuilder::with_id("increase_speed", "Increase Speed")
        .accelerator("]")
        .build(app)?;
    let decrease_speed = MenuItemBuilder::with_id("decrease_speed", "Decrease Speed")
        .accelerator("[")
        .build(app)?;
    let reset_speed = MenuItemBuilder::with_id("reset_speed", "Reset Speed").build(app)?;

    let playback_menu = SubmenuBuilder::new(app, "Playback")
        .item(&play_pause)
        .separator()
        .item(&seek_forward)
        .item(&seek_backward)
        .item(&go_to_beginning)
        .item(&go_to_end)
        .separator()
        .item(&volume_up)
        .item(&volume_down)
        .item(&mute)
        .separator()
        .item(&increase_speed)
        .item(&decrease_speed)
        .item(&reset_speed)
        .build()?;

    // Chapters menu
    let next_chapter = MenuItemBuilder::with_id("next_chapter", "Next Chapter")
        .accelerator("N")
        .build(app)?;
    let previous_chapter = MenuItemBuilder::with_id("previous_chapter", "Previous Chapter")
        .accelerator("P")
        .build(app)?;
    let chapters_menu = SubmenuBuilder::new(app, "Chapters")
        .item(&next_chapter)
        .item(&previous_chapter)
        .build()?;

    // Help menu
    let keyboard_shortcuts = MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&keyboard_shortcuts)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&playback_menu)
        .item(&chapters_menu)
        .item(&help_menu)
        .build()
}

#[cfg(desktop)]
struct RecentFiles(Mutex<Vec<String>>);

#[cfg(desktop)]
#[tauri::command]
fn add_recent_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = audio_file_path(&path)?;
    if !app.asset_protocol_scope().is_allowed(&path) {
        return Err("This file has not been opened by the user".into());
    }
    let path = path.to_string_lossy().into_owned();
    let state = app.state::<RecentFiles>();
    let mut files = state.0.lock().unwrap();

    // Remove if already present, then add to front
    files.retain(|f| f != &path);
    files.insert(0, path);
    files.truncate(MAX_RECENT_FILES);

    save_recent_files(&app, &files);

    // Rebuild menu
    if let Ok(menu) = build_menu(&app, &files) {
        app.set_menu(menu).ok();
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn get_recent_files(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<RecentFiles>();
    let files = state.0.lock().unwrap().clone();
    files
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(OpenFiles::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_cli::init());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        add_recent_file,
        get_recent_files,
        download_file,
        frontend_ready
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![download_file, frontend_ready]);

    let builder = builder.setup(|_app| {
        // Create main window
        let win_builder = WebviewWindowBuilder::new(_app, "main", WebviewUrl::default());

        #[cfg(desktop)]
        let win_builder = win_builder
            .title("MP3 Chapter Player")
            .inner_size(900.0, 600.0)
            .resizable(true);

        #[cfg(target_os = "macos")]
        let win_builder = win_builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true)
            .effects(tauri::utils::config::WindowEffectsConfig {
                effects: vec![tauri::utils::WindowEffect::Sidebar],
                state: None,
                radius: None,
                color: None,
            });

        let _window = win_builder.build()?;

        #[cfg(desktop)]
        {
            let app = _app;
            let recent_files: Vec<String> = load_recent_files(&app.handle())
                .into_iter()
                .filter_map(|value| allow_audio_file(app.handle(), &value).ok())
                .map(|path| path.to_string_lossy().into_owned())
                .take(MAX_RECENT_FILES)
                .collect();
            app.manage(RecentFiles(Mutex::new(recent_files.clone())));

            let menu = build_menu(&app.handle(), &recent_files)?;
            app.set_menu(menu)?;
            if let Ok(matches) = app.cli().matches() {
                if let Some(filename) = matches
                    .args
                    .get("filename")
                    .and_then(|arg| arg.value.as_str())
                {
                    if let Err(error) = queue_open_file(app.handle(), filename) {
                        eprintln!("Could not open command-line file: {error}");
                    }
                }
            }
        }

        Ok(())
    });

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let menu_id = event.id().as_ref().to_string();

        // Handle recent file clicks by resolving to the actual path
        if menu_id.starts_with("recent_file_") {
            if let Ok(index) = menu_id
                .strip_prefix("recent_file_")
                .unwrap()
                .parse::<usize>()
            {
                let state = app.state::<RecentFiles>();
                let files = state.0.lock().unwrap();
                if let Some(path) = files.get(index) {
                    if let Err(error) = queue_open_file(app, path) {
                        let _ = app.emit("file-open-error", error);
                    }
                    return;
                }
            }
        }

        // Handle clear recent
        if menu_id == "clear_recent" {
            let state = app.state::<RecentFiles>();
            let mut files = state.0.lock().unwrap();
            files.clear();
            save_recent_files(app, &files);
            if let Ok(menu) = build_menu(app, &files) {
                app.set_menu(menu).ok();
            }
            return;
        }

        // Emit event to JavaScript for all other menu items
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("menu-event", &menu_id);
        }
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls.into_iter().filter(|url| url.scheme() == "file") {
                if let Err(error) = queue_open_file(app, url.as_str()) {
                    let _ = app.emit("file-open-error", error);
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
        let _ = (app, event);
    });
}
