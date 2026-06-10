const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8765';

function isTauri() {
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function formatApiError(detail, fallback) {
  if (Array.isArray(detail)) {
    const lines = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item);
        const loc = Array.isArray(item.loc) ? item.loc.join('.') : item.loc;
        const message = item.msg || item.message || item.detail || JSON.stringify(item);
        return loc ? `${loc}: ${message}` : message;
      })
      .filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  if (detail && typeof detail === 'object') {
    if (detail.message) return String(detail.message);
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }
  if (detail !== undefined && detail !== null && detail !== '') return String(detail);
  return fallback;
}

async function readErrorMessage(response) {
  let message = `HTTP ${response.status}`;
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return formatApiError(data?.detail ?? data?.message ?? data, message);
    }
    const text = await response.text();
    return formatApiError(text, message);
  } catch {
    return message;
  }
}

async function parseResponse(response) {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json();
  return response;
}

function networkError(error) {
  if (error?.message === 'Failed to fetch') {
    return new Error('无法连接 FastAPI 后端。请确认 run_backend.bat 正在运行，且 http://127.0.0.1:8765/api/health 可以打开。');
  }
  return error;
}

export async function apiHealth() {
  try {
    return await parseResponse(await fetch(`${API_BASE}/api/health`));
  } catch (error) {
    throw networkError(error);
  }
}

export async function scanFolder(folder, recursive) {
  try {
    return await parseResponse(
      await fetch(`${API_BASE}/api/folders/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, recursive })
      }),
    );
  } catch (error) {
    throw networkError(error);
  }
}

export async function clearPreviewCache(folder) {
  try {
    return await parseResponse(
      await fetch(`${API_BASE}/api/cache/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, recursive: true })
      }),
    );
  } catch (error) {
    throw networkError(error);
  }
}

export async function pickFolder() {
  try {
    return await parseResponse(
      await fetch(`${API_BASE}/api/folders/pick`, {
        method: 'POST'
      }),
    );
  } catch (error) {
    throw networkError(error);
  }
}

export async function importRosterByPath(path, existing, mode) {
  return parseResponse(
    await fetch(`${API_BASE}/api/roster/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, existing, mode })
    }),
  );
}

export async function uploadRoster(file) {
  const form = new FormData();
  form.append('file', file);
  return parseResponse(
    await fetch(`${API_BASE}/api/roster/upload`, {
      method: 'POST',
      body: form
    }),
  );
}

export async function saveState(payload) {
  return parseResponse(
    await fetch(`${API_BASE}/api/state/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
  );
}

export async function loadState(folder) {
  return parseResponse(await fetch(`${API_BASE}/api/state/load?folder=${encodeURIComponent(folder)}`));
}

export async function previewText(path, folder) {
  return parseResponse(
    await fetch(`${API_BASE}/api/preview/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, folder })
    }),
  );
}

export async function previewPdfBlob(path, folder, signal) {
  const response = await fetch(`${API_BASE}/api/preview/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, folder }),
    signal
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.blob();
}

export async function exportFile(kind, payload) {
  // Step 1: let backend generate the file and return a one-time download token
  const prepareResponse = await fetch(`${API_BASE}/api/export/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, kind })
  });
  if (!prepareResponse.ok) {
    throw new Error(await readErrorMessage(prepareResponse));
  }
  const { token } = await prepareResponse.json();
  const downloadUrl = `${API_BASE}/api/export/download/${token}`;

  // Step 2: open in system browser — Tauri's open() avoids webview interception.
  // Falls back to window.open for plain-browser dev mode.
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(downloadUrl);
  } else {
    window.open(downloadUrl, '_blank');
  }
}
