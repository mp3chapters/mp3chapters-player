use tauri::Emitter;
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
use std::sync::Mutex;

const MAX_RECENT_FILES: usize = 10;

#[tauri::command]
async fn podcast_api_request(url: String, auth_key: String, secret_key: String) -> Result<serde_json::Value, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();

    let hash_input = format!("{}{}{}", auth_key, secret_key, timestamp);
    let hash = sha1_smol::Sha1::from(&hash_input).digest().to_string();

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("X-Auth-Key", &auth_key)
        .header("X-Auth-Date", &timestamp)
        .header("Authorization", &hash)
        .header("User-Agent", "MP3ChapterPlayer/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn download_file(app: tauri::AppHandle, url: String, dest: String) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "MP3ChapterPlayer/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_pct: u64 = 0;

    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if let Some(total) = total {
            let pct = (downloaded * 100) / total;
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit("download-progress", pct);
            }
        }
    }

    Ok(())
}

#[cfg(desktop)]
fn recent_files_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().expect("failed to get app data dir");
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
fn build_menu(app: &tauri::AppHandle, recent_files: &[String]) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
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
            let filename = path.split('/').last()
                .or_else(|| path.split('\\').last())
                .unwrap_or(path);
            let item = MenuItemBuilder::with_id(format!("recent_file_{}", i), filename)
                .build(app)?;
            recent_submenu = recent_submenu.item(&item);
        }
        recent_submenu = recent_submenu.separator();
        let clear_recent = MenuItemBuilder::with_id("clear_recent", "Clear Menu")
            .build(app)?;
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
    let go_to_beginning = MenuItemBuilder::with_id("go_to_beginning", "Go to Beginning")
        .build(app)?;
    let go_to_end = MenuItemBuilder::with_id("go_to_end", "Go to End")
        .build(app)?;
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
    let reset_speed = MenuItemBuilder::with_id("reset_speed", "Reset Speed")
        .build(app)?;

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
fn add_recent_file(app: tauri::AppHandle, path: String) {
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_cli::init());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![add_recent_file, get_recent_files, podcast_api_request, download_file]);

    let builder = builder.setup(|_app| {
            // Create main window
            let win_builder = WebviewWindowBuilder::new(_app, "main", WebviewUrl::default())
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
                let recent_files = load_recent_files(&app.handle());
                app.manage(RecentFiles(Mutex::new(recent_files.clone())));

                let menu = build_menu(&app.handle(), &recent_files)?;
                app.set_menu(menu)?;
            }

            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let menu_id = event.id().as_ref().to_string();

        // Handle recent file clicks by resolving to the actual path
        if menu_id.starts_with("recent_file_") {
            if let Ok(index) = menu_id.strip_prefix("recent_file_").unwrap().parse::<usize>() {
                let state = app.state::<RecentFiles>();
                let files = state.0.lock().unwrap();
                if let Some(path) = files.get(index) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("open-recent-file", path.clone());
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

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
