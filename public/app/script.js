const state = {
  nextId: 1,
  root: { id: 0, data: '', children: [], completed: false, collapsed: false, numbered: false, type: 'text' },
  selectedId: null,
  selectedNodeIds: [],
  selectAllLevel: 0,
  cursorOffset: 0,
  focusIds: [],
  history: [],
  historyIndex: -1,
  isSearchOpen: false,
  searchQuery: '',
  isCheatsheetOpen: false,
  isVersionOpen: false,
  hideCompleted: false,
  tagFilter: null,
  noKeyboardMode: 'auto',
  fontFamily: 'system-ui',
  screenWidth: 'normal',
  animateTransitions: true,
  detectMarkdownPaste: true,
  embeds: { youtube: true, x: true, instagram: true },
  linkTargets: {},
  renderAnimation: null,
};

let autosaveTimer = null;
let pendingDeleteId = null;
let renderScheduled = false;
let clipboardNode = null;
let clipboardText = '';
let linkSuggestionState = null;

const KEYBINDS = [
  ['enter', 'new sibling'],
  ['tab', 'indent'],
  ['shift+tab', 'outdent'],
  ['ctrl+z', 'undo'],
  ['ctrl+shift+z', 'redo'],
  ['ctrl+j', 'collapse/expand node'],
  ['ctrl+k', 'open search'],
  ['ctrl+l', 'toggle complete'],
  ['ctrl+e', 'toggle number children'],
  ['ctrl+]', 'zoom into node'],
  ['ctrl+[', 'zoom out'],
  ['ctrl+/', 'toggle this cheat sheet'],
];

function showToast(message, duration = 2000) {
  const existingToast = document.getElementById('toast-message');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.id = 'toast-message';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #3a3a3a;
    color: #d4d0c4;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 1000;
    border: 1px solid #4a4840;
    animation: toast-fade-in 0.3s ease-out;
  `;
  
  document.body.appendChild(toast);
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes toast-fade-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `;
  if (!document.querySelector('style[data-toast]')) {
    style.setAttribute('data-toast', 'true');
    document.head.appendChild(style);
  }
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, duration);
}

function getNode(id) {
  function walk(node) {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(state.root);
}

function findParent(id) {
  function walk(node, parent) {
    if (node.id === id) return parent;
    for (const child of node.children) {
      const found = walk(child, node);
      if (found) return found;
    }
    return null;
  }
  return walk(state.root, null);
}

function getNodeIndex(id) {
  const parent = findParent(id);
  if (!parent) return -1;
  return parent.children.findIndex(c => c.id === id);
}

function detectOldData(node) {
  if (typeof node.type === 'undefined') return true;
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (detectOldData(child)) return true;
    }
  }
  return false;
}

function normalizeNode(node) {
  if (typeof node.numbered === 'undefined') {
    node.numbered = false;
  }
  if (typeof node.type === 'undefined') {
    node.type = 'text';
  }
  // migrate old text/imageData format to unified data field
  if (typeof node.data === 'undefined') {
    if (typeof node.imageData !== 'undefined' && node.imageData) {
      node.data = { src: node.imageData };
      node.type = 'image';
    } else if (typeof node.text !== 'undefined') {
      node.data = node.text;
      node.type = 'text';
    } else {
      node.data = '';
    }
  }
  delete node.text;
  delete node.imageData;
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      normalizeNode(child);
    }
  }
}

function createNode(text) {
  return { id: state.nextId++, data: text, children: [], completed: false, collapsed: false, numbered: false, type: 'text' };
}

function getVisibleNodes() {
  const focusRoot = state.focusIds.length > 0
    ? getNode(state.focusIds[state.focusIds.length - 1])
    : state.root;

  if (!focusRoot) return [];

  const result = [];

  function walk(node, depth) {
    if (state.hideCompleted && node.completed && node.children.length === 0) return;
    result.push({ ...node, _depth: depth, _isContext: false });
    if (!node.collapsed && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth + 1);
      }
    }
  }

  for (let i = 0; i < focusRoot.children.length; i++) {
    walk(focusRoot.children[i], 0);
  }

  return result;
}

function getNodePath(id) {
  const path = [];
  let current = id;
  while (current !== null && current !== 0) {
    path.unshift(current);
    const parent = findParent(current);
    current = parent ? parent.id : null;
  }
  return path;
}

function cloneNode(node) {
  return { ...node, children: node.children.map(cloneNode) };
}

function cloneNodeWithNewIds(node) {
  return {
    ...node,
    id: state.nextId++,
    children: node.children.map(cloneNodeWithNewIds)
  };
}

function copyNode(id) {
  const node = getNode(id);
  if (!node) return false;
  clipboardNode = cloneNode(node);
  state.selectedNodeIds = [id];
  clipboardText = serializeSelectedNodes();
  showToast('copied to app clipboard');
  return true;
}

function getSelectedNodeSet() {
  return new Set(state.selectedNodeIds.length > 0
    ? state.selectedNodeIds
    : (state.selectedId === null ? [] : [state.selectedId]));
}

function serializeSelectedNodes() {
  const selected = getSelectedNodeSet();
  if (selected.size === 0) return '';

  const roots = [];
  function walk(node) {
    if (selected.has(node.id)) {
      const parent = findParent(node.id);
      if (!parent || !selected.has(parent.id)) roots.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  }
  walk(state.root);

  function serialize(node, depth) {
    const text = typeof node.data === 'string' ? node.data : '';
    const completedPrefix = node.completed ? '~~' : '';
    const completedSuffix = node.completed ? '~~' : '';
    const lines = [`${'  '.repeat(depth)}${completedPrefix}${text}${completedSuffix}`];
    for (const child of node.children) {
      if (selected.has(child.id)) lines.push(serialize(child, depth + 1));
    }
    return lines.join('\n');
  }
  return roots.map(node => serialize(node, 0)).join('\n');
}

function parsePastedNodes(text, detectMarkdown = state.detectMarkdownPaste) {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '');

  if (lines.length === 0) return [];

  const minimumIndent = Math.min(...lines.map(line => {
    const leadingSpaces = line.match(/^ */)[0].length;
    return Math.floor(leadingSpaces / 2) * 2;
  }));
  const roots = [];
  const stack = [];
  let headingDepth = null;
  let listDepth = null;
  let previousWasBullet = false;

  for (const line of lines) {
    const leadingSpaces = line.match(/^ */)[0].length;
    const indentDepth = Math.max(0, Math.floor((leadingSpaces - minimumIndent) / 2));
    if (!detectMarkdown) {
      const content = line.trim();
      const depth = indentDepth;
      const node = createNode(content);
      while (stack.length > depth) stack.pop();
      const parent = depth > 0 ? stack[depth - 1] : null;
      if (!parent) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
      stack[depth] = node;
      continue;
    }
    const headingMatch = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const content = headingMatch
      ? headingMatch[2].trim()
      : bulletMatch
        ? bulletMatch[1].trim()
        : line.trim();
    const completedMatch = content.match(/^~~([\s\S]+)~~$/);
    let depth;

    if (headingMatch) {
      headingDepth = indentDepth + headingMatch[1].length - 1;
      listDepth = null;
      depth = headingDepth;
    } else if (bulletMatch) {
      if (previousWasBullet && listDepth !== null) {
        depth = listDepth;
      } else {
        const parentDepth = indentDepth > 0 ? indentDepth : (headingDepth ?? 0);
        depth = parentDepth + 1;
        listDepth = depth;
      }
    } else {
      listDepth = null;
      depth = indentDepth > 0
        ? indentDepth
        : (headingDepth === null ? 0 : headingDepth + 1);
    }

    const node = createNode(completedMatch ? completedMatch[1] : content);
    node.completed = Boolean(completedMatch);

    while (stack.length > depth) stack.pop();
    const parent = depth > 0 ? stack[depth - 1] : null;
    if (!parent) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    stack[depth] = node;
    previousWasBullet = Boolean(bulletMatch);
  }

  return roots;
}

function insertPastedNodes(text, targetId, position) {
  const nodes = parsePastedNodes(text);
  if (nodes.length === 0) {
    showToast('nothing to paste');
    return false;
  }

  if (targetId === null) {
    state.root.children.push(...nodes);
  } else if (position === 'under') {
    const target = getNode(targetId);
    if (!target) return false;
    target.children.push(...nodes);
  } else {
    const parent = findParent(targetId);
    const index = getNodeIndex(targetId);
    if (!parent || index < 0) return false;
    const insertIndex = position === 'after' ? index + 1 : index;
    parent.children.splice(insertIndex, 0, ...nodes);
  }

  state.selectedId = nodes[nodes.length - 1].id;
  saveSnapshot();
  render();
  showToast('nodes pasted');
  return true;
}

function pasteNodeUnder(targetId) {
  return insertPastedNodes(clipboardText, targetId, 'under');
}

function pasteNodeAbove(targetId) {
  return insertPastedNodes(clipboardText, targetId, 'above');
}

