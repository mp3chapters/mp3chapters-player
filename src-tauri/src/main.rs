#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{CustomMenuItem, Menu, MenuItem::*, Submenu, AboutMetadata, Manager};

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

    let menu = Menu::new()
        .add_submenu(app_menu)
        .add_submenu(file_menu);

    tauri::Builder::default()
        .menu(menu)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
