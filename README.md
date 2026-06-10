# Homework Grader Prototype

## Run

Current packaged exe path:

```bat
build_exe.bat
```

```bat
run_full_stack.bat
```

Or run separately:

```bat
run_backend.bat
npm run dev
```

Tauri desktop shell:

```bat
run_tauri_dev.bat
```

Tauri release build:

```bat
build_tauri_release.bat
```

Backend sidecar for Tauri packaging:

```bat
build_backend_exe.bat
```

Portable Tauri package:

```text
dist_tauri\HomeworkGraderDesktop_portable.zip
```

## What is included

- FastAPI backend for scan, roster, save, export, and preview APIs
- React front-end that calls the backend
- PDF and Word preview phases
- Tauri desktop shell in parallel with the existing packaged exe path
- Current PyInstaller exe path is kept as-is while Tauri migration proceeds
- Tauri portable package includes the desktop exe plus backend sidecar
