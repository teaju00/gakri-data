mod commands;

use gakri_core::session::SessionStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionStore::default())
        .invoke_handler(tauri::generate_handler![
            commands::is_provisioned,
            commands::provision,
            commands::login,
            commands::logout,
            commands::meta,
            commands::student_lookup,
            commands::cohort,
            commands::import_grades,
            commands::add_teacher,
            commands::list_teachers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
