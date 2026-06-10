import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Upload,
  UserRound
} from 'lucide-react';
import {
  apiHealth,
  clearPreviewCache,
  exportFile,
  loadState,
  pickFolder,
  previewPdfBlob,
  previewText,
  saveState,
  scanFolder,
  uploadRoster
} from './api';
import { cleanScore, formatDate } from './utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STATUS_OPTIONS = ['未批改', '已批改', '需复查'];
const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'todo', label: '未批改' },
  { id: 'done', label: '已批改' },
  { id: 'review', label: '需复查' },
  { id: 'duplicates', label: '重复提交' },
  { id: 'unknown', label: '名单外' }
];
const LAST_FOLDER_KEY = 'homeworkGrader.lastFolder';
const LAST_RECURSIVE_KEY = 'homeworkGrader.lastRecursive';
const PREFETCH_AHEAD = 3;
const PREFETCH_BEHIND = 1;
const MAX_BLOB_CACHE = 12;

function statusTone(status) {
  if (status === '已批改') return 'good';
  if (status === '需复查') return 'warn';
  return 'muted';
}

function shortenText(value, maxLength = 32) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  const head = Math.max(12, Math.floor((maxLength - 3) * 0.6));
  const tail = Math.max(8, maxLength - 3 - head);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function folderName(value) {
  const text = String(value || '').replace(/[\\/]+$/, '');
  if (!text) return 'FastAPI + React 原型';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || text;
}

function defaultRecord() {
  return { status: '未批改', score: '', comment: '' };
}

