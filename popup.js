// Cinder — popup logic
// Counts tabs/windows and exports all open tabs to Markdown.

(function () {
  'use strict';

  const tabCountEl = document.getElementById('tab-count');
  const windowCountEl = document.getElementById('window-count');
  const tabLabelEl = document.getElementById('tab-label');
  const windowLabelEl = document.getElementById('window-label');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const fileInput = document.getElementById('file-input');
  const previewEl = document.getElementById('preview');
  const previewSummaryEl = document.getElementById('preview-summary');
  const mergeWindowsEl = document.getElementById('merge-windows');
  const restoreBtn = document.getElementById('restore-btn');
  const cancelImportBtn = document.getElementById('cancel-import-btn');
  const statusEl = document.getElementById('status');

  // Holds the most recently parsed import payload until the user confirms or cancels.
  let pendingImport = null;

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatTimestampHuman(date) {
    return (
      date.getFullYear() +
      '-' + pad(date.getMonth() + 1) +
      '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) +
      ':' + pad(date.getMinutes()) +
      ':' + pad(date.getSeconds())
    );
  }

  function formatTimestampFilename(date) {
    // Short DD-MM-YYYY for filenames — readable at a glance, sortable enough
    // for week-scale work, and lets multiple same-day exports get Chrome's
    // automatic " (1)" / " (2)" suffix which is intuitive for users.
    return pad(date.getDate()) + '-' + pad(date.getMonth() + 1) + '-' + date.getFullYear();
  }

  function escapeMdLinkText(text) {
    if (!text) return '(untitled)';
    // Escape characters that would break a markdown link label.
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/[\r\n]+/g, ' ')
      .trim() || '(untitled)';
  }

  function escapeMdUrl(url) {
    if (!url) return '';
    return String(url).replace(/\)/g, '%29').replace(/\(/g, '%28');
  }

  function queryAllTabs() {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.query({}, (tabs) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          resolve(tabs || []);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function getLastFocusedWindowId() {
    return new Promise((resolve) => {
      try {
        chrome.windows.getLastFocused({}, (win) => {
          if (chrome.runtime.lastError || !win) return resolve(null);
          resolve(win.id);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function groupByWindow(tabs) {
    const map = new Map();
    for (const tab of tabs) {
      const wid = tab.windowId;
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid).push(tab);
    }
    // Stable order by windowId, then by tab.index inside each window.
    const ordered = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    for (const [, list] of ordered) {
      list.sort((a, b) => (a.index || 0) - (b.index || 0));
    }
    return ordered;
  }

  async function refreshCounts() {
    try {
      const tabs = await queryAllTabs();
      const windows = new Set(tabs.map((t) => t.windowId));
      tabCountEl.textContent = String(tabs.length);
      windowCountEl.textContent = String(windows.size);
      if (tabLabelEl) tabLabelEl.textContent = tabs.length === 1 ? 'tab' : 'tabs';
      if (windowLabelEl) windowLabelEl.textContent = windows.size === 1 ? 'window' : 'windows';
      exportBtn.disabled = tabs.length === 0;
    } catch (e) {
      tabCountEl.textContent = '--';
      windowCountEl.textContent = '--';
      setStatus('Error: ' + e.message, 'err');
    }
  }

  function buildMarkdown(tabs, focusedWindowId, now) {
    const grouped = groupByWindow(tabs);
    const lines = [];
    lines.push('# Tabs export — ' + formatTimestampHuman(now));
    lines.push('');
    const tabWord = tabs.length === 1 ? 'tab' : 'tabs';
    const winWord = grouped.length === 1 ? 'window' : 'windows';
    lines.push('Total: ' + tabs.length + ' ' + tabWord + ' across ' + grouped.length + ' ' + winWord);
    lines.push('');

    grouped.forEach(([wid, list], idx) => {
      const isFocused = focusedWindowId !== null && wid === focusedWindowId;
      const tabWord = list.length === 1 ? 'tab' : 'tabs';
      const heading =
        '## Window ' + (idx + 1) +
        (isFocused ? ' (focused)' : '') +
        ' — ' + list.length + ' ' + tabWord;
      lines.push(heading);
      for (const tab of list) {
        // Trim title BEFORE fallback — whitespace-only titles fall back to URL.
        const trimmed = (tab.title || '').replace(/[\r\n]+/g, ' ').trim();
        const titleSource = trimmed || tab.url || '(untitled)';
        const title = escapeMdLinkText(titleSource);
        const url = escapeMdUrl(tab.url || '');
        // Plain bullet when no URL — avoids malformed `[title]()` markdown.
        lines.push(url ? '- [' + title + '](' + url + ')' : '- ' + title);
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  function downloadMarkdown(content, filename) {
    // Blob + `<a download>` instead of chrome.downloads.download:
    // - drops the `downloads` permission entirely
    // - the filename ends up on the anchor's download attribute, which is what
    //   automation/wrappers (Playwright, Selenium) read to suggest a save target
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after the browser has had a tick to start the download — too soon
        // and Chromium aborts; too late and we'd leak the blob.
        setTimeout(() => URL.revokeObjectURL(url), 250);
        resolve(filename);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function onExportClick() {
    exportBtn.disabled = true;
    setStatus('Generando…');
    try {
      const [tabs, focusedWindowId] = await Promise.all([
        queryAllTabs(),
        getLastFocusedWindowId(),
      ]);
      if (tabs.length === 0) {
        setStatus('No hay pestañas para exportar.', 'err');
        return;
      }
      const now = new Date();
      const md = buildMarkdown(tabs, focusedWindowId, now);
      const filename = 'tabs-' + formatTimestampFilename(now) + '.md';
      await downloadMarkdown(md, filename);
      setStatus('Exportado: ' + filename, 'ok');
    } catch (e) {
      setStatus('Error: ' + e.message, 'err');
    } finally {
      exportBtn.disabled = false;
    }
  }

  // ---------- Import ----------

  // Decode markdown link-target escapes that we ourselves produce on export.
  function unescapeMdUrl(url) {
    if (!url) return '';
    return String(url).replace(/%28/g, '(').replace(/%29/g, ')');
  }

  // Decode markdown link-text escapes back to a clean title.
  function unescapeMdLinkText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\\[/g, '[')
      .replace(/\\\]/g, ']')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  // Heuristic: did the title fall back to the URL on export? If so, drop it as the title
  // so chrome can derive its own once the page loads.
  function titleIsJustUrl(title, url) {
    if (!title || !url) return false;
    return unescapeMdUrl(title) === unescapeMdUrl(url);
  }

  function isRestorableUrl(url) {
    if (!url) return false;
    const u = String(url).trim();
    if (!u) return false;
    // chrome.windows.create silently rejects javascript: and a few schemes; we filter them out
    // up front so the count of restored tabs matches reality.
    if (/^javascript:/i.test(u)) return false;
    return /^(https?:|file:|ftp:|chrome:|chrome-extension:|edge:|brave:|about:|view-source:|data:|blob:|mailto:|tel:|magnet:|ws:|wss:|moz-extension:)/i.test(u);
  }

  // Parse a Cinder-flavoured Markdown export. Tolerant of:
  //  - Optional preamble (header line `# ...`, total line, blank lines).
  //  - `## Window N (focused) — N tabs` headings (em-dash or hyphen, with/without focused).
  //  - Bullets `- [title](url)`, plain bullets `- text` (skipped, no URL), or bare-URL bullets `- https://...`.
  //  - Tabs that appear before any `## Window` heading — bucketed into an implicit "ungrouped" window.
  //  - CRLF, LF, leading BOM.
  //  - Indented bullets (treated like top-level bullets).
  //  - Blank lines anywhere.
  // Returns: { windows: [{ index, name, focused, tabs: [{title, url}] }], totalTabs, skipped }.
  function parseMarkdown(text) {
    if (typeof text !== 'string') {
      return { windows: [], totalTabs: 0, skipped: 0, error: 'Contenido inválido.' };
    }
    // Strip BOM, normalise newlines.
    const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');

    const windows = [];
    let current = null;
    let skipped = 0;

    // Match "## Window 1 (focused) — N tabs" / "## Window 1 — N tab" / "## Window 1 - N tabs".
    // `(?:focused)` group is optional; the trailing count is also optional so weird hand-edited
    // headings still create a window.
    const HEADING_RE = /^##\s+Window\s+(\d+)?\s*(\(focused\))?\s*[—\-:]?\s*(.*)$/i;
    // Match "- [title](url)". URL goes to the last `)` so titles with `(...)` parse correctly.
    const LINKED_BULLET_RE = /^\s*[-*+]\s+\[(.+)\]\((.+)\)\s*$/;
    // Match a bullet whose only content is a bare URL (e.g. "- https://example.com").
    const BARE_URL_BULLET_RE = /^\s*[-*+]\s+(https?:\/\/\S+|file:\/\/\S+|ftp:\/\/\S+)\s*$/i;
    // Any other bullet — treated as "no URL, skip".
    const ANY_BULLET_RE = /^\s*[-*+]\s+/;

    function ensureWindow(label) {
      if (!current) {
        current = { index: windows.length + 1, name: 'Window ' + (windows.length + 1), focused: false, tabs: [] };
        windows.push(current);
      }
      if (label) current.name = label;
    }

    for (const rawLine of lines) {
      // Strip trailing whitespace; leave leading whitespace so indented bullets keep matching.
      const line = rawLine.replace(/\s+$/, '');
      if (!line) continue;

      // Window heading?
      if (/^##\s+/.test(line)) {
        const m = line.match(HEADING_RE);
        if (m) {
          const idx = m[1] ? parseInt(m[1], 10) : windows.length + 1;
          const focused = !!m[2];
          current = { index: idx, name: 'Window ' + idx, focused: focused, tabs: [] };
          windows.push(current);
          continue;
        }
        // Non-Window `##` heading — ignore.
        continue;
      }

      // h1 of the export, total line, etc. — ignore non-bullet content.
      if (!ANY_BULLET_RE.test(line)) continue;

      const linked = line.match(LINKED_BULLET_RE);
      if (linked) {
        const rawTitle = unescapeMdLinkText(linked[1]);
        const rawUrl = unescapeMdUrl(linked[2].trim());
        if (!isRestorableUrl(rawUrl)) {
          skipped++;
          continue;
        }
        ensureWindow();
        const title = titleIsJustUrl(rawTitle, rawUrl) ? '' : rawTitle;
        current.tabs.push({ title: title, url: rawUrl });
        continue;
      }

      const bare = line.match(BARE_URL_BULLET_RE);
      if (bare) {
        const u = bare[1].trim();
        if (!isRestorableUrl(u)) {
          skipped++;
          continue;
        }
        ensureWindow();
        current.tabs.push({ title: '', url: u });
        continue;
      }

      // Bullet without a URL.
      skipped++;
    }

    // Drop empty windows (e.g. heading with zero successful bullets after filtering).
    const nonEmpty = windows.filter((w) => w.tabs.length > 0);
    const totalTabs = nonEmpty.reduce((acc, w) => acc + w.tabs.length, 0);
    return { windows: nonEmpty, totalTabs: totalTabs, skipped: skipped };
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsText(file);
    });
  }

  function showPreview(payload, fileName) {
    pendingImport = payload;
    const { totalTabs, windows, skipped } = payload;
    const winWord = windows.length === 1 ? 'ventana' : 'ventanas';
    const tabWord = totalTabs === 1 ? 'pestaña' : 'pestañas';
    let html =
      '<strong>' + totalTabs + '</strong> ' + tabWord +
      ' en <strong>' + windows.length + '</strong> ' + winWord;
    if (skipped > 0) {
      html += ' <span class="skipped">(' + skipped + ' sin URL omitidas)</span>';
    }
    if (fileName) html += '<br><span style="color:var(--text-dim)">' + escapeHtml(fileName) + '</span>';
    previewSummaryEl.innerHTML = html;
    // Reset toggle each time so a previous user choice doesn't carry over silently.
    if (mergeWindowsEl) mergeWindowsEl.checked = false;
    previewEl.hidden = false;
    restoreBtn.disabled = totalTabs === 0;
    importBtn.disabled = true;
    exportBtn.disabled = true;
    setStatus('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hidePreview() {
    pendingImport = null;
    previewEl.hidden = true;
    importBtn.disabled = false;
    exportBtn.disabled = false;
    if (fileInput) fileInput.value = '';
  }

  async function onImportFileSelected(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    setStatus('Leyendo…');
    try {
      // 8 MiB cap — a sane upper bound that still admits absurdly large exports without
      // wedging the popup if the user picks a wrong file.
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('Archivo demasiado grande (>8 MB).');
      }
      const text = await readFileAsText(file);
      const parsed = parseMarkdown(text);
      if (parsed.error) {
        setStatus('Error: ' + parsed.error, 'err');
        fileInput.value = '';
        return;
      }
      if (parsed.totalTabs === 0) {
        setStatus('Sin pestañas restaurables en el archivo.', 'err');
        fileInput.value = '';
        return;
      }
      showPreview(parsed, file.name);
    } catch (e) {
      setStatus('Error: ' + e.message, 'err');
      fileInput.value = '';
    }
  }

  function createWindowWithUrls(urls) {
    return new Promise((resolve, reject) => {
      try {
        chrome.windows.create({ url: urls, focused: false }, (win) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          resolve(win);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function restoreFromPending() {
    if (!pendingImport) return;
    const merge = !!(mergeWindowsEl && mergeWindowsEl.checked);
    restoreBtn.disabled = true;
    cancelImportBtn.disabled = true;
    setStatus('Restaurando…');
    try {
      let opened = 0;
      if (merge) {
        const allUrls = [];
        for (const w of pendingImport.windows) {
          for (const t of w.tabs) allUrls.push(t.url);
        }
        if (allUrls.length === 0) throw new Error('Nada que restaurar.');
        await createWindowWithUrls(allUrls);
        opened = allUrls.length;
      } else {
        for (const w of pendingImport.windows) {
          if (w.tabs.length === 0) continue;
          await createWindowWithUrls(w.tabs.map((t) => t.url));
          opened += w.tabs.length;
        }
      }
      const tabWord = opened === 1 ? 'pestaña' : 'pestañas';
      setStatus('Restauradas ' + opened + ' ' + tabWord + '.', 'ok');
      hidePreview();
      // Refresh counts after the new windows materialise.
      refreshCounts();
    } catch (e) {
      setStatus('Error: ' + e.message, 'err');
    } finally {
      restoreBtn.disabled = false;
      cancelImportBtn.disabled = false;
    }
  }

  // Exposed for tests run via lupa /extension/run — the popup itself only invokes the user-facing flows.
  window.__cinder = { parseMarkdown: parseMarkdown, isRestorableUrl: isRestorableUrl };

  document.addEventListener('DOMContentLoaded', () => {
    refreshCounts();
    exportBtn.addEventListener('click', onExportClick);
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', onImportFileSelected);
    restoreBtn.addEventListener('click', restoreFromPending);
    cancelImportBtn.addEventListener('click', () => {
      hidePreview();
      setStatus('Importación cancelada.');
    });
  });
})();
