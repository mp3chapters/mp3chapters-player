// Prevents additional console window on Windows in release, DO NOT REMOVE!!
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

    // let playback_speed_menu = Menu::new()
    //     .add_item(CustomMenuItem::new("0.5x".to_string(), "0.5x"))
    //     .add_item(CustomMenuItem::new("0.75x".to_string(), "0.75x"))
    //     .add_item(CustomMenuItem::new("1x".to_string(), "1x"))
    //     .add_item(CustomMenuItem::new("1.25x".to_string(), "1.25x"))
    //     .add_item(CustomMenuItem::new("1.5x".to_string(), "1.5x"))
    //     .add_item(CustomMenuItem::new("1.75x".to_string(), "1.75x"))
    //     .add_item(CustomMenuItem::new("2x".to_string(), "2x"));

    // let playback_menu = Submenu::new("Playback", Menu::new()
    //     .add_item(CustomMenuItem::new("play_pause".to_string(), "Play/Pause"))
    //     .add_submenu(Submenu::new("Playback Speed", playback_speed_menu))
    //     .add_item(CustomMenuItem::new("next_chapter".to_string(), "Next Chapter"))
    //     .add_item(CustomMenuItem::new("prev_chapter".to_string(), "Previous Chapter")));

    // let window_menu = Submenu::new("Window", Menu::new()
    // );

    let menu = Menu::new()
        .add_submenu(app_menu)
        .add_submenu(file_menu);
        // .add_submenu(playback_menu)
        // .add_submenu(window_menu);

    tauri::Builder::default()
        .menu(menu)
        // .invoke_handler(tauri::generate_handler![open_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
