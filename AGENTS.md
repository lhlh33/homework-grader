# AGENTS.md — Homework Grader Desktop

## Project Overview

A local desktop application for batch grading homework submissions. Teachers scan a folder containing student homework files (PDF, Word, TXT), preview them with built-in rendering, assign scores and comments, then export grades to CSV or Excel.

**Tech Stack**: React 19 + Vite 7 (frontend), FastAPI + Uvicorn (backend), Tauri v2 (desktop shell), PyInstaller (backend sidecar), PDF.js (PDF rendering), win32com/LibreOffice (Word→PDF conversion).

**GitHub**: `https://github.com/lhlh33/homework-grader` (branch: `master`)

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Tauri Desktop Shell (src-tauri/)                │
│  ┌────────────┐  ┌─────────────────────────────┐ │
│  │ main.rs    │  │ WebView (React SPA)          │ │
│  │ auto-start │  │ origin: http://tauri.        │ │
│  │ backend    │  │        localhost             │ │
│  └────────────┘  └──────────┬──────────────────┘ │
│                             │ HTTP fetch          │
└─────────────────────────────┼────────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │ FastAPI Backend                 │
              │ http://127.0.0.1:8765          │
              │                                │
              │ Word→PDF: win32com / LibreOffice│
              │ PDF preview: direct FileResponse│
              │ Text preview: python-docx       │
              │ Export: local CSV/XLSX files    │
              │ Folder picker: PowerShell (Win) │
              └────────────────────────────────┘
```

- Frontend communicates with backend via `fetch()` to `127.0.0.1:8765`
- Backend runs as a sidecar process (PyInstaller `--onefile --noconsole` exe)
- Tauri Rust code auto-starts the backend and kills it on exit
- Frontend uses Tauri shell `open()` for downloads (bypasses WebView2 blob URL issues)

---

## Key Files

### Frontend (`src/`)

| File | Purpose |
|------|---------|
| `App.jsx` | Main component: sidebar, preview panel, grading panel, keyboard shortcuts, state management |
| `api.js` | All API calls to the backend, Tauri detection, export download logic |
| `styles.css` | All application styles (no CSS framework) |
| `utils.js` | `cleanScore()`, `formatDate()` helpers |

### `App.jsx` — Important Components

- **`App`** — Top-level component. Manages `submissions`, `records`, `roster`, `selected`, `preview` state. Handles auto-save, keyboard shortcuts (`Ctrl+S` save, `Ctrl+Enter` mark graded & next, `Alt+←/→` navigate submissions).
- **`PdfCanvasPreview({ url })`** — Full-page scroll PDF renderer. Loads PDF via PDF.js, renders ALL pages as stacked canvases in a scrollable container. Uses `IntersectionObserver` for lazy rendering when page count > 20. Tracks current visible page via scroll position. Keyboard: `↑↓/←→` scroll, `PgUp/PgDn` scroll, `Home/End` jump.
- **`previewCacheRef`** — In-memory blob cache (Map) for preloading neighboring submissions (±1 behind, +3 ahead). Checked before fetch to provide instant preview on cache hit.

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `app.py` | FastAPI app — all API endpoints, file operations, Word-to-PDF conversion |
| `requirements.txt` | Python dependencies |

### Backend API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Backend health check |
| POST | `/api/folders/pick` | Open native folder picker dialog |
| POST | `/api/folders/scan` | Scan folder for homework files |
| POST | `/api/roster/upload` | Upload roster file (CSV/XLSX/TXT) |
| POST | `/api/state/save` | Save grading progress |
| GET | `/api/state/load` | Load grading progress |
| POST | `/api/preview/text` | Extract text from TXT/DOCX |
| POST | `/api/preview/pdf` | Return PDF file (or convert DOCX→PDF) |
| POST | `/api/export/prepare` | Generate export file, return download token |
| GET | `/api/export/download/{token}` | Download generated export file |
| POST | `/api/export/csv` | Legacy: direct CSV export |
| POST | `/api/export/xlsx` | Legacy: direct XLSX export |
| POST | `/api/cache/clear` | Clear preview cache |

### Tauri Shell (`src-tauri/`)

| File | Purpose |
|------|---------|
| `src/main.rs` | Rust entry: starts backend, manages PID, kills on exit |
| `Cargo.toml` | Rust dependencies: `tauri`, `tauri-plugin-shell` |
| `tauri.conf.json` | Tauri config: CSP, window size, bundle settings, sidecar `externalBin` |
| `capabilities/default.json` | Permissions: `core:default`, `shell:allow-open` |
| `icons/icon.ico` | Application icon |

### Build Scripts

| File | Purpose |
|------|---------|
| `build_backend_sidecar.bat` | Build backend exe (PyInstaller) and copy to `src-tauri/binaries/` |
| `build_tauri_release.bat` | Full Tauri NSIS release build |
| `run_tauri_dev.bat` | Tauri dev mode |
| `run_full_stack.bat` | Run backend + frontend dev server (browser mode) |

---

## Build & Run

### Development (Browser mode)
```bash
run_full_stack.bat          # starts backend + Vite dev server
# OR separately:
run_backend.bat             # starts FastAPI on :8765
npm run dev                 # starts Vite on :5173
```

### Development (Tauri mode with DevTools)
```bash
run_tauri_dev.bat           # or: npx tauri dev
# In the Tauri window: F12 → Console tab
```

### Production Build (NSIS installer)
```bash
# 1. Build backend sidecar first (or reuse existing):
build_backend_sidecar.bat

