function exportPlainText() {
  const hasImages = hasImageNodes(state.root);
  if (hasImages) {
    showToast('warning: image nodes will not be included in plain text export', 3000);
  }

  let result = '';
  function walk(node, depth, parentNumbered, siblingIndex) {
    if (node.id === 0) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth, false, i + 1);
      }
      return;
    }
    const prefix = '  '.repeat(depth);
    let bullet = '-';
    if (parentNumbered) {
      bullet = siblingIndex + '.';
    }
    let text = typeof node.data === 'string' ? node.data : '[image]';
    text = node.completed ? `~~${text}~~` : text;
    result += prefix + bullet + ' ' + text + '\n';
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], depth + 1, node.numbered, i + 1);
    }
  }
  for (let i = 0; i < state.root.children.length; i++) {
    walk(state.root.children[i], 0, false, i + 1);
  }
  return result;
}

function exportMarkdown() {
  const hasImages = hasImageNodes(state.root);
  if (hasImages) {
    showToast('warning: image nodes will not be included in markdown export', 3000);
  }

  let result = '';
  function walk(node, depth, parentNumbered, siblingIndex) {
    if (node.id === 0) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth, false, i + 1);
      }
      return;
    }
    const checkbox = node.completed ? '[x] ' : '[ ] ';
    let bullet = '-';
    if (parentNumbered) {
      bullet = siblingIndex + '.';
    }
    const prefix = depth === 0 ? bullet + ' ' : '  '.repeat(depth) + bullet + ' ';
    const text = typeof node.data === 'string' ? node.data : '[image]';
    result += prefix + checkbox + text + '\n';
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], depth + 1, node.numbered, i + 1);
    }
  }
  for (let i = 0; i < state.root.children.length; i++) {
    walk(state.root.children[i], 0, false, i + 1);
  }
  return result;
}

function exportJSON() {
  function serialize(node) {
    return {
      data: node.data,
      completed: node.completed,
      collapsed: node.collapsed,
      numbered: node.numbered,
      type: node.type || 'text',
      children: node.children.map(serialize),
    };
  }
  return JSON.stringify(state.root.children.map(serialize), null, 2);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasImageNodes(node) {
  if (node.type === 'image') return true;
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (hasImageNodes(child)) return true;
    }
  }
  return false;
}
