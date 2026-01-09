#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{CustomMenuItem, Menu, MenuItem::*, Submenu, AboutMetadata};

fn main() {
    let app_menu = Submenu::new("App", Menu::new()
        .add_native_item(About("MP3 Chapter Player".to_string(),
            AboutMetadata::default()
                .website("https://mp3chapters.github.io")
                .license("MIT")
                .authors(vec!["Dominik Peters".to_string()])
        ))
        .add_native_item(Quit));

    let file_menu = Submenu::new("File", Menu::new()
        .add_item(CustomMenuItem::new("open".to_string(), "Open").accelerator("CmdOrCtrl+O"))
        .add_native_item(CloseWindow));

    let playback_menu = Submenu::new("Playback", Menu::new()
        .add_item(CustomMenuItem::new("play_pause".to_string(), "Play/Pause").accelerator("Space"))
        .add_native_item(Separator)
        .add_item(CustomMenuItem::new("seek_forward".to_string(), "Seek Forward 10s").accelerator("L"))
        .add_item(CustomMenuItem::new("seek_backward".to_string(), "Seek Backward 10s").accelerator("J"))
        .add_item(CustomMenuItem::new("go_to_beginning".to_string(), "Go to Beginning"))
        .add_item(CustomMenuItem::new("go_to_end".to_string(), "Go to End"))
        .add_native_item(Separator)
        .add_item(CustomMenuItem::new("volume_up".to_string(), "Increase Volume").accelerator("Up"))
        .add_item(CustomMenuItem::new("volume_down".to_string(), "Decrease Volume").accelerator("Down"))
        .add_item(CustomMenuItem::new("mute".to_string(), "Mute/Unmute").accelerator("M"))
        .add_native_item(Separator)
        .add_item(CustomMenuItem::new("increase_speed".to_string(), "Increase Speed").accelerator("]"))
        .add_item(CustomMenuItem::new("decrease_speed".to_string(), "Decrease Speed").accelerator("["))
        .add_item(CustomMenuItem::new("reset_speed".to_string(), "Reset Speed")));

    let chapters_menu = Submenu::new("Chapters", Menu::new()
        .add_item(CustomMenuItem::new("next_chapter".to_string(), "Next Chapter").accelerator("N"))
        .add_item(CustomMenuItem::new("previous_chapter".to_string(), "Previous Chapter").accelerator("P")));

    let help_menu = Submenu::new("Help", Menu::new()
        .add_item(CustomMenuItem::new("keyboard_shortcuts".to_string(), "Keyboard Shortcuts").accelerator("CmdOrCtrl+/")));

    let menu = Menu::new()
        .add_submenu(app_menu)
        .add_submenu(file_menu)
        .add_submenu(playback_menu)
        .add_submenu(chapters_menu)
        .add_submenu(help_menu);

    tauri::Builder::default()
        .menu(menu)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
