use tauri::command;
use std::process::Command;
use std::path::Path;

#[command]
pub async fn git_exec(repo: String, args: Vec<String>) -> Result<String, String> {
    let repo_path = Path::new(&repo);
    if !repo_path.exists() {
        return Err("Repository path does not exist".to_string());
    }

    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    cmd.arg("-c").arg("color.ui=never");
    for arg in args {
        cmd.arg(arg);
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute git: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Git command failed: {}", stderr))
    }
}

#[command]
pub async fn git_status(repo: String) -> Result<String, String> {
    git_exec(repo, vec!["status".to_string(), "--porcelain".to_string()]).await
}

#[command]
pub async fn git_diff(repo: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff".to_string()];
    if staged {
        args.push("--cached".to_string());
    }
    git_exec(repo, args).await
}

#[command]
pub async fn git_log(repo: String, limit: usize) -> Result<String, String> {
    git_exec(repo, vec!["log".to_string(), format!("--oneline"), format!("-{}", limit)]).await
}

#[command]
pub async fn git_branch(repo: String) -> Result<String, String> {
    git_exec(repo, vec!["branch".to_string(), "--show-current".to_string()]).await
}

#[command]
pub async fn git_commit(repo: String, message: String, add_all: bool) -> Result<String, String> {
    if add_all {
        git_exec(repo.clone(), vec!["add".to_string(), ".".to_string()]).await?;
    }
    git_exec(repo, vec!["commit".to_string(), "-m".to_string(), message]).await
}

#[command]
pub async fn git_push(repo: String, remote: String, branch: String) -> Result<String, String> {
    git_exec(repo, vec!["push".to_string(), remote, branch]).await
}

#[command]
pub async fn git_pull(repo: String, remote: String, branch: String) -> Result<String, String> {
    git_exec(repo, vec!["pull".to_string(), remote, branch]).await
}
