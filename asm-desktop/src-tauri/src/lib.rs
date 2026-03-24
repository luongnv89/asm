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
    dirs::home_dir()
        .map(|h| {
            let dist_path = h.join("agent-skill-manager/dist/agent-skill-manager.js");
            if dist_path.exists() {
                dist_path.to_string_lossy().to_string()
            } else {
                let local_path = h.join("buildspace/luongnv89/asm/dist/agent-skill-manager.js");
                if local_path.exists() {
                    local_path.to_string_lossy().to_string()
                } else {
                    "asm".to_string()
                }
            }
        })
        .unwrap_or_else(|| "asm".to_string())
}

#[tauri::command]
async fn invoke_asm(args: Vec<String>) -> Result<CliResult, String> {
    let asm_path = get_asm_path();

    let output = Command::new(&asm_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute ASM: {}", e))?;

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

const BUNDLED_SKILL_INDEX: &str = r#"{"skills":[{"name":"appstore-review-checker","description":"Pre-submission audit of iOS/macOS apps against Apple App Store Review Guidelines","tags":["ios","macos","app-store","review"]},{"name":"asc-cli-usage","description":"Guidance for using asc cli","tags":["apple","app-store-connect","cli"]},{"name":"code-review","description":"Perform code reviews following best practices","tags":["code-review","quality"]},{"name":"frontend-design","description":"Create production-grade frontend interfaces","tags":["frontend","ui","design"]},{"name":"research","description":"Conduct comprehensive research on any topic","tags":["research","web-search"]},{"name":"web-artifacts-builder","description":"Create elaborate HTML artifacts using React and Tailwind","tags":["frontend","react","artifact"]},{"name":"xlsx","description":"Read, edit, and create spreadsheet files","tags":["excel","spreadsheet","xlsx"]},{"name":"pdf","description":"Read, extract, merge, split PDF files","tags":["pdf","document"]},{"name":"pptx","description":"Create and edit PowerPoint presentations","tags":["powerpoint","presentation","pptx"]},{"name":"docx","description":"Create and edit Word documents","tags":["word","document","docx"]}]}"#;

#[tauri::command]
async fn get_skill_index() -> Result<CliResult, String> {
    let result = invoke_asm(vec!["index".to_string(), "--json".to_string()]).await;
    match result {
        Ok(result) if result.success => Ok(result),
        _ => Ok(CliResult {
            success: true,
            stdout: BUNDLED_SKILL_INDEX.to_string(),
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
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
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
        ])
        .setup(|app| {
            log::info!("ASM Desktop starting up...");
            let window = app.get_webview_window("main").unwrap();
            window.set_title("ASM Desktop - Agent Skill Manager").ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