function persistState() {
  const data = {
    root: cloneNode(state.root),
    nextId: state.nextId,
    selectedId: state.selectedId,
    focusIds: [...state.focusIds],
    hideCompleted: state.hideCompleted,
    tagFilter: state.tagFilter,
    noKeyboardMode: state.noKeyboardMode,
    fontFamily: state.fontFamily,
    screenWidth: state.screenWidth,
    animateTransitions: state.animateTransitions,
    detectMarkdownPaste: state.detectMarkdownPaste,
    embeds: { ...state.embeds },
    linkTargets: { ...state.linkTargets },
  };
  saveCurrent(data);
}

function schedulePersist() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    persistState();
    autosaveTimer = null;
  }, 1000);
}

function isTouchDeviceDetected() {
  return (
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof navigator !== 'undefined' && navigator.msMaxTouchPoints > 0)
  );
}

function shouldShowActionBar() {
  if (state.noKeyboardMode === 'yes') return true;
  if (state.noKeyboardMode === 'no') return false;
  return isTouchDeviceDetected();
}

function updateActionBar() {
  const actionBar = document.getElementById('action-bar');
  if (shouldShowActionBar()) {
    actionBar.classList.add('open');
  } else {
    actionBar.classList.remove('open');
  }
}

function openVersionHistory() {
  state.isVersionOpen = true;
  document.getElementById('version-overlay').classList.add('open');
  renderVersionList();
}

function closeVersionHistory() {
  state.isVersionOpen = false;
  document.getElementById('version-overlay').classList.remove('open');
}

function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function openSync() {
  document.getElementById('sync-overlay').classList.add('open');
  document.getElementById('sync-room').focus();
}

function closeSync() {
  document.getElementById('sync-overlay').classList.remove('open');
  document.getElementById('sync-status').textContent = '';
  document.getElementById('sync-room').value = '';
  document.getElementById('sync-secret').value = '';
  document.getElementById('sync-replace-root').checked = false;
}

function renderVersionList() {
  const list = document.getElementById('version-list');
  list.innerHTML = '<div class="search-empty">loading...</div>';
  getVersions().then(versions => {
    if (versions.length === 0) {
      list.innerHTML = '<div class="search-empty">no versions saved</div>';
      return;
    }
    let html = '';
    for (const v of versions) {
      const nodeCount = v.snapshot && v.snapshot.root ? countAllDescendants(v.snapshot.root) : 0;
      html += `<div class="version-item">
        <div>
          <div class="v-time">${escapeHtml(v.timestamp)}</div>
          <div class="v-info">${nodeCount} nodes</div>
        </div>
        <button class="v-restore" data-action="restore-version" data-version-id="${v.id}">restore</button>
      </div>`;
    }
    list.innerHTML = html;
  }).catch(() => {
    list.innerHTML = '<div class="search-empty">failed to load versions</div>';
  });
}

function restoreVersionFromHistory(versionId) {
  restoreVersion(versionId).then(snapshot => {
    if (!snapshot) return;
    restoreSnapshot(snapshot);
    state.history = [];
    state.historyIndex = -1;
    saveSnapshot();
    closeVersionHistory();
    render();
  });
}

function saveSnapshot() {
  function clone(node) {
    return { ...node, children: node.children.map(clone) };
  }
  const snapshot = {
    root: clone(state.root),
    nextId: state.nextId,
    selectedId: state.selectedId,
    focusIds: [...state.focusIds],
  };
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > 200) state.history.shift();
  state.historyIndex = state.history.length - 1;
  persistState();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreSnapshot(state.history[state.historyIndex]);
  render();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreSnapshot(state.history[state.historyIndex]);
  render();
}

function restoreSnapshot(snapshot) {
  function clone(node) {
    return { ...node, children: node.children.map(clone) };
  }
  state.root = clone(snapshot.root);
  state.nextId = snapshot.nextId;
  state.selectedId = snapshot.selectedId;
  state.focusIds = [...snapshot.focusIds];
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatNodeText(text, searchQuery) {
  let html = escapeHtml(text);

  if (searchQuery) {
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    html = html.replace(re, '<span class="hl">$1</span>');
  }

  // Apply markdown formatting (in order of precedence: code > bold > italic > strikethrough)
  // Code snippets: `code`
  html = html.replace(/`([^`]+)`/g, '<span class="code">$1</span>');
  
  // Bold: **text**
  html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
  
  // Italic: *text*
  html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
  
  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  html = html.replace(/\[\[(\d+):([^\]]*)\]\]/g, (match, lineNumber, label) => {
    const target = getNodeByLineNumber(Number(lineNumber));
    const targetName = target && typeof target.data === 'string' ? target.data : '';
    const displayName = label
      ? escapeHtml(getLinkLabel(label))
      : escapeHtml(getLinkLabel(targetName)) || lineNumber;
    const className = target ? 'node-link' : 'node-link node-link-missing';
    return `<span class="${className}" data-link-id="${target ? target.id : ''}" data-link-line="${lineNumber}">${displayName}</span>`;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, href) => {
    let url;
    try {
      url = new URL(href);
    } catch {
      return match;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (state.embeds.youtube && (host === 'youtube.com' || host === 'youtu.be')) {
      const videoId = host === 'youtu.be'
        ? url.pathname.slice(1)
        : url.searchParams.get('v');
      if (videoId) {
        return `<span class="media-embed media-embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}" title="${escapeHtml(label)}" loading="lazy" allowfullscreen></iframe></span>`;
      }
    }
    if (state.embeds.x && (host === 'x.com' || host === 'twitter.com')) {
      return `<a class="social-embed social-embed-x" href="${href}" target="_blank" rel="noopener noreferrer">X · ${escapeHtml(label)}</a>`;
    }
    if (state.embeds.instagram && host === 'instagram.com') {
      return `<a class="social-embed social-embed-instagram" href="${href}" target="_blank" rel="noopener noreferrer">Instagram · ${escapeHtml(label)}</a>`;
    }
    return `<a class="external-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  });

  html = html.replace(/(#[\w\u00C0-\u024F]+|#[\d]+[\w]*)/g, '<span class="tag">$1</span>');

  if (!html) html = '<br>';
  return html;
}

function getAllNodes() {
  const nodes = [];
  function walk(node) {
    for (const child of node.children) {
      nodes.push(child);
      walk(child);
    }
  }
  walk(state.root);
  return nodes;
}

function getNodeByLineNumber(lineNumber) {
  return getAllNodes()[lineNumber - 1] || null;
}

function getNodeLineNumber(nodeId) {
  return getAllNodes().findIndex(node => node.id === nodeId) + 1;
}

function getLinkLabel(text) {
  if (text.length <= 13) return text;
  return `${text.slice(0, 13)}...`;
}

function synchronizeNodeLinks() {
  const nodes = getAllNodes();
  let didChange = false;

  for (const source of nodes) {
    if (typeof source.data !== 'string') continue;
    let referenceIndex = 0;
    source.data = source.data.replace(/\[\[(\d+):([^\]]*)\]\]/g, (match, lineNumber, label) => {
      const bindingKey = `${source.id}:${referenceIndex++}`;
      const targetId = state.linkTargets[bindingKey] ?? getNodeByLineNumber(Number(lineNumber))?.id;
      const target = targetId === undefined ? null : getNode(targetId);
      if (!target) return match;

      state.linkTargets[bindingKey] = target.id;
      const nextLine = getNodeLineNumber(target.id);
      const nextLabel = label ? getLinkLabel(typeof target.data === 'string' ? target.data : label) : '';
      const nextValue = `[[${nextLine}:${nextLabel}]]`;
      if (nextValue !== match) didChange = true;
      return nextValue;
    });
  }

  if (didChange) {
    persistState();
  }
  return didChange;
}

function insertLinkSuggestion(suggestion) {
  if (!linkSuggestionState) return;
  const node = getNode(linkSuggestionState.nodeId);
  if (!node || typeof node.data !== 'string') return;
  const before = node.data.slice(0, linkSuggestionState.start);
  const after = node.data.slice(linkSuggestionState.cursor);
  const lineNumber = getNodeLineNumber(suggestion.id);
  const label = getLinkLabel(suggestion.data);
  const referenceIndex = (node.data.slice(0, linkSuggestionState.start).match(/\[\[(\d+):([^\]]*)\]\]/g) || []).length;
  state.linkTargets[`${node.id}:${referenceIndex}`] = suggestion.id;
  node.data = `${before}[[${lineNumber}:${label}]]${after}`;
  state.selectedId = node.id;
  state.cursorOffset = before.length + lineNumber.toString().length + suggestion.data.length + 4;
  hideLinkSuggestions();
  saveSnapshot();
  render();
}

function hideLinkSuggestions() {
  const suggestions = document.getElementById('link-suggestions');
  suggestions.classList.remove('open');
  suggestions.innerHTML = '';
  linkSuggestionState = null;
}

