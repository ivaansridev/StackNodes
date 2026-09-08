let pendingImageConvertNodeId = null;

function convertNodeToImage(nodeId) {
  pendingImageConvertNodeId = nodeId;
  document.getElementById('image-upload-overlay').classList.add('open');
}

function convertNodeToText(nodeId) {
  const node = getNode(nodeId);
  if (!node) return;

  node.type = 'text';
  node.data = '';
  saveSnapshot();
  render();
  showToast('converted to text');
}

function showConvertSubmenu() {
  document.getElementById('context-menu-convert-submenu').style.display = 'block';
}

function hideConvertSubmenu() {
  document.getElementById('context-menu-convert-submenu').style.display = 'none';
}

function setNodeImage(nodeId, imageData) {
  const node = getNode(nodeId);
  if (!node) return;

  node.type = 'image';
  node.data = { src: imageData };
  saveSnapshot();
  render();
  closeImageUpload();
  showToast('image added');
}

function closeImageUpload() {
  document.getElementById('image-upload-overlay').classList.remove('open');
  pendingImageConvertNodeId = null;
}

function openImageFullscreen(nodeId) {
  const node = getNode(nodeId);
  if (!node || typeof node.data !== 'object') return;

  document.getElementById('fullscreen-image').src = node.data.src;
  document.getElementById('image-fullscreen-overlay').classList.add('open');
  document.getElementById('image-fullscreen-overlay').dataset.nodeId = nodeId;
}

function closeImageFullscreen() {
  document.getElementById('image-fullscreen-overlay').classList.remove('open');
  document.getElementById('image-fullscreen-overlay').dataset.nodeId = '';
}

function downloadImage(nodeId) {
  const node = getNode(nodeId);
  if (!node || typeof node.data !== 'object') return;

  const link = document.createElement('a');
  link.href = node.data.src;
  link.download = 'image.png';
  link.click();
}

function replaceImage(nodeId) {
  pendingImageConvertNodeId = nodeId;
  document.getElementById('image-file-input').click();
}
