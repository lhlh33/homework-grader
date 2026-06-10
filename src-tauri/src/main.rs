use std::future::pending;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri_plugin_shell::ShellExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static BACKEND_PID: Mutex<Option<u32>> = Mutex::new(None);

fn store_backend_pid(pid: u32) {
    *BACKEND_PID.lock().unwrap() = Some(pid);
}

fn kill_backend() {
    if let Ok(mut guard) = BACKEND_PID.lock() {
        if let Some(pid) = *guard {
            kill_process(pid);
        }
        *guard = None;
    }
}

#[cfg(windows)]
fn kill_process(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

#[cfg(not(windows))]
fn kill_process(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).spawn();
}

fn backend_ready() -> bool {
    ("127.0.0.1", 8765)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(120)).ok())
        .is_some()
}

fn wait_for_backend() {
    for _ in 0..80 {
        if backend_ready() {
            return;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn app_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
}

fn project_root(root: &PathBuf) -> bool {
    root.join("backend").join("app.py").exists() || root.join("package.json").exists()
}

fn command_for_backend(root: &PathBuf) -> Option<Command> {
    let sibling_backend = root.join("HomeworkGraderBackend.exe");
    if sibling_backend.exists() {
        return Some(Command::new(sibling_backend));
    }

    let triple_backend = root.join(format!(
        "HomeworkGraderBackend-{}-pc-windows-msvc.exe",
        std::env::consts::ARCH
    ));
    if triple_backend.exists() {
        return Some(Command::new(triple_backend));
    }

    let sibling_backend_dir = root
        .join("HomeworkGraderBackend")
        .join("HomeworkGraderBackend.exe");
    if sibling_backend_dir.exists() {
        return Some(Command::new(sibling_backend_dir));
    }

    let dist_backend_file = root.join("dist_exe").join("HomeworkGraderBackend.exe");
    if dist_backend_file.exists() {
        return Some(Command::new(dist_backend_file));
    }

    let dist_backend = root
        .join("dist_exe")
        .join("HomeworkGraderBackend")
        .join("HomeworkGraderBackend.exe");
    if dist_backend.exists() {
        return Some(Command::new(dist_backend));
    }

    if project_root(root) {
        let mut py = Command::new("py");
        py.args([
            "-m",
            "uvicorn",
            "backend.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ]);
        return Some(py);
    }

    None
}

fn spawn_std_command(mut command: Command, cwd: Option<&PathBuf>) -> bool {
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    if let Ok(child) = command.spawn() {
        store_backend_pid(child.id());
        tauri::async_runtime::spawn(async move {
            let _child = child;
            pending::<()>().await;
        });
        return true;
    }

    false
}

fn start_sidecar_backend(app: &tauri::AppHandle) -> bool {
    let Ok(command) = app.shell().sidecar("HomeworkGraderBackend") else {
        return false;
    };

    let Ok((_rx, child)) = command.spawn() else {
        return false;
    };

    store_backend_pid(child.pid());
    tauri::async_runtime::spawn(async move {
        let _child = child;
        pending::<()>().await;
    });
    true
}

fn start_backend(app: &tauri::AppHandle) {
    if backend_ready() {
        return;
    }

    let mut saw_project_root = false;
    for root in app_roots() {
        if project_root(&root) {
            saw_project_root = true;
        }

        let Some(command) = command_for_backend(&root) else {
            continue;
        };

        if spawn_std_command(command, Some(&root)) {
            wait_for_backend();
            return;
        }
    }

    if !saw_project_root && start_sidecar_backend(app) {
        wait_for_backend();
        return;
    }

    wait_for_backend();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            start_backend(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_backend();
        }
    });
}