function updateLinkSuggestions(el, nodeId) {
  const selection = window.getSelection();
  const cursor = selection && selection.rangeCount > 0
    ? selection.getRangeAt(0).startOffset
    : (el.textContent || '').length;
  const text = el.textContent || '';
  const beforeCursor = text.slice(0, cursor);
  const match = beforeCursor.match(/\[\[([^\]]*)$/);
  if (!match) {
    hideLinkSuggestions();
    return;
  }

  const query = match[1].replace(/^\d+:/, '').trim().toLowerCase();
  const suggestions = getAllNodes()
    .filter(node => node.id !== nodeId && typeof node.data === 'string')
    .filter(node => node.data.toLowerCase().includes(query))
    .slice(0, 8);
  const container = document.getElementById('link-suggestions');
  if (suggestions.length === 0) {
    hideLinkSuggestions();
    return;
  }

  linkSuggestionState = {
    nodeId,
    start: cursor - match[0].length,
    cursor,
    suggestions,
    selectedIndex: 0,
  };
  container.innerHTML = suggestions.map((node, index) => `
    <button class="link-suggestion${index === 0 ? ' active' : ''}" data-node-id="${node.id}" role="option">
      <span>${escapeHtml(getLinkLabel(node.data))}</span>
      <small>${getNodeLineNumber(node.id)}</small>
    </button>
  `).join('');
  const rect = el.getBoundingClientRect();
  container.style.left = `${Math.max(8, rect.left)}px`;
  container.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 4)}px`;
  container.classList.add('open');
}

function getIndentPx(depth) {
  return depth * 24 + 8;
}

function saveCurrentText() {
  if (state.selectedId === null) return;
  const el = document.querySelector(`[data-id="${state.selectedId}"] .node-text`);
  if (el) {
    const node = getNode(state.selectedId);
    if (node) {
      node.data = el.textContent || '';
    }
  }
}

function applyFormatting(before, after) {
  const el = document.querySelector(`[data-id="${state.selectedId}"] .node-text`);
  if (!el || state.selectedId === null) return;
  
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;
  
  const range = sel.getRangeAt(0);
  const selectedText = range.toString();
  
  if (selectedText.length === 0) {
    // No selection, just insert the markers
    const textNode = document.createTextNode(before + after);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
  } else {
    // Wrap selected text with formatting markers
    const newText = before + selectedText + after;
    const textNode = document.createTextNode(newText);
    range.deleteContents();
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
  }
  
  sel.removeAllRanges();
  sel.addRange(range);
  
  saveCurrentText();
  render();
}

function selectNode(id, offset) {
  saveCurrentText();
  state.selectedId = id;
  state.selectedNodeIds = [];
  state.selectAllLevel = 0;
  state.cursorOffset = offset !== undefined ? offset : 0;
   render();
}

function getNodeIdsInSubtree(node) {
  const ids = [node.id];
  for (const child of node.children) ids.push(...getNodeIdsInSubtree(child));
  return ids;
}

function selectNodesForLevel(level) {
  if (state.selectedId === null) return;
  const current = getNode(state.selectedId);
  if (!current) return;

  if (level === 1) {
    state.selectedNodeIds = [current.id];
  } else if (level === 2) {
    const parent = findParent(current);
    state.selectedNodeIds = getNodeIdsInSubtree(parent && parent.id !== 0 ? parent : current);
  } else {
    state.selectedNodeIds = getVisibleNodes().map(node => node.id);
  }
  state.selectAllLevel = level;
  render();
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    render();
    renderScheduled = false;
  });
}

function render() {
  const container = document.getElementById('outliner');
  const animation = state.renderAnimation;
  state.renderAnimation = null;
  synchronizeNodeLinks();
  const visibleNodes = getVisibleNodes();
  const breadcrumb = document.getElementById('breadcrumb');

  let bcHtml = '';
  if (state.focusIds.length > 0) {
    const items = [
      '<span class="bc-item" data-zoom="root">StackNodes</span>'
    ];
    for (let i = 0; i < state.focusIds.length; i++) {
      const node = getNode(state.focusIds[i]);
      if (!node) continue;
      const isLast = i === state.focusIds.length - 1;
      const label = typeof node.data === 'string' ? node.data.substring(0, 40) : 'untitled';
      if (isLast) {
        items.push(`<span class="bc-item bc-current">${escapeHtml(label)}</span>`);
      } else {
        items.push(`<span class="bc-item" data-zoom="${node.id}">${escapeHtml(label)}</span>`);
      }
    }
    items.reverse();
    bcHtml = items.map((item, idx) => {
      const sep = idx > 0 ? '<span class="bc-sep">›</span>' : '';
      return sep + item;
    }).join('');
  } else {
    bcHtml = '<span class="bc-item bc-current">StackNodes</span>';
  }
  breadcrumb.innerHTML = bcHtml;

  if (state.tagFilter) {
    const filtered = visibleNodes.filter(n => typeof n.data === 'string' && n.data.includes(state.tagFilter));
    if (filtered.length === 0) {
      container.innerHTML = `${renderViewTitle()}<div class="search-empty">no nodes with ${escapeHtml(state.tagFilter)}</div>`;
      applyRenderAnimation(container, animation);
      return;
    }
    renderNodeList(container, filtered);
    applyRenderAnimation(container, animation);
    return;
  }

  if (visibleNodes.length === 0) {
    container.innerHTML = `${renderViewTitle()}<div id="empty-state">nothing here yet</div>`;
    applyRenderAnimation(container, animation);
    return;
  }

  renderNodeList(container, visibleNodes);
  restoreFocus();
  applyRenderAnimation(container, animation);
}

function applyRenderAnimation(container, animation) {
  if (!animation) return;
  const className = `render-${animation}`;
  container.classList.remove('render-zoom-in', 'render-zoom-out');
  void container.offsetWidth;
  container.classList.add(className);

  if (animation === 'move-up' || animation === 'move-down') {
    const node = container.querySelector(`[data-id="${state.selectedId}"]`);
    if (node) {
      node.classList.add(`node-${animation}`);
      node.addEventListener('animationend', () => {
        node.classList.remove(`node-${animation}`);
      }, { once: true });
    }
  }

  window.setTimeout(() => {
    container.classList.remove(className);
  }, 240);
}

function renderViewTitle() {
  if (state.focusIds.length === 0) return '';
  const focusedNode = getNode(state.focusIds[state.focusIds.length - 1]);
  if (!focusedNode || typeof focusedNode.data !== 'string') return '';
  return `<h1 id="view-title" class="visible" contenteditable="true" data-node-id="${focusedNode.id}">${escapeHtml(focusedNode.data)}</h1>`;
}

function renderNodeList(container, nodes) {
  let html = renderViewTitle();
  const selectedNodeIds = new Set(state.selectedNodeIds);
  for (const n of nodes) {
    const isSelected = n.id === state.selectedId;
    const isMultiSelected = selectedNodeIds.has(n.id);
    const indent = getIndentPx(n._depth);
    let classes = 'node';
    if (isSelected) classes += ' selected';
    if (isMultiSelected) classes += ' multi-selected';
    if (n.completed) classes += ' completed';

    let bulletHtml;
    if (n._depth > 0) {
      const parent = getNodePath(n.id).slice(-2)[0];
      const parentNode = parent ? getNode(parent) : null;
      if (parentNode && parentNode.numbered) {
        const siblingIndex = parentNode.children.findIndex(c => c.id === n.id) + 1;
        bulletHtml = `<span class="node-bullet" data-id="${n.id}">${siblingIndex}.</span>`;
      } else {
        bulletHtml = `<span class="node-bullet" data-id="${n.id}">•</span>`;
      }
    } else {
      bulletHtml = `<span class="node-bullet" data-id="${n.id}">•</span>`;
    }
    
    const toggleHtml = `<span class="node-toggle ${n.children.length > 0 ? (n.collapsed ? 'collapsed' : '') : 'empty'}" data-id="${n.id}">${n.children.length > 0 ? '<img src="../assets/triangle.svg" alt="" />' : ''}</span>`;

    let contentHtml;
    if (n.type === 'image' && typeof n.data === 'object') {
      contentHtml = `<img class="node-image" src="${n.data.src}" data-id="${n.id}" />`;
    } else {
      let textHtml;
      const displayText = typeof n.data === 'string' ? n.data : '';
      if (isSelected) {
        textHtml = escapeHtml(displayText) || '<br>';
      } else {
        textHtml = formatNodeText(displayText, null);
      }
      contentHtml = `<span class="node-text">${textHtml}</span>`;
    }

    html += `<div class="${classes}" data-id="${n.id}" data-depth="${n._depth}" style="padding-left:${indent}px">
      ${toggleHtml}
      ${bulletHtml}
      ${contentHtml}
    </div>`;
  }
  container.innerHTML = html;
}

function updateMenuIcon(active) {
  const icon = document.querySelector('#menu-dropdown .menu-icon');
  if (icon) {
    icon.classList.toggle('active', active);
  }
}

function updateTouchModeToggle() {
  const toggle = document.getElementById('touch-mode-toggle');
  if (!toggle) return;
  const isTouchMode = state.noKeyboardMode === 'yes';
  toggle.classList.toggle('active', isTouchMode);
}

function updateAppearance() {
  document.getElementById('font-select').value = state.fontFamily;
  document.getElementById('screen-width-select').value = state.screenWidth;
  document.documentElement.style.setProperty('--editor-font-family', state.fontFamily);
  document.getElementById('app').dataset.screenWidth = state.screenWidth;
}

function restoreFocus() {
  if (state.selectedId === null) return;
  const el = document.querySelector(`[data-id="${state.selectedId}"] .node-text`);
  if (!el) return;

  if (el.innerHTML === '<br>' || el.innerHTML === '') {
    el.innerHTML = '<br>';
  }

  el.contentEditable = 'true';
  el.focus();

  const text = el.textContent || '';
  const offset = Math.min(state.cursorOffset, text.length);
  try {
    const range = document.createRange();
    const sel = window.getSelection();
    if (el.firstChild) {
      range.setStart(el.firstChild, offset);
    } else {
      range.selectNodeContents(el);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function addSibling(text) {
  if (state.selectedId === null) return createFirstNode(text);

  const parent = findParent(state.selectedId);
  if (!parent) return;
  const idx = getNodeIndex(state.selectedId);
  const newNode = createNode(text);
  parent.children.splice(idx + 1, 0, newNode);
  state.selectedId = newNode.id;
  state.cursorOffset = 0;
  saveSnapshot();
  render();
}

function createFirstNode(text) {
  const node = createNode(text);
  state.root.children.push(node);
  state.selectedId = node.id;
  state.cursorOffset = 0;
  saveSnapshot();
  render();
}

function addChild() {
  if (state.selectedId === null) return;
  const parent = getNode(state.selectedId);
  if (!parent) return;
  const newNode = createNode('');
  parent.children.unshift(newNode);
  state.selectedId = newNode.id;
  state.cursorOffset = 0;
  saveSnapshot();
  render();
}

function indentNode() {
  if (state.selectedId === null) return;
  saveCurrentText();
  const parent = findParent(state.selectedId);
  if (!parent) return;
  const idx = getNodeIndex(state.selectedId);
  if (idx <= 0) return;
  const newParent = parent.children[idx - 1];
  const [moved] = parent.children.splice(idx, 1);
  newParent.children.push(moved);
  saveSnapshot();
  render();
}

function outdentNode() {
  if (state.selectedId === null) return;
  saveCurrentText();
  const parent = findParent(state.selectedId);
  if (!parent || parent.id === 0) return;
  const grandparent = findParent(parent.id);
  if (!grandparent) return;
  const pIdx = grandparent.children.findIndex(c => c.id === parent.id);
  const nodeIdx = parent.children.findIndex(c => c.id === state.selectedId);
  const [moved] = parent.children.splice(nodeIdx, 1);
  grandparent.children.splice(pIdx + 1, 0, moved);
  saveSnapshot();
  render();
}

function countAllDescendants(node) {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countAllDescendants(child);
  }
  return count;
}

function deleteNode(id) {
  const node = getNode(id);
  const totalDescendants = node ? countAllDescendants(node) : 0;
  if (totalDescendants > 5) {
    pendingDeleteId = id;
    document.getElementById('confirm-overlay').classList.add('open');
  } else {
    removeNode(id);
  }
}

function removeNode(id) {
  if (id === null) return;
  saveCurrentText();
  const parent = findParent(id);
  if (!parent) return;
  const visibleBefore = getVisibleNodes();
  const visibleIdx = visibleBefore.findIndex(n => n.id === id);
  const idx = getNodeIndex(id);
  parent.children.splice(idx, 1);
  const visible = getVisibleNodes();
  if (visible.length > 0) {
    const newIdx = visibleIdx > 0 ? Math.min(visibleIdx - 1, visible.length - 1) : 0;
    const target = visible[newIdx];
    state.selectedId = target.id;
    state.cursorOffset = typeof target.data === 'string' ? target.data.length : 0;
  } else {
    state.selectedId = null;
    state.cursorOffset = 0;
  }
  saveSnapshot();
  render();
}

function toggleComplete() {
  if (state.selectedId === null) return;
  saveCurrentText();
  const node = getNode(state.selectedId);
  if (!node) return;
  node.completed = !node.completed;
  saveSnapshot();
  render();
}

function toggleCollapse(id) {
  const node = getNode(id);
  if (!node || node.children.length === 0) return;
  node.collapsed = !node.collapsed;
  saveSnapshot();
  render();
}

function collapseAll() {
  function walk(node) {
    if (node.children.length > 0) {
      node.collapsed = true;
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(state.root);
  saveSnapshot();
  render();
}

function expandAll() {
  function walk(node) {
    node.collapsed = false;
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(state.root);
  saveSnapshot();
  render();
}

function toggleNumbering(id) {
  const node = getNode(id);
  if (!node) return;
  
  if (node.children.length === 0) {
    showToast('No children to number');
    return;
  }
  
  node.numbered = !node.numbered;
  saveSnapshot();
  render();
}

function focusOnNode(id) {
  saveCurrentText();
  const path = getNodePath(id);
  state.focusIds = path;
  const visible = getVisibleNodes();
  state.selectedId = visible.length > 0 ? visible[0].id : null;
  state.cursorOffset = 0;
  saveSnapshot();
  render();
}

function zoomIn() {
  if (state.selectedId === null) return;
  if (state.animateTransitions) state.renderAnimation = 'zoom-in';
  focusOnNode(state.selectedId);
}

function zoomOut() {
  if (state.focusIds.length === 0) return;
  if (state.animateTransitions) state.renderAnimation = 'zoom-out';
  saveCurrentText();
  const prevFocus = state.focusIds.pop();
  state.selectedId = prevFocus;
  saveSnapshot();
  render();
}

function zoomTo(id) {
  if (id === 'root') {
    if (state.focusIds.length > 0) {
      state.selectedId = state.focusIds[0];
      state.focusIds = [];
      saveSnapshot();
      render();
    }
    return;
  }
  const numId = parseInt(id, 10);
  const idx = state.focusIds.indexOf(numId);
  if (idx >= 0) {
    state.focusIds = state.focusIds.slice(0, idx + 1);
    const visible = getVisibleNodes();
    state.selectedId = visible.length > 0 ? visible[0].id : null;
    saveSnapshot();
    render();
  }
}

function moveUp() {
  if (state.selectedId === null) return;
  saveCurrentText();
  const cursorOffset = getCurrentCursorOffset();
  const parent = findParent(state.selectedId);
  if (!parent) return;
  const idx = getNodeIndex(state.selectedId);
  if (idx <= 0) return;
  [parent.children[idx - 1], parent.children[idx]] = [parent.children[idx], parent.children[idx - 1]];
  state.cursorOffset = cursorOffset;
  if (state.animateTransitions) state.renderAnimation = 'move-up';
  saveSnapshot();
  render();
}

function moveDown() {
  if (state.selectedId === null) return;
  saveCurrentText();
  const cursorOffset = getCurrentCursorOffset();
  const parent = findParent(state.selectedId);
  if (!parent) return;
  const idx = getNodeIndex(state.selectedId);
  if (idx >= parent.children.length - 1) return;
  [parent.children[idx], parent.children[idx + 1]] = [parent.children[idx + 1], parent.children[idx]];
  state.cursorOffset = cursorOffset;
  if (state.animateTransitions) state.renderAnimation = 'move-down';
  saveSnapshot();
  render();
}

function getCurrentCursorOffset() {
  const el = state.selectedId === null
    ? null
    : document.querySelector(`[data-id="${state.selectedId}"] .node-text`);
  if (!el) return state.cursorOffset;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return state.cursorOffset;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return state.cursorOffset;
  return Math.max(0, range.startOffset);
}

function getParentOfSelected() {
  if (state.selectedId === null) return null;
  return findParent(state.selectedId);
}

function selectNext() {
  const visible = getVisibleNodes();
  if (visible.length === 0) return;
  const idx = visible.findIndex(n => n.id === state.selectedId);
  if (idx < visible.length - 1) {
    saveCurrentText();
    state.cursorOffset = getCurrentCursorOffset();
    state.selectedId = visible[idx + 1].id;
    render();
  }
}

function selectPrev() {
  const visible = getVisibleNodes();
  if (visible.length === 0) return;
  const idx = visible.findIndex(n => n.id === state.selectedId);
  if (idx > 0) {
    saveCurrentText();
    state.cursorOffset = getCurrentCursorOffset();
    state.selectedId = visible[idx - 1].id;
    render();
  }
}

function openSearch() {
  state.isSearchOpen = true;
  state.searchQuery = '';
  const overlay = document.getElementById('search-overlay');
  overlay.classList.add('open');
  const input = document.getElementById('search-input');
  input.value = '';
  input.focus();
  document.getElementById('search-results').innerHTML = '';
}

function closeSearch() {
  state.isSearchOpen = false;
  state.searchQuery = '';
  document.getElementById('search-overlay').classList.remove('open');
}

function performSearch(query) {
  state.searchQuery = query;
  const resultsContainer = document.getElementById('search-results');
  if (!query.trim()) {
    resultsContainer.innerHTML = '';
    return;
  }

  const allNodes = [];
  function walk(node, depth) {
    allNodes.push({ ...node, _depth: depth });
    for (const child of node.children) walk(child, depth + 1);
  }
  for (const child of state.root.children) walk(child, 0);

  const q = query.toLowerCase();
  const matches = allNodes.filter(n => typeof n.data === 'string' && n.data.toLowerCase().includes(q));

  if (matches.length === 0) {
    resultsContainer.innerHTML = '<div class="search-empty">no matches</div>';
    return;
  }

   let html = '';
   for (const m of matches) {
     const path = getNodePath(m.id);
     const context = m._depth > 0 ? 'depth ' + m._depth : 'root';
     const displayText = typeof m.data === 'string' ? (m.data.length > 80 ? m.data.substring(0, 80) + '...' : m.data) : '';
     const formatted = formatNodeText(displayText, query);
     html += `<div class="search-result" data-id="${m.id}" tabindex="0">
       <span class="sr-depth">${m._depth}</span>
       <div class="sr-text">${formatted}<span class="sr-context">${context}</span></div>
     </div>`;
   }
   resultsContainer.innerHTML = html;
}

function toggleCheatsheet() {
  state.isCheatsheetOpen = !state.isCheatsheetOpen;
  document.getElementById('cheatsheet-overlay').classList.toggle('open', state.isCheatsheetOpen);
}

function parseMarkdown(text) {
  const lines = text.split('\n');
  const root = { id: state.nextId++, data: '', children: [], completed: false, collapsed: false, numbered: false };
  const stack = [{ node: root, indent: -1 }];

  for (const line of lines) {
    const match = line.match(/^(\s*)([-*])\s+\[([x ])\]\s+(.*)/);
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+\[([x ])\]\s+(.*)/);
    const simpleMatch = line.match(/^(\s*)([-*])\s+(.*)/);
    const simpleNumberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    
    if (!match && !numberedMatch && !simpleMatch && !simpleNumberedMatch) continue;

    let indent, completed, text, isNumbered = false;
    
    if (match) {
      indent = match[1].length / 2;
      completed = match[3].toLowerCase() === 'x';
      text = match[4];
    } else if (numberedMatch) {
      indent = numberedMatch[1].length / 2;
      completed = numberedMatch[3].toLowerCase() === 'x';
      text = numberedMatch[4];
      isNumbered = true;
    } else if (simpleMatch) {
      indent = simpleMatch[1].length / 2;
      completed = false;
      text = simpleMatch[3];
    } else if (simpleNumberedMatch) {
      indent = simpleNumberedMatch[1].length / 2;
      completed = false;
      text = simpleNumberedMatch[3];
      isNumbered = true;
    }

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const newNode = { id: state.nextId++, data: text, children: [], completed, collapsed: false, numbered: false };
    stack[stack.length - 1].node.children.push(newNode);
    
    // If the parent's last item is numbered and this is also numbered, mark parent as numbered
    if (isNumbered && stack[stack.length - 1].node.children.length === 1) {
      stack[stack.length - 1].node.numbered = true;
    }
    
    stack.push({ node: newNode, indent });
  }

  return root.children;
}

function parseJSON(text) {
  try {
    const data = JSON.parse(text);
    function restoreIds(node) {
      node.id = state.nextId++;
      node.completed = node.completed || false;
      node.collapsed = node.collapsed || false;
      node.numbered = node.numbered || false;
      // migrate old text/imageData to unified data
      if (typeof node.data === 'undefined') {
        if (typeof node.imageData !== 'undefined' && node.imageData) {
          node.data = { src: node.imageData };
          node.type = 'image';
        } else if (typeof node.text !== 'undefined') {
          node.data = node.text;
          node.type = 'text';
        } else {
          node.data = '';
        }
      }
      delete node.text;
      delete node.imageData;
      if (node.children) {
        for (const child of node.children) {
          restoreIds(child);
        }
      }
      return node;
    }
    if (Array.isArray(data)) {
      return data.map(restoreIds);
    } else {
      return [restoreIds(data)];
    }
  } catch (e) {
    return [];
  }
}

function parsePlainText(text) {
  const lines = text.split('\n');
  const root = { id: state.nextId++, data: '', children: [], completed: false, collapsed: false, numbered: false };
  const stack = [{ node: root, indent: -1 }];

  for (const line of lines) {
    if (!line.trim()) continue;
    
    const match = line.match(/^(\s*)~~(.+)~~$/);
    const simpleMatch = line.match(/^(\s*)(.+)$/);
    
    if (!simpleMatch) continue;

    const indentSpaces = simpleMatch[1].length;
    const indent = Math.floor(indentSpaces / 2);
    const completed = !!match;
    const text = match ? match[2] : simpleMatch[2];

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const newNode = { id: state.nextId++, data: text, children: [], completed, collapsed: false, numbered: false };
    stack[stack.length - 1].node.children.push(newNode);
    stack.push({ node: newNode, indent });
  }

  return root.children;
}

function openImport() {
  document.getElementById('import-overlay').classList.add('open');
  document.getElementById('import-mode-select').style.display = 'block';
  document.getElementById('import-file-input-section').style.display = 'none';
  document.getElementById('import-node-select').style.display = 'none';
}

function closeImport() {
  document.getElementById('import-overlay').classList.remove('open');
  if (importReplaceTimeout) {
    clearTimeout(importReplaceTimeout);
    importReplaceTimeout = null;
  }
}

function showImportNodeSelect() {
  const list = document.getElementById('import-node-list');
  const visibleNodes = getVisibleNodes();
  let html = '';
  for (const n of visibleNodes) {
    html += `<div class="import-node-item" data-id="${n.id}" tabindex="0">
      <span class="import-node-text">${escapeHtml(typeof n.data === 'string' ? n.data : 'untitled')}</span>
    </div>`;
  }
  list.innerHTML = html;
  document.getElementById('import-node-select').style.display = 'block';
}

function initCheatsheet() {
  const grid = document.querySelector('.cheatsheet-grid');
  for (const [key, desc] of KEYBINDS) {
    const item = document.createElement('div');
    item.className = 'cheatsheet-item';
    item.innerHTML = `<span class="cheatsheet-key">${key}</span><span class="cheatsheet-desc">${desc}</span>`;
    grid.appendChild(item);
  }
}

function init() {
  initCheatsheet();

  const outliner = document.getElementById('outliner');
  const searchInput = document.getElementById('search-input');
  const searchOverlay = document.getElementById('search-overlay');
  const cheatsheetOverlay = document.getElementById('cheatsheet-overlay');
  const breadcrumb = document.getElementById('breadcrumb');
  const menuBtn = document.getElementById('menu-btn');
  const menuDropdown = document.getElementById('menu-dropdown');
  const versionOverlay = document.getElementById('version-overlay');
  const versionClose = document.getElementById('version-close');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close');

  loadCurrent().then(saved => {
    if (saved) {
      if (detectOldData(saved.root)) {
        showToast('old indexedDB detected, auto clean? (y/n)', 5000);
        state._pendingCleanup = saved.root;
        state.root = { id: 0, data: '', children: [], completed: false, collapsed: false, numbered: false, type: 'text' };
        state.nextId = saved.nextId;
        state.selectedId = null;
        state.focusIds = [];
        state.hideCompleted = false;
        state.tagFilter = null;
        render();
        return;
      }
      state.root = saved.root;
      state.nextId = saved.nextId;
      state.selectedId = saved.selectedId;
      state.focusIds = saved.focusIds || [];
      state.hideCompleted = saved.hideCompleted || false;
      state.tagFilter = saved.tagFilter || null;
      state.noKeyboardMode = saved.noKeyboardMode || 'auto';
      state.fontFamily = saved.fontFamily || 'system-ui';
      state.screenWidth = saved.screenWidth || (saved.widescreen ? 'high' : 'normal');
      state.animateTransitions = saved.animateTransitions !== false;
      state.detectMarkdownPaste = saved.detectMarkdownPaste !== false;
      state.embeds = { ...state.embeds, ...(saved.embeds || {}) };
      state.linkTargets = saved.linkTargets || {};
      normalizeNode(state.root);
    }
  }).finally(() => {
    render();
    updateMenuIcon(state.hideCompleted);
    updateActionBar();
    updateTouchModeToggle();
    updateAppearance();
    updateToggle(animateToggle, state.animateTransitions);
    updateToggle(markdownPasteToggle, state.detectMarkdownPaste);
    updateEmbedToggles();
  });

  setInterval(() => {
    saveVersion({
      root: cloneNode(state.root),
      nextId: state.nextId,
      selectedId: state.selectedId,
      focusIds: [...state.focusIds],
    });
  }, 300000);

  outliner.addEventListener('click', (e) => {
    if (e.target.closest('#empty-state')) {
      createFirstNode('');
      return;
    }
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;

    const id = parseInt(nodeEl.dataset.id, 10);

    if (e.target.classList.contains('node-bullet')) {
      focusOnNode(id);
      return;
    }

    if (e.target.classList.contains('node-toggle')) {
      toggleCollapse(id);
      return;
    }

    const nodeLink = e.target.closest('.node-link');
    if (nodeLink) {
      const targetId = parseInt(nodeLink.dataset.linkId, 10);
      if (!Number.isNaN(targetId)) {
        focusOnNode(targetId);
      }
      return;
    }

    if (e.target.closest('.external-link')) return;

    if (e.target.classList.contains('node-image')) {
      if (state.selectedId === id) {
        openImageFullscreen(id);
      } else {
        selectNode(id, 0);
      }
      return;
    }

    if (e.target.classList.contains('node-text')) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString()) {
        const selectedNode = selection.anchorNode
          ? selection.anchorNode.parentElement?.closest('.node-text')
          : null;
        if (selectedNode === e.target) {
          return;
        }
      }

      const range = document.caretRangeFromPoint
        ? document.caretRangeFromPoint(e.clientX, e.clientY)
        : document.caretPositionFromPoint(e.clientX, e.clientY);
      const offset = range ? range.startOffset : 0;
      selectNode(id, offset);
      return;
    }

    const tagEl = e.target.closest('.tag');
    if (tagEl) {
      const tagText = tagEl.textContent;
      state.tagFilter = state.tagFilter === tagText ? null : tagText;
      render();
      return;
    }

    selectNode(id);
  });

  outliner.addEventListener('dblclick', (e) => {
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;
    const id = parseInt(nodeEl.dataset.id, 10);
    const node = getNode(id);
    if (node && node.children.length > 0) {
      toggleCollapse(id);
    }
   });

  document.addEventListener('keydown', (e) => {
    if (state._pendingCleanup) {
      if (e.key === 'y') {
        e.preventDefault();
        const oldRoot = state._pendingCleanup;
        state._pendingCleanup = null;
        state.root = oldRoot;
        normalizeNode(state.root);
        saveSnapshot();
        render();
        showToast('cleaned');
        return;
      } else if (e.key === 'n') {
        e.preventDefault();
        state._pendingCleanup = null;
        showToast('started fresh');
        render();
        return;
      }
      return;
    }

    if (state.isSearchOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        return;
      }
      return;
    }

    if (state.isCheatsheetOpen) {
      if (e.key === 'Escape' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        toggleCheatsheet();
        return;
      }
      return;
    }

    if (document.getElementById('confirm-overlay').classList.contains('open')) {
      if (e.key === 'y' || e.key === 'Enter' || e.key === 'Delete') {
        e.preventDefault();
        if (pendingDeleteId !== null) {
          removeNode(pendingDeleteId);
          pendingDeleteId = null;
        }
        document.getElementById('confirm-overlay').classList.remove('open');
      } else if (e.key === 'n' || e.key === 'Backspace' || e.key === 'Escape') {
        e.preventDefault();
        pendingDeleteId = null;
        document.getElementById('confirm-overlay').classList.remove('open');
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (linkSuggestionState && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      linkSuggestionState.selectedIndex = (linkSuggestionState.selectedIndex + direction + linkSuggestionState.suggestions.length) % linkSuggestionState.suggestions.length;
      document.querySelectorAll('.link-suggestion').forEach((item, index) => {
        item.classList.toggle('active', index === linkSuggestionState.selectedIndex);
      });
      return;
    }

    if (linkSuggestionState && e.key === 'Enter') {
      e.preventDefault();
      insertLinkSuggestion(linkSuggestionState.suggestions[linkSuggestionState.selectedIndex]);
      return;
    }

    if (linkSuggestionState && e.key === 'Escape') {
      e.preventDefault();
      hideLinkSuggestions();
      return;
    }

    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      saveCurrentText();
      const nextLevel = Math.min(state.selectAllLevel + 1, 3);
      selectNodesForLevel(nextLevel);
      return;
    }

    if (ctrl && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    if (ctrl && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      redo();
      return;
    }

    if (ctrl && e.key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }

    if (ctrl && e.key === 'j') {
      e.preventDefault();
      if (state.selectedId !== null) {
        toggleCollapse(state.selectedId);
      }
      return;
    }

    if (ctrl && e.key === 'e') {
      e.preventDefault();
      if (state.selectedId !== null) {
        toggleNumbering(state.selectedId);
      }
      return;
    }

    if (ctrl && e.key === 'l') {
      e.preventDefault();
      toggleComplete();
      return;
    }

    if (ctrl && e.key === ']') {
      e.preventDefault();
      zoomIn();
      return;
    }

    if (ctrl && e.key === '[') {
      e.preventDefault();
      zoomOut();
      return;
    }

    if (ctrl && e.key === '/') {
      e.preventDefault();
      toggleCheatsheet();
      return;
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveUp();
      return;
    }

    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveDown();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveCurrentText();
      const node = state.selectedId ? getNode(state.selectedId) : null;
      if (state.selectedId === null) {
        createFirstNode('');
      } else if (node && !node.collapsed && node.children.length > 0) {
        addChild();
      } else {
        addSibling('');
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        outdentNode();
      } else {
        indentNode();
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectPrev();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectNext();
      return;
    }

    if (ctrl && e.shiftKey && e.key === 'Backspace') {
      e.preventDefault();
      if (state.selectedId !== null) {
        deleteNode(state.selectedId);
      }
      return;
    }

    if (e.key === 'Backspace') {
      if (state.selectedId !== null) {
        const node = getNode(state.selectedId);
        const el = document.querySelector(`[data-id="${state.selectedId}"] .node-text`);
        const text = el ? el.textContent || '' : (node ? (typeof node.data === 'string' ? node.data : '') : '');

        if (text === '' || text.length === 0) {
          e.preventDefault();
          deleteNode(state.selectedId);
          return;
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      if (state.selectedId !== null) {
        saveCurrentText();
        state.selectedId = null;
        render();
      }
      return;
    }
  });

  searchInput.addEventListener('input', (e) => {
    performSearch(e.target.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const focusedResult = document.querySelector('.search-result:focus');
      if (focusedResult) {
        const id = parseInt(focusedResult.dataset.id, 10);
        const node = getNode(id);
        if (node) {
          const parent = findParent(id);
          closeSearch();
          if (parent && parent.id !== 0) {
            focusOnNode(parent.id);
          } else {
            selectNode(id);
          }
        }
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const results = Array.from(document.querySelectorAll('.search-result'));
      if (results.length === 0) return;
      const focusedResult = document.querySelector('.search-result:focus');
      if (!focusedResult) {
        results[0].focus();
      } else {
        const currentIdx = results.indexOf(focusedResult);
        const nextIdx = e.shiftKey ? (currentIdx - 1 + results.length) % results.length : (currentIdx + 1) % results.length;
        results[nextIdx].focus();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = document.querySelector('.search-result');
      if (first) first.focus();
    }
  });

  searchOverlay.addEventListener('click', (e) => {
    const result = e.target.closest('.search-result');
    if (result) {
      const id = parseInt(result.dataset.id, 10);
      closeSearch();
      selectNode(id);
      return;
    }
    if (e.target === searchOverlay) {
      closeSearch();
    }
  });

  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (el && el.id === 'view-title' && el.contentEditable === 'true') {
      if (synchronizeNodeLinks()) render();
      return;
    }
    if (el && el.classList && el.classList.contains('node-text') && el.contentEditable === 'true') {
      saveCurrentText();
      if (synchronizeNodeLinks()) render();
    }
  }, true);

  updateMenuIcon(state.hideCompleted);

  breadcrumb.addEventListener('click', (e) => {
    const item = e.target.closest('.bc-item');
    if (!item) return;
    const zoomTarget = item.dataset.zoom;
    if (zoomTarget) {
      zoomTo(zoomTarget);
    }
  });

  cheatsheetOverlay.addEventListener('click', (e) => {
    if (e.target === cheatsheetOverlay || e.target.closest('#cheatsheet-close')) {
      toggleCheatsheet();
    }
  });

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu-wrapper')) {
      menuDropdown.classList.remove('open');
    }
  });

    menuDropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      menuDropdown.classList.remove('open');
      if (action === 'global-search') {
        openSearch();
      } else if (action === 'toggle-hide-completed') {
        state.hideCompleted = !state.hideCompleted;
        updateMenuIcon(state.hideCompleted);
        render();
        if (state.selectedId !== null) restoreFocus();
        schedulePersist();
      } else if (action === 'collapse-all') {
        collapseAll();
        schedulePersist();
      } else if (action === 'expand-all') {
        expandAll();
        schedulePersist();
      } else if (action === 'sync') {
        openSync();
      } else if (action === 'settings') {
        openSettings();
      } else if (action === 'version-history') {
        openVersionHistory();
      }
    });

  versionOverlay.addEventListener('click', (e) => {
    if (e.target === versionOverlay) {
      closeVersionHistory();
    }
    const restoreBtn = e.target.closest('[data-action="restore-version"]');
    if (restoreBtn) {
      const versionId = parseInt(restoreBtn.dataset.versionId, 10);
      restoreVersionFromHistory(versionId);
    }
  });

  versionClose.addEventListener('click', closeVersionHistory);

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      closeSettings();
      return;
    }
    const btn = e.target.closest('.settings-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'import-file') {
      openImport();
    } else if (action === 'export-text') {
      downloadFile(exportPlainText(), 'stacknodes.txt', 'text/plain');
    } else if (action === 'export-markdown') {
      downloadFile(exportMarkdown(), 'stacknodes.md', 'text/markdown');
    } else if (action === 'export-json') {
      downloadFile(exportJSON(), 'stacknodes.json', 'application/json');
    }
  });

   settingsClose.addEventListener('click', closeSettings);

   const animateToggle = document.getElementById('animate-toggle');
   const markdownPasteToggle = document.getElementById('markdown-paste-toggle');
   const embedToggles = {
     youtube: document.getElementById('embed-youtube-toggle'),
     x: document.getElementById('embed-x-toggle'),
     instagram: document.getElementById('embed-instagram-toggle'),
   };
   function updateToggle(button, active) {
     if (button) button.classList.toggle('active', active);
   }
   function updateEmbedToggles() {
     Object.entries(embedToggles).forEach(([key, button]) => updateToggle(button, state.embeds[key]));
   }
   animateToggle.addEventListener('click', () => {
     state.animateTransitions = !state.animateTransitions;
     updateToggle(animateToggle, state.animateTransitions);
     schedulePersist();
   });
   markdownPasteToggle.addEventListener('click', () => {
     state.detectMarkdownPaste = !state.detectMarkdownPaste;
     updateToggle(markdownPasteToggle, state.detectMarkdownPaste);
     schedulePersist();
   });
   Object.entries(embedToggles).forEach(([key, button]) => {
     button.addEventListener('click', () => {
       state.embeds[key] = !state.embeds[key];
       updateToggle(button, state.embeds[key]);
       schedulePersist();
       render();
     });
   });
   updateToggle(animateToggle, state.animateTransitions);
   updateToggle(markdownPasteToggle, state.detectMarkdownPaste);
   updateEmbedToggles();

   const syncOverlay = document.getElementById('sync-overlay');
   const syncClose = document.getElementById('sync-close');
   const syncRoom = document.getElementById('sync-room');
   const syncSecret = document.getElementById('sync-secret');
   const syncStatus = document.getElementById('sync-status');
   const syncPushBtn = document.getElementById('sync-push');
   const syncPullBtn = document.getElementById('sync-pull');

   syncOverlay.addEventListener('click', (e) => {
     if (e.target === syncOverlay) {
       closeSync();
       return;
     }
   });

   syncClose.addEventListener('click', closeSync);

   syncPushBtn.addEventListener('click', async () => {
     const room = syncRoom.value.trim();
     const secret = syncSecret.value.trim();

     if (!room || !secret) {
       syncStatus.textContent = 'please enter room and secret';
       syncStatus.classList.add('error');
       syncStatus.classList.remove('success');
       return;
     }

     syncStatus.textContent = 'pushing...';
     syncStatus.classList.remove('error', 'success');
     syncPushBtn.disabled = true;
     syncPullBtn.disabled = true;

     try {
       const result = await SyncManager.pushToRoom(room, secret, state.root, (status) => {
         syncStatus.textContent = `pushing... (${status})`;
       });
       syncStatus.textContent = result.message;
       syncStatus.classList.add('success');
       syncStatus.classList.remove('error');
       showToast('push successful');
     } catch (error) {
       syncStatus.textContent = `error: ${error.message}`;
       syncStatus.classList.add('error');
       syncStatus.classList.remove('success');
       showToast(`push failed: ${error.message}`);
     } finally {
       syncPushBtn.disabled = false;
       syncPullBtn.disabled = false;
     }
   });

   syncPullBtn.addEventListener('click', async () => {
     const room = syncRoom.value.trim();
     const secret = syncSecret.value.trim();
     const replaceRoot = document.getElementById('sync-replace-root').checked;

     if (!room || !secret) {
       syncStatus.textContent = 'please enter room and secret';
       syncStatus.classList.add('error');
       syncStatus.classList.remove('success');
       return;
     }

     syncStatus.textContent = 'pulling...';
     syncStatus.classList.remove('error', 'success');
     syncPushBtn.disabled = true;
     syncPullBtn.disabled = true;

     try {
       const result = await SyncManager.pullFromRoom(room, secret, (status) => {
         syncStatus.textContent = `pulling... (${status})`;
       });
       
       if (replaceRoot) {
         // replace root node with pulled data
         if (Array.isArray(result.data)) {
           state.root.children = result.data;
         } else if (result.data.children) {
           state.root.children = result.data.children;
         } else {
           state.root.children = [result.data];
         }
         showToast('root node replaced');
       } else {
         // create a sync node with the pulled data
          const syncNode = {
            id: state.nextId++,
            data: '{SYNC}',
            children: Array.isArray(result.data) ? result.data : (result.data.children || [result.data]),
            completed: false,
            collapsed: false,
            numbered: false,
            type: 'text'
         };
         
         state.root.children.push(syncNode);
         showToast('pull successful - added {SYNC} node');
       }
       
       saveSnapshot();
       render();
       
       syncStatus.textContent = result.message;
       syncStatus.classList.add('success');
       syncStatus.classList.remove('error');
     } catch (error) {
       syncStatus.textContent = `error: ${error.message}`;
       syncStatus.classList.add('error');
       syncStatus.classList.remove('success');
       showToast(`pull failed: ${error.message}`);
     } finally {
       syncPushBtn.disabled = false;
       syncPullBtn.disabled = false;
     }
   });

   const touchModeToggle = document.getElementById('touch-mode-toggle');
  if (touchModeToggle) {
    touchModeToggle.addEventListener('click', () => {
      state.noKeyboardMode = state.noKeyboardMode === 'yes' ? 'no' : 'yes';
      updateTouchModeToggle();
      updateActionBar();
      schedulePersist();
    });
  }

  const fontSelect = document.getElementById('font-select');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      state.fontFamily = fontSelect.value;
      updateAppearance();
      schedulePersist();
    });
  }

  const screenWidthSelect = document.getElementById('screen-width-select');
  if (screenWidthSelect) {
    screenWidthSelect.addEventListener('change', () => {
      state.screenWidth = screenWidthSelect.value;
      updateAppearance();
      schedulePersist();
    });
  }

  const actionBar = document.getElementById('action-bar');
  actionBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    
    switch (action) {
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'indent':
        indentNode();
        break;
      case 'unindent':
        outdentNode();
        break;
      case 'toggle-complete':
        toggleComplete();
        break;
      case 'toggle-numbering':
        if (state.selectedId !== null) {
          toggleNumbering(state.selectedId);
        }
        break;
    }
  });

  const importOverlay = document.getElementById('import-overlay');
  const importFileInput = document.getElementById('import-file-input');
  const importClose = document.getElementById('import-close');
  let importMode = null;
  let importedNodes = null;
  let importReplaceTimeout = null;

  importOverlay.addEventListener('click', (e) => {
    if (e.target === importOverlay) {
      closeImport();
      return;
    }

    const modeBtn = e.target.closest('#import-mode-select button');
    if (modeBtn) {
      importMode = modeBtn.dataset.mode;
      document.getElementById('import-mode-select').style.display = 'none';
      document.getElementById('import-file-input-section').style.display = 'block';
      importFileInput.click();
      return;
    }

    const nodeItem = e.target.closest('.import-node-item');
    if (nodeItem && importedNodes) {
      const selectedId = parseInt(nodeItem.dataset.id, 10);
      const targetNode = getNode(selectedId);
      if (targetNode) {
        targetNode.children.push(...importedNodes);
        saveSnapshot();
        render();
        closeImport();
        closeSettings();
      }
      return;
    }
  });

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
      document.getElementById('import-mode-select').style.display = 'block';
      document.getElementById('import-file-input-section').style.display = 'none';
      return;
    }

    const text = await file.text();
    const extension = file.name.split('.').pop().toLowerCase();

    let nodes = [];
    if (extension === 'json') {
      nodes = parseJSON(text);
    } else if (extension === 'md') {
      nodes = parseMarkdown(text);
    } else if (extension === 'txt') {
      nodes = parsePlainText(text);
    }

    if (nodes.length === 0) {
      alert('failed to parse file');
      closeImport();
      return;
    }

    if (importMode === 'replace') {
      showToast('will replace root in 5 seconds...', 5000);
      importReplaceTimeout = setTimeout(() => {
        importReplaceTimeout = null;
        state.root.children = nodes;
        saveSnapshot();
        render();
        closeImport();
        closeSettings();
      }, 5000);
    } else {
      importedNodes = nodes;
      document.getElementById('import-file-input-section').style.display = 'none';
      showImportNodeSelect();
    }
  });

  importClose.addEventListener('click', closeImport);

  document.addEventListener('paste', (e) => {
    const el = e.target.closest ? e.target.closest('.node-text') : null;
    if (!el || !outliner.contains(el)) return;

    e.preventDefault();
    e.stopPropagation();

    // Capture the complete paste payload before changing the editor or selection.
    const pasteBuffer = e.clipboardData
      ? e.clipboardData.getData('text/plain')
      : '';
    const nodeEl = el.closest('.node');
    const targetId = nodeEl ? parseInt(nodeEl.dataset.id, 10) : state.selectedId;
    if (!pasteBuffer || targetId === null || Number.isNaN(targetId)) return;

    saveCurrentText();
    insertPastedNodes(pasteBuffer, targetId, 'after');
  }, true);

  outliner.addEventListener('cut', (e) => {
    const el = e.target;
    if (!el || !el.classList.contains('node-text')) return;
    setTimeout(() => {
      saveCurrentText();
      schedulePersist();
    }, 0);
  }, true);

  outliner.addEventListener('copy', (e) => {
    const el = e.target;
    if (!el || !el.classList.contains('node-text')) return;
    saveCurrentText();
  }, true);

  document.addEventListener('copy', (e) => {
    if (state.selectedNodeIds.length === 0 || !e.clipboardData) return;
    e.preventDefault();
    clipboardText = serializeSelectedNodes();
    e.clipboardData.setData('text/plain', clipboardText);
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.id === 'view-title' && el.contentEditable === 'true') {
      const node = getNode(parseInt(el.dataset.nodeId, 10));
      if (node) {
        node.data = el.textContent || '';
        schedulePersist();
      }
      return;
    }

    if (el && el.classList.contains('node-text') && el.contentEditable === 'true') {
      const nodeEl = el.closest('.node');
      if (nodeEl) {
        const id = parseInt(nodeEl.dataset.id, 10);
        if (id === state.selectedId) {
          const node = getNode(state.selectedId);
          if (node) {
      node.data = el.textContent || '';
          }
          const sel = window.getSelection();
          state.cursorOffset = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startOffset : 0;
          schedulePersist();
          updateLinkSuggestions(el, id);
        }
      }
     }
    }, true);

  document.getElementById('link-suggestions').addEventListener('mousedown', (e) => {
    const item = e.target.closest('.link-suggestion');
    if (!item) return;
    e.preventDefault();
    const suggestion = getNode(parseInt(item.dataset.nodeId, 10));
    if (suggestion) insertLinkSuggestion(suggestion);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.id !== 'view-title') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });

  /* mobile keyboard handling */
  if (typeof visualViewport !== 'undefined') {
    visualViewport.addEventListener('resize', () => {
      const app = document.getElementById('app');
      if (app) {
        app.style.height = window.innerHeight + 'px';
      }
    });
  }

  /* prevent topbar/action-bar from being hidden by mobile keyboard */
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      setTimeout(() => {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, true);

  /* context menu (right-click) */
  const contextMenu = document.getElementById('context-menu');
  let contextMenuTargetId = null;

  outliner.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;

    contextMenuTargetId = parseInt(nodeEl.dataset.id, 10);
    if (!contextMenuTargetId) return;

    // position the menu within viewport
    const menuWidth = 180;
    const menuHeight = 320;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    contextMenu.style.left = Math.max(0, x) + 'px';
    contextMenu.style.top = Math.max(0, y) + 'px';
    contextMenu.classList.add('open');
  });

  contextMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.context-menu-item');
    if (!btn || contextMenuTargetId === null) return;

    const action = btn.dataset.action;
    state.selectedId = contextMenuTargetId;

    switch (action) {
      case 'ctx-delete':
        deleteNode(contextMenuTargetId);
        break;
      case 'ctx-toggle-complete':
        toggleComplete();
        break;
      case 'ctx-collapse-toggle':
        toggleCollapse(contextMenuTargetId);
        break;
      case 'ctx-indent':
        indentNode();
        break;
      case 'ctx-unindent':
        outdentNode();
        break;
      case 'ctx-copy':
        copyNode(contextMenuTargetId);
        break;
      case 'ctx-paste-under':
        pasteNodeUnder(contextMenuTargetId);
        break;
      case 'ctx-paste-above':
        pasteNodeAbove(contextMenuTargetId);
        break;
      case 'ctx-select':
        selectNode(contextMenuTargetId, 0);
        break;
      case 'ctx-convert-to':
        showConvertSubmenu();
        return; // Don't close menu
      case 'ctx-convert-text':
        convertNodeToText(contextMenuTargetId);
        break;
      case 'ctx-convert-image':
        contextMenu.classList.remove('open');
        hideConvertSubmenu();
        convertNodeToImage(contextMenuTargetId);
        return;
    }

    contextMenu.classList.remove('open');
    contextMenuTargetId = null;
    hideConvertSubmenu();
    render();
  });

  // close context menu on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
      contextMenu.classList.remove('open');
      hideConvertSubmenu();
    }
  });

  /* image upload handlers */
  const imageUploadOverlay = document.getElementById('image-upload-overlay');
  const imageFileInput = document.getElementById('image-file-input');
  const imageDropZone = document.getElementById('image-upload-drop-zone');
  const imageUploadClose = document.getElementById('image-upload-close');
  const imageFullscreenOverlay = document.getElementById('image-fullscreen-overlay');
  const imageFullscreenDownload = document.getElementById('image-fullscreen-download');
  const imageFullscreenReplace = document.getElementById('image-fullscreen-replace');
  const imageFullscreenClose = document.getElementById('image-fullscreen-close');

  // image upload handlers
  imageDropZone.addEventListener('click', () => {
    imageFileInput.click();
  });

  imageDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageDropZone.classList.add('dragover');
  });

  imageDropZone.addEventListener('dragleave', () => {
    imageDropZone.classList.remove('dragover');
  });

  imageDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    imageDropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (pendingImageConvertNodeId !== null) {
          setNodeImage(pendingImageConvertNodeId, event.target.result);
        }
      };
      reader.readAsDataURL(files[0]);
    }
  });

  imageFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (pendingImageConvertNodeId !== null) {
          setNodeImage(pendingImageConvertNodeId, event.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  });

  imageUploadClose.addEventListener('click', closeImageUpload);

  imageUploadOverlay.addEventListener('click', (e) => {
    if (e.target === imageUploadOverlay) {
      closeImageUpload();
    }
  });

  // fullscreen image handlers
  imageFullscreenClose.addEventListener('click', closeImageFullscreen);

  imageFullscreenDownload.addEventListener('click', () => {
    const nodeId = parseInt(imageFullscreenOverlay.dataset.nodeId, 10);
    downloadImage(nodeId);
  });

  imageFullscreenReplace.addEventListener('click', () => {
    const nodeId = parseInt(imageFullscreenOverlay.dataset.nodeId, 10);
    closeImageFullscreen();
    replaceImage(nodeId);
  });

  imageFullscreenOverlay.addEventListener('click', (e) => {
    if (e.target === imageFullscreenOverlay) {
      closeImageFullscreen();
    }
  });

  // window controls (tauri only)
  if (window.__TAURI_INTERNALS__) {
    const invoke = window.__TAURI_INTERNALS__.invoke;

    const wc = document.createElement('div');
    wc.id = 'wc';
    wc.innerHTML = `
      <button id="wc-minimize" class="std-tooltip std-tooltip-bottom" tooltip="Minimize" aria-label="Minimize"><i class="fa-solid fa-minus"></i></button>
      <button id="wc-maximize" class="std-tooltip std-tooltip-bottom" tooltip="Maximize" aria-label="Maximize"><i class="fa-solid fa-square"></i></button>
      <button id="wc-close" class="std-tooltip std-tooltip-bottom" tooltip="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    `;
    document.body.appendChild(wc);

    const style = document.createElement('style');
    style.textContent = `
      #wc {
        position: fixed; top: 0; left: 4px; z-index: 999;
        display: flex; gap: 2px; padding: 4px;
        background: rgba(26,26,26,0.7);
        border-radius: 0 0 6px 6px;
        border: 1px solid #2e2b22; border-top: none;
      }
      #wc button {
        background: none; border: none; color: #7a7668;
        width: 32px; height: 22px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; border-radius: 4px;
        transition: background 0.1s, color 0.1s;
      }
      #wc button:hover { background: #2e2b22; color: #d4d0c4; }
      #wc-close:hover { background: #c03a2b !important; color: #fff !important; }
    `;
    document.head.appendChild(style);

    document.getElementById('wc-minimize').addEventListener('click', () => invoke('plugin:window|minimize'));
    document.getElementById('wc-maximize').addEventListener('click', () => invoke('plugin:window|toggle_maximize'));
    document.getElementById('wc-close').addEventListener('click', () => invoke('plugin:window|close'));
  }
}


document.addEventListener('DOMContentLoaded', init);
