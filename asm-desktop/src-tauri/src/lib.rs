use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct CliResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

#[allow(dead_code)]
fn get_asm_command() -> String {
    if cfg!(target_os = "windows") {
        "node".to_string()
    } else {
        if Command::new("bun").arg("--version").output().is_ok() {
            "bun".to_string()
        } else {
            "node".to_string()
        }
    }
}

fn get_asm_path() -> String {
    if let Some(resource_path) = std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join("resources").join("agent-skill-manager.js"))
        .filter(|p| p.exists())
    {
        return resource_path.to_string_lossy().to_string();
    }
    if let Some(home) = dirs::home_dir() {
        let dist_path = home.join("agent-skill-manager/dist/agent-skill-manager.js");
        if dist_path.exists() {
            return dist_path.to_string_lossy().to_string();
        }
    }
    "asm".to_string()
}

#[tauri::command]
async fn invoke_asm(args: Vec<String>) -> Result<CliResult, String> {
    let asm_path = get_asm_path();

    let output = Command::new(&asm_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute ASM ({}): {}", asm_path, e))?;

    Ok(CliResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code(),
    })
}

#[tauri::command]
async fn list_installed_skills() -> Result<CliResult, String> {
    invoke_asm(vec!["list".to_string(), "--json".to_string()]).await
}

#[tauri::command]
async fn search_skills(query: String) -> Result<CliResult, String> {
    invoke_asm(vec!["search".to_string(), query, "--json".to_string()]).await
}

#[tauri::command]
async fn install_skill(name: String) -> Result<CliResult, String> {
    invoke_asm(vec!["install".to_string(), name, "--yes".to_string()]).await
}

#[tauri::command]
async fn uninstall_skill(name: String) -> Result<CliResult, String> {
    invoke_asm(vec!["uninstall".to_string(), name, "--yes".to_string()]).await
}

fn get_bundled_skill_index() -> String {
    if let Ok(resource_path) = std::env::current_exe() {
        if let Some(resource_dir) = resource_path.parent() {
            let skills_index_path = resource_dir.join("resources").join("skills-index.json");
            if let Ok(contents) = std::fs::read_to_string(&skills_index_path) {
                return contents;
            } else {
                log::warn!("Failed to read bundled skills index, falling back to embedded");
            }
        }
    } else {
        log::warn!("Failed to get executable path, falling back to embedded skills index");
    }
    include_str!("../skills-index.json").to_string()
}

#[tauri::command]
async fn get_skill_index() -> Result<CliResult, String> {
    let result = invoke_asm(vec!["index".to_string(), "--json".to_string()]).await;
    match result {
        Ok(result) if result.success => Ok(result),
        _ => Ok(CliResult {
            success: true,
            stdout: get_bundled_skill_index(),
            stderr: String::new(),
            code: Some(0),
        }),
    }
}

#[tauri::command]
async fn get_config() -> Result<CliResult, String> {
    invoke_asm(vec!["config".to_string(), "--json".to_string()]).await
}

#[tauri::command]
async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
}

#[tauri::command]
async fn security_audit(skillName: String) -> Result<CliResult, String> {
    invoke_asm(vec!["audit".to_string(), "security".to_string(), skillName]).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            invoke_asm,
            list_installed_skills,
            search_skills,
            install_skill,
            uninstall_skill,
            get_skill_index,
            get_config,
            get_home_dir,
            security_audit,
        ])
        .setup(|app| {
            log::info!("ASM Desktop starting up...");
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("ASM Desktop - Agent Skill Manager").ok();
            } else {
                log::error!("Failed to get main window handle");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
