#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_cli::init());

    let builder = builder.setup(|_app| {
            #[cfg(desktop)]
            {
                let app = _app;
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
                let close_window = PredefinedMenuItem::close_window(app, Some("Close Window"))?;
                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&open)
                    .item(&close_window)
                    .build()?;

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

                let menu = MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&file_menu)
                    .item(&playback_menu)
                    .item(&chapters_menu)
                    .item(&help_menu)
                    .build()?;

                app.set_menu(menu)?;
            }

            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let menu_id = event.id().as_ref().to_string();
        // Emit event to JavaScript
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("menu-event", &menu_id);
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