# 2. Build NSIS installer:
build_tauri_release.bat
# Output: src-tauri/target/release/bundle/nsis/Homework Grader Desktop_0.1.0_x64-setup.exe
```

**Note**: When building from the git bash shell, the batch scripts may fail with encoding issues on Chinese paths. Workaround: temporarily change `beforeBuildCommand` in `tauri.conf.json` to `"npm run build"` (skip the sidecar build step if the binary already exists in `src-tauri/binaries/`).

---

## Important Implementation Details & Gotchas

### CSP (Content Security Policy)
- `connect-src` MUST include `blob:` and `'self'` — PDF.js uses `fetch()` to load blob URLs
- `worker-src` MUST include `blob:` — PDF.js creates web workers from blob URLs
- Missing `blob:` in `connect-src` causes "Unexpected server response (0)" in production builds
- **Set in**: `src-tauri/tauri.conf.json` → `app.security.csp`

### Export Downloads
- Cannot use `<a download>.click()` in Tauri WebView2 — loses user gesture after `await`, blob URL navigation silently blocked
- **Fix**: Two-step backend flow (`POST /api/export/prepare` → token → `GET /api/export/download/{token}`) + `@tauri-apps/plugin-shell` `open()` to trigger system browser download
- In browser dev mode, falls back to `window.open()`

### PDF Rendering
- **DO NOT** call `loadingTask.destroy()` before rendering pages — kills the PDF.js worker needed for `getPage()`
- Only destroy `loadingTask` in the effect cleanup (component unmount or URL change)
- All pages rendered as stacked canvases; lazy rendering via `IntersectionObserver` for >20 pages

### Backend Process Management
- `command_for_backend()` checks for sidecar binary with target-triple suffix (`HomeworkGraderBackend-x86_64-pc-windows-msvc.exe`)
- Backend PID stored in global `Mutex`, killed via `taskkill /F /T /PID` on app exit
- `CREATE_NO_WINDOW` flag suppresses console windows

### Folder Picker
- Uses PowerShell `System.Windows.Forms.FolderBrowserDialog` on Windows
- PowerShell path: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` (absolute path avoids `[WinError 2]` when PATH is restricted in PyInstaller `--noconsole` environment)

### Student ID Extraction
- `extract_student_id()` traverses every path component (not just the filename)
- Strategy: pick the **longest** numeric match across all directory/file names
- Supports folder-name-based organization (e.g., `2024010001_张三/实验报告.docx`)
- Handles both prefix numbers and inline ≥4-digit numbers

### Word → PDF Conversion
- Tries LibreOffice first (`soffice --headless`), then Microsoft Word COM (`win32com`)
- Cached in `.grader_preview_cache/` under the scanned folder

### File Path Handling
- `clean_text()` strips surrogate characters (common with CJK filenames on Windows)
- `safe_basename()` normalizes path separators

### Vite Build
- PDF.js worker imported via `?url` suffix: `import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'`
- Worker file bundled as separate asset in `/dist/assets/`

---

## Known Issues Fixed

| Issue | Root Cause | Fix Commit |
|-------|-----------|------------|
| Word→PDF rendering "Unexpected server response (0)" | CSP `connect-src` missing `blob:` | `tauri.conf.json` CSP fix |
| Export CSV/XLSX no response in Tauri | `window.open` intercepted by webview; replaced with Tauri shell `open()` | `api.js` + backend endpoints |
| Export download shows "not found" | `window.open` treated as internal Tauri route | `@tauri-apps/plugin-shell` `open()` |
| Black console window on startup | Sidecar spawned via tauri-plugin-shell without `CREATE_NO_WINDOW` | Added target-triple name check in `command_for_backend()` |
| Backend process remains after close | Child process not killed on exit | `BACKEND_PID` + `kill_backend()` on `RunEvent::Exit` |
| Folder picker `[WinError 2]` on other devices | `powershell` not found in PyInstaller PATH | Absolute path to `powershell.exe` |
| Student ID from folder name not recognized | `extract_student_id()` only looked at basename | Traverse all path components, longest match |
| PDF content blank after scroll rendering | `loadingTask.destroy()` in finally block killed worker | Moved destroy to effect cleanup |

---

## Git Workflow

```bash
git add -A
git commit -m "type: description"
git push
```

**Commit types**: `feat:` (feature), `fix:` (bug fix), `refactor:`, `style:`, `chore:`

Files NOT tracked (`.gitignore`): `node_modules/`, `src-tauri/target/`, `dist*/`, `build_*/`, `*.log`, `__pycache__/`, `src-tauri/binaries/`, `.vite-cache/`