function PdfCanvasPreview({ url }) {
  const shellRef = useRef(null);
  const scrollRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTasksRef = useRef([]);
  const observerRef = useRef(null);
  const pageRefs = useRef([]);

  const [pageCount, setPageCount] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [pageHeights, setPageHeights] = useState([]);

  // Load PDF document once per URL
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;

    pdfDocRef.current = null;
    setBusy(true);
    setError('');
    setPageCount(0);
    setVisiblePage(1);
    setScale(1);
    setPageHeights([]);
    renderTasksRef.current.forEach((t) => t?.cancel?.());
    renderTasksRef.current = [];
    if (observerRef.current) observerRef.current.disconnect();

    async function loadDocument() {
      if (!url) return;
      try {
        loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPageCount(pdf.numPages);

        const availableWidth = Math.max(320, (shellRef.current?.clientWidth || 860) - 24);
        let maxWidth = 0;
        const heights = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          if (vp.width > maxWidth) maxWidth = vp.width;
          heights.push(vp.height);
        }
        if (!cancelled) {
          setScale(Math.min(2, Math.max(0.75, availableWidth / maxWidth)));
          setPageHeights(heights);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    loadDocument();
    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
      renderTasksRef.current.forEach((t) => t?.cancel?.());
      renderTasksRef.current = [];
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [url]);

  // Render all pages (or lazy-render for large PDFs)
  useEffect(() => {
    console.log(`[PDF] renderEffect: pdfDoc=${!!pdfDocRef.current} pageCount=${pageCount} scale=${scale} busy=${busy} url=${!!url}`);
    if (!pdfDocRef.current || pageCount === 0 || busy) { console.log('[PDF] renderEffect: SKIP'); return; }

    console.log(`[PDF] renderEffect: START rendering ${pageCount} pages`);
    renderTasksRef.current.forEach((t) => t?.cancel?.());
    renderTasksRef.current = [];

    async function renderPage(pageNum) {
      const el = pageRefs.current[pageNum - 1];
      if (!el) return;
      const canvas = el.querySelector('canvas');
      if (!canvas) return;
      try {
        const page = await pdfDocRef.current.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        console.log(`[PDF] p${pageNum} vp=${viewport.width}x${viewport.height} scale=${scale} pr=${window.devicePixelRatio}`);
        const pixelRatio = window.devicePixelRatio || 1;
        const ctx = canvas.getContext('2d');
        console.log(`[PDF] p${pageNum} ctx=${!!ctx} canvasBuf=${canvas.width}x${canvas.height}`);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        console.log(`[PDF] p${pageNum} afterResize buf=${canvas.width}x${canvas.height} css=${canvas.style.width}x${canvas.style.height}`);
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        ctx.clearRect(0, 0, viewport.width, viewport.height);
        const task = page.render({ canvasContext: ctx, viewport });
        renderTasksRef.current.push(task);
        await task.promise;
        console.log(`[PDF] p${pageNum} render done`);
      } catch (err) {
        console.error(`[PDF] p${pageNum} FAIL ${err?.name}: ${err?.message}`, err);
        if (err?.name !== 'RenderingCancelledException') {
          el.classList.add('pdf-page-error');
        }
      }
    }

    if (pageCount <= 20) {
      for (let i = 1; i <= pageCount; i++) renderPage(i);
    } else {
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const pn = Number(entry.target.dataset.page);
              if (pn) { renderPage(pn); observerRef.current?.unobserve(entry.target); }
            }
          }
        },
        { root: scrollRef.current, rootMargin: '300% 0px' },
      );
      // observe all page wrappers; first few render immediately via isIntersecting
      pageRefs.current.forEach((el) => { if (el) observerRef.current?.observe(el); });
    }

    return () => {
      renderTasksRef.current.forEach((t) => t?.cancel?.());
      renderTasksRef.current = [];
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [pageCount, scale, busy, url]);

  // Scroll → visible page tracking
  useEffect(() => {
    if (pageCount <= 1) { setVisiblePage(1); return; }
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = el.scrollTop + el.clientHeight / 2;
        let best = 1, bestDist = Infinity;
        pageRefs.current.forEach((ref, idx) => {
          if (!ref) return;
          const top = ref.offsetTop;
          const h = ref.offsetHeight;
          const dist = Math.abs(top + h / 2 - center);
          if (dist < bestDist) { bestDist = dist; best = idx + 1; }
        });
        setVisiblePage(best);
      });
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [pageCount]);

  // Keyboard: scroll-based navigation
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase?.() || '';
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;
      if (!pageCount || pageCount <= 0 || error) return;
      const scroller = scrollRef.current;
      if (!scroller) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        scroller.scrollBy({ top: 300, behavior: 'smooth' });
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        scroller.scrollBy({ top: -300, behavior: 'smooth' });
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        scroller.scrollBy({ top: scroller.clientHeight * 0.8, behavior: 'smooth' });
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        scroller.scrollBy({ top: -scroller.clientHeight * 0.8, behavior: 'smooth' });
      } else if (event.key === 'Home') {
        event.preventDefault();
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (event.key === 'End') {
        event.preventDefault();
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageCount, error]);

  const computedHeights = pageHeights.map((h) => Math.floor(h * scale));

  return (
    <div className="pdf-shell" ref={shellRef}>
      {pageCount > 1 && !error && (
        <div className="pdf-toolbar">
          <button
            className="icon-btn"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            disabled={busy}
          >
            <ArrowLeft size={14} />
          </button>
          <span className="pdf-page-info">{visiblePage} / {pageCount}</span>
          <button
            className="icon-btn"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current?.scrollHeight, behavior: 'smooth' })}
            disabled={busy}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      {error ? (
        <div className="empty-state"><CircleAlert size={28} /><h3>PDF 渲染失败</h3><p>{error}</p></div>
      ) : (
        <div className="pdf-scroll-area" ref={scrollRef}>
          {busy && pageCount === 0 && (
            <div className="pdf-loading"><Loader2 size={22} className="spin" /> 正在加载 PDF</div>
          )}
          {Array.from({ length: pageCount }, (_, i) => (
            <div
              key={i}
              className="pdf-page-wrapper"
              data-page={i + 1}
              ref={(el) => { pageRefs.current[i] = el; }}
              style={{ minHeight: computedHeights[i] || 200 }}
            >
              <canvas className="pdf-canvas" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const rosterUploadRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const blobCacheRef = useRef(new Map());
  const prefetchAbortRef = useRef(new Map());
  const [apiReady, setApiReady] = useState(false);
  const [folder, setFolder] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [scanBusy, setScanBusy] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [roster, setRoster] = useState({});
  const [records, setRecords] = useState({});
  const [selectedKey, setSelectedKey] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('请先启动 FastAPI 后端，然后扫描作业文件夹。');
  const [preview, setPreview] = useState({ state: 'idle' });
  const [previewVersion, setPreviewVersion] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState('');

  useEffect(() => {
    let mounted = true;
    let timer = null;

    async function checkBackend() {
      try {
        await apiHealth();
        if (!mounted) return;
        setApiReady(true);
        setMessage('FastAPI 后端已连接。');
      } catch {
        if (!mounted) return;
        setApiReady(false);
        setMessage('后端未连接。请运行 run_backend.bat 或 run_full_stack.bat。');
        timer = window.setTimeout(checkBackend, 2000);
      }
    }

    checkBackend();
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    try {
      const savedFolder = window.localStorage.getItem(LAST_FOLDER_KEY);
      const savedRecursive = window.localStorage.getItem(LAST_RECURSIVE_KEY);
      if (savedFolder) setFolder(savedFolder);
      if (savedRecursive !== null) setRecursive(savedRecursive === 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      if (folder) window.localStorage.setItem(LAST_FOLDER_KEY, folder);
      window.localStorage.setItem(LAST_RECURSIVE_KEY, String(recursive));
    } catch {
      // ignore storage errors
    }
  }, [folder, recursive]);

  const rosterMap = useMemo(() => new Map(Object.entries(roster)), [roster]);
  const duplicateCount = useMemo(() => {
    const counts = new Map();
    submissions.forEach((item) => counts.set(item.studentId, (counts.get(item.studentId) || 0) + 1));
    return counts;
  }, [submissions]);

  const selected = useMemo(
    () => submissions.find((item) => item.key === selectedKey) || null,
    [selectedKey, submissions],
  );
  const selectedRecord = selected ? records[selected.key] || defaultRecord() : defaultRecord();

  const summary = useMemo(() => {
    const data = { total: submissions.length, graded: 0, review: 0, pending: 0, unknown: 0 };
    submissions.forEach((item) => {
      const record = records[item.key] || defaultRecord();
      if (!rosterMap.has(item.studentId)) data.unknown += 1;
      if (record.status === '已批改') data.graded += 1;
      else if (record.status === '需复查') data.review += 1;
      else data.pending += 1;
    });
    return data;
  }, [records, rosterMap, submissions]);
  const titleText = folder ? folderName(folder) : 'FastAPI + React 原型';

  const visibleSubmissions = useMemo(() => {
    const text = query.trim().toLowerCase();
    return submissions.filter((item) => {
      const record = records[item.key] || defaultRecord();
      const duplicate = (duplicateCount.get(item.studentId) || 0) > 1;
      let ok = true;
      if (filter === 'todo') ok = record.status === '未批改';
      if (filter === 'done') ok = record.status === '已批改';
      if (filter === 'review') ok = record.status === '需复查';
      if (filter === 'duplicates') ok = duplicate;
      if (filter === 'unknown') ok = !rosterMap.has(item.studentId);
      if (text) {
        ok =
          ok &&
          [item.studentId, item.displayPath, rosterMap.get(item.studentId), record.score, record.comment]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(text);
      }
      return ok;
    });
  }, [duplicateCount, filter, query, records, rosterMap, submissions]);

  const selectedIndex = useMemo(
    () => visibleSubmissions.findIndex((item) => item.key === selectedKey),
    [selectedKey, visibleSubmissions],
  );

  const missingRoster = useMemo(() => {
    const submitted = new Set(submissions.map((item) => item.studentId));
    return Object.entries(roster).filter(([sid]) => !submitted.has(sid));
  }, [roster, submissions]);

  useEffect(() => {
    if (!selected) {
      setPreview({ state: 'idle' });
      // cancel all in-flight prefetches when selection clears
      for (const [key, ctrl] of prefetchAbortRef.current) {
        ctrl.abort();
        prefetchAbortRef.current.delete(key);
      }
      return undefined;
    }
    let cancelled = false;
    let objectUrl = '';

    async function loadPreview() {
      // cancel stale prefetches from previous selection
      for (const [key, ctrl] of prefetchAbortRef.current) {
        ctrl.abort();
        prefetchAbortRef.current.delete(key);
      }

      setPreview({ state: 'loading' });
      try {
        if (selected.ext === '.pdf' || selected.ext === '.docx' || selected.ext === '.doc') {
          try {
            // check cache first
            const cached = blobCacheRef.current.get(selected.key);
            let blob;
            if (cached) {
              cached.timestamp = Date.now();
              blob = cached.blob;
            } else {
              blob = await previewPdfBlob(selected.path, folder);
            }

            if (cancelled) return;
            if (!cached) {
              blobCacheRef.current.set(selected.key, { blob, timestamp: Date.now() });
              evictBlobCache();
            }
            objectUrl = URL.createObjectURL(blob);
            setPreview({ state: 'pdf', url: objectUrl, note: selected.ext === '.pdf' ? 'PDF 预览' : 'Word 转 PDF 预览' });
            // preload neighbors
            if (!cancelled) {
              const idx = visibleSubmissions.findIndex((s) => s.key === selected.key);
              if (idx >= 0) prefetchNeighbors(idx, visibleSubmissions);
            }
            return;
          } catch (pdfError) {
            if (selected.ext === '.pdf') throw pdfError;
            if (cancelled) return;
            setPreview({
              state: 'word-pdf-error',
              text: pdfError?.message || String(pdfError),
              note: 'Word 转 PDF 失败'
            });
            return;
          }
        }
        const data = await previewText(selected.path, folder);
        if (cancelled) return;
        setPreview({ state: 'text', text: data.text, note: '文本预览' });
      } catch (error) {
        if (cancelled) return;
        setPreview({ state: 'error', text: error?.message || String(error) });
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [folder, previewVersion, selected]);

  function evictBlobCache() {
    const cache = blobCacheRef.current;
    if (cache.size <= MAX_BLOB_CACHE) return;
    const entries = [...cache.entries()]
      .map(([key, val]) => ({ key, timestamp: val.timestamp }))
      .sort((a, b) => a.timestamp - b.timestamp);
    const remove = entries.slice(0, entries.length - MAX_BLOB_CACHE);
    for (const { key } of remove) {
      cache.delete(key);
    }
  }

  async function prefetchOne(item) {
    if (blobCacheRef.current.has(item.key)) return;
    if (!['.pdf', '.docx', '.doc'].includes(item.ext)) return;
    const controller = new AbortController();
    prefetchAbortRef.current.set(item.key, controller);
    try {
      const blob = await previewPdfBlob(item.path, folder, controller.signal);
      blobCacheRef.current.set(item.key, { blob, timestamp: Date.now() });
      evictBlobCache();
    } catch {
      // silent — prefetch is best-effort
    } finally {
      prefetchAbortRef.current.delete(item.key);
    }
  }

  function prefetchNeighbors(currentIndex, list) {
    const start = Math.max(0, currentIndex - PREFETCH_BEHIND);
    const end = Math.min(list.length, currentIndex + PREFETCH_AHEAD + 1);
    const targets = list.slice(start, end).filter((item) => {
      if (item.key === list[currentIndex]?.key) return false;
      if (blobCacheRef.current.has(item.key)) return false;
      return ['.pdf', '.docx', '.doc'].includes(item.ext);
    });
    const ranked = targets
      .map((item) => ({ item, dist: Math.abs(list.findIndex((s) => s.key === item.key) - currentIndex) }))
      .sort((a, b) => a.dist - b.dist);
    for (const { item } of ranked) {
      prefetchOne(item);
    }
  }

  async function loadPlainTextFallback() {
    if (!selected) return;
    setPreview({ state: 'loading' });
    try {
      const data = await previewText(selected.path, folder);
      setPreview({ state: 'text', text: data.text, note: '纯文本预览' });
    } catch (error) {
      setPreview({ state: 'error', text: error?.message || String(error) });
    }
  }

  function payload(recordsOverride = records) {
    return { folder, recursive, roster, records: recordsOverride };
  }

  async function handleScan(targetFolder = folder) {
    const scanTarget = String(targetFolder || '').trim();
    if (!scanTarget) {
      window.alert('请先输入作业文件夹路径。');
      return;
    }
    try {
      setScanBusy(true);
      setFolder(scanTarget);
      const result = await scanFolder(scanTarget, recursive);
      setSubmissions(result.submissions);
      setSelectedKey(result.submissions[0]?.key || '');
      setRecords((current) => {
        const next = { ...current };
        result.submissions.forEach((item) => {
          if (!next[item.key]) next[item.key] = defaultRecord();
        });
        return next;
      });
      try {
        const state = await loadState(scanTarget);
        if (state.exists && state.state) {
          setRoster(state.state.roster || {});
          setRecords((current) => ({ ...current, ...(state.state.records || {}) }));
          setRecursive(Boolean(state.state.recursive));
          setMessage(`已扫描 ${result.submissions.length} 个提交，并载入已有进度。`);
        } else {
          setMessage(`已扫描 ${result.submissions.length} 个提交。`);
        }
      } catch {
        setMessage(`已扫描 ${result.submissions.length} 个提交。`);
      }
    } catch (error) {
      window.alert(error?.message || String(error));
    } finally {
      setScanBusy(false);
    }
  }

  async function requestScanFolder() {
    try {
      const result = await pickFolder();
      if (!result.folder) return;
      await handleScan(result.folder);
    } catch (error) {
      window.alert(error?.message || String(error));
    }
  }

  async function handleRosterUpload(file) {
    if (!file) return;
    try {
      const result = await uploadRoster(file);
      const replace = window.confirm('点击“确定”替换现有名单，点击“取消”合并名单。');
      setRoster((current) => (replace ? result.roster : { ...current, ...result.roster }));
      setMessage(`已上传并解析名单 ${result.count} 人。`);
    } catch (error) {
      window.alert(error?.message || String(error));
    }
  }

  function updateRecord(key, patch) {
    if (!key) return;
    setRecords((current) => ({
      ...current,
      [key]: { ...defaultRecord(), ...(current[key] || {}), ...patch }
    }));
  }

  async function persistState(showAlert = false, recordsOverride = records, options = {}) {
    try {
      const result = await saveState(payload(recordsOverride));
      setLastSavedAt(formatDate(Date.now()));
      if (!options.silent) {
        setMessage(`批改进度已保存：${result.path}`);
        if (showAlert) window.alert('批改进度已保存。');
      }
      return result;
    } catch (error) {
      window.alert(error?.message || String(error));
      throw error;
    }
  }

  async function saveAndNext() {
    if (!selected) return;
    const nextRecords = {
      ...records,
      [selected.key]: {
        ...defaultRecord(),
        ...(records[selected.key] || {}),
        status: '已批改',
        score: cleanScore(selectedRecord.score)
      }
    };
    setRecords(nextRecords);
    const next = visibleSubmissions[Math.min(selectedIndex + 1, visibleSubmissions.length - 1)];
    if (next) setSelectedKey(next.key);
    await persistState(false, nextRecords);
  }

  async function handleExport(kind) {
    try {
      await exportFile(kind, payload());
      setMessage(kind === 'xlsx' ? 'Excel 已导出。' : 'CSV 已导出。');
    } catch (error) {
      window.alert(error?.message || String(error));
    }
  }

  async function handleClearPreviewCache() {
    if (!folder) return;
    try {
      await clearPreviewCache(folder);
      setPreviewVersion((value) => value + 1);
      setMessage('预览缓存已清除。');
      if (selected) {
        setPreview({ state: 'loading' });
      }
    } catch (error) {
      window.alert(error?.message || String(error));
    }
  }

  function moveSelection(offset) {
    if (!visibleSubmissions.length) return;
    const next = visibleSubmissions[Math.max(0, Math.min(visibleSubmissions.length - 1, selectedIndex + offset))];
    if (next) setSelectedKey(next.key);
  }

  useEffect(() => {
    function handleKeyDown(event) {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase?.() || '';
      const editable = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable;
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (folder) persistState(true);
        return;
      }
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        if (selected) saveAndNext();
        return;
      }
      if (editable) return;
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        moveSelection(-1);
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        moveSelection(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [folder, moveSelection, persistState, saveAndNext, selected]);

  useEffect(() => {
    if (!folder || !submissions.length || scanBusy) return undefined;
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      persistState(false, records, { silent: true }).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(autoSaveTimerRef.current);
  }, [folder, records, recursive, roster, scanBusy, submissions.length]);

  useEffect(
    () => () => {
      window.clearTimeout(autoSaveTimerRef.current);
    },
    [],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <div className="eyebrow">作业批改工作台</div>
            <h1 title={folder || ''}>{titleText}</h1>
          </div>
          <div className="topbar-actions">
            <button className="action-btn" onClick={requestScanFolder} disabled={!apiReady}>
              <FolderOpen size={16} /> 扫描文件夹
            </button>
            <button className="action-btn" onClick={() => rosterUploadRef.current?.click()} disabled={!apiReady}>
              <Upload size={16} /> 上传名单
            </button>
            <button className="action-btn" onClick={() => handleExport('csv')} disabled={!folder}>
              <Download size={16} /> 导出 CSV
            </button>
            <button className="action-btn" onClick={() => handleExport('xlsx')} disabled={!folder}>
              <FileSpreadsheet size={16} /> 导出 Excel
            </button>
          </div>
        </div>
        <div className="summary-band topbar-summary">
          <div className="summary-cell"><span>后端</span><strong>{apiReady ? '已连接' : '未连接'}</strong></div>
          <div className="summary-cell"><span>提交</span><strong>{summary.total}</strong></div>
          <div className="summary-cell"><span>已批改</span><strong>{summary.graded}</strong></div>
          <div className="summary-cell"><span>需复查</span><strong>{summary.review}</strong></div>
          <div className="summary-cell"><span>名单外</span><strong>{summary.unknown}</strong></div>
          <label className="toggle">
            <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
            <span>递归扫描子文件夹</span>
          </label>
        </div>
      </header>

      <section className="toolbar-row">
        <div className="filters">
          {FILTERS.map((item) => (
            <button key={item.id} className={`chip ${filter === item.id ? 'active' : ''}`} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="searchbox">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、文件名、评语" />
        </div>
      </section>

      <main className="workspace">
        <aside className="sidebar">
          <div className="panel-head">
            <div><h2>提交列表</h2><span>{visibleSubmissions.length} 项</span></div>
            <button className="ghost-btn" onClick={() => handleScan()} disabled={!folder}><RefreshCw size={14} /> 刷新</button>
          </div>
          <div className="submission-list">
            {visibleSubmissions.map((item) => {
              const record = records[item.key] || defaultRecord();
              const duplicate = duplicateCount.get(item.studentId) || 0;
              return (
                <button
                  key={item.key}
                  className={`submission-row ${selectedKey === item.key ? 'selected' : ''}`}
                  onClick={() => setSelectedKey(item.key)}
                  title={item.path}
                >
                  <div className="row-top">
                    <div className="sid">{item.studentId}</div>
                    <span className={`status-pill ${statusTone(record.status)}`}>{record.status}</span>
                  </div>
                  <div className="row-mid">
                    <span className="name">{rosterMap.get(item.studentId) || '名单外'}</span>
                    <span className="filetype">{item.ext.replace('.', '').toUpperCase()}</span>
                  </div>
                  <div className="row-bottom">
                    <span className="filename" title={item.displayPath}>{shortenText(item.displayPath)}</span>
                    {duplicate > 1 ? <span className="dup">重复 x{duplicate}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="roster-box">
            <div className="panel-head compact">
              <div><h2>名单概览</h2><span>{Object.keys(roster).length} 人</span></div>
              <span className="ghost-tag">{missingRoster.length} 未交</span>
            </div>
            <div className="roster-preview">
              {missingRoster.map(([sid, name]) => (
                <div key={sid} className="roster-row">
                  <UserRound size={14} />
                  <span className="roster-sid">{sid}</span>
                  <strong>{name || '未命名'}</strong>
                  <span className="missing-tag">未交</span>
                </div>
              ))}
              {!missingRoster.length ? <div className="empty-inline">名单覆盖完整。</div> : null}
            </div>
          </div>
        </aside>

        <section className="preview-panel">
          <div className="panel-head">
            <div><h2>预览</h2><span>{selected ? selected.displayPath : '未选择文件'}</span></div>
            <div className="preview-actions">
              <button className="ghost-btn" onClick={() => moveSelection(-1)}><ArrowLeft size={14} /> 上一份</button>
              <button className="ghost-btn" onClick={() => moveSelection(1)}><ArrowRight size={14} /> 下一份</button>
              <button className="ghost-btn" onClick={handleClearPreviewCache} disabled={!folder}><RefreshCw size={14} /> 清缓存</button>
            </div>
          </div>
          <div className="preview-stage">
            {!selected ? (
              <div className="empty-state"><BookOpen size={28} /><h3>请选择一份提交</h3><p>PDF、TXT、Word 文本和 Word 转 PDF 会显示在这里。</p></div>
            ) : preview.state === 'loading' ? (
              <div className="empty-state"><Loader2 size={28} className="spin" /><h3>正在加载预览</h3><p>{selected.displayPath}</p></div>
            ) : preview.state === 'pdf' ? (
              <PdfCanvasPreview url={preview.url} />
            ) : preview.state === 'text' ? (
              <pre className="text-preview">{preview.text}</pre>
            ) : preview.state === 'word-pdf-error' ? (
              <div className="empty-state">
                <CircleAlert size={28} />
                <h3>Word 排版预览失败</h3>
                <p>{preview.text}</p>
                <button className="ghost-btn" onClick={loadPlainTextFallback}>查看纯文本</button>
              </div>
            ) : preview.state === 'error' ? (
              <div className="empty-state"><CircleAlert size={28} /><h3>预览失败</h3><p>{preview.text}</p></div>
            ) : (
              <div className="empty-state"><BookOpen size={28} /><h3>请选择一份提交</h3><p>这里会显示预览。</p></div>
            )}
          </div>
        </section>

        <aside className="grading-panel">
          <div className="panel-head"><div><h2>批改信息</h2><span>当前记录</span></div></div>
          <div className="form-grid">
            <label><span>学号</span><div className="input-like">{selected?.studentId || '-'}</div></label>
            <label><span>姓名</span><div className="input-like">{rosterMap.get(selected?.studentId || '') || '未匹配'}</div></label>
            <label>
              <span>分数</span>
              <input disabled={!selected} value={selectedRecord.score} onChange={(event) => updateRecord(selected?.key, { score: cleanScore(event.target.value) })} placeholder="例如 95" />
            </label>
            <label>
              <span>状态</span>
              <select disabled={!selected} value={selectedRecord.status} onChange={(event) => updateRecord(selected?.key, { status: event.target.value })}>
                {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="full">
              <span>评语</span>
              <textarea rows="7" disabled={!selected} value={selectedRecord.comment} onChange={(event) => updateRecord(selected?.key, { comment: event.target.value })} placeholder="可填写评语，也可以留空。" />
            </label>
          </div>
          <div className="button-stack">
            <button className="primary-btn" onClick={() => persistState(true)} disabled={!folder}><CheckCircle2 size={16} /> 保存当前批改</button>
            <button className="primary-btn alt" onClick={saveAndNext} disabled={!selected}><PencilLine size={16} /> 标记已批改并下一份</button>
          </div>
          <div className="info-list">
            <div><strong>最后保存：</strong>{lastSavedAt || '尚未保存'}</div>
            <div><strong>导出规则：</strong>同学号多份提交只保留 1 行。</div>
          </div>
        </aside>
      </main>

      <input ref={rosterUploadRef} type="file" hidden accept=".xlsx,.csv,.txt" onChange={(event) => handleRosterUpload(event.target.files?.[0])} />
    </div>
  );
}

export default App;
