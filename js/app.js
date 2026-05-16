// ===== Screen Navigation =====
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + name);
  if (target) target.classList.add('active');

  // Hide overlays when switching
  hidePopover();
  const ttsCtrl = document.getElementById('tts-controls');
  if (!ttsCtrl.classList.contains('hidden')) ttsCtrl.classList.add('hidden');
}

// ===== Library =====
function generateId() {
  return 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

async function processEpubFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const id = generateId();
  const title = file.name.replace(/\.epub$/i, '');

  // Save immediately with filename as title
  const bookData = {
    id,
    title,
    author: 'Unknown',
    cover: null,
    file: arrayBuffer,
    fileName: file.name,
    addedAt: Date.now()
  };

  await saveBook(bookData);

  // Try to update metadata in background (best effort, don't throw)
  tryUpdateMetadata(id, arrayBuffer);

  return bookData;
}

async function tryUpdateMetadata(id, arrayBuffer) {
  try {
    var epub = await parseEpub(arrayBuffer);
    var updates = {};
    if (epub.title) updates.title = epub.title;
    if (epub.creator) updates.author = epub.creator;

    if (Object.keys(updates).length > 0) {
      var current = await getBook(id);
      if (current) {
        Object.assign(current, updates);
        await saveBook(current);
        refreshLibrary();
      }
    }
  } catch (e) {
    // Best effort
  }
}

async function refreshLibrary() {
  const books = await getAllBooks();
  const grid = document.getElementById('book-grid');

  if (books.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <p>还没有书籍</p>
      <p>点击上方按钮添加 EPUB 书籍</p>
    </div>`;
    return;
  }

  grid.innerHTML = books.map(book => `
    <div class="book-card" data-id="${book.id}">
      <div class="book-cover">
        ${book.cover
          ? `<img src="${book.cover}" alt="" style="width:100%;height:100%;object-fit:cover;">`
          : `<span>${book.title.substring(0, 20)}</span>`
        }
      </div>
      <div class="book-info">
        <div class="book-title">${book.title}</div>
        <div class="book-author">${book.author}</div>
      </div>
    </div>
  `).join('');

  // Click to open
  grid.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', () => {
      openReader(card.dataset.id);
    });

    // Long press for context menu
    let pressTimer;
    card.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        showBookContextMenu(card.dataset.id, e);
      }, 600);
    });
    card.addEventListener('touchend', () => clearTimeout(pressTimer));
    card.addEventListener('touchmove', () => clearTimeout(pressTimer));
  });
}

function showBookContextMenu(bookId, e) {
  // Remove existing
  document.querySelectorAll('.context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button class="danger" data-action="delete">删除此书</button>
  `;
  menu.style.top = e.touches[0].clientY + 'px';
  menu.style.left = Math.min(e.touches[0].clientX, window.innerWidth - 140) + 'px';

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    await deleteBook(bookId);
    menu.remove();
    refreshLibrary();
    showToast('已删除');
  });

  document.body.appendChild(menu);

  // Close on tap elsewhere
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('touchstart', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('touchstart', closeMenu), 100);
}

// ===== File Upload =====
document.getElementById('file-upload').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  if (typeof JSZip === 'undefined') {
    showToast('组件未加载，请检查网络后刷新页面');
    return;
  }

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      showToast('仅支持 EPUB 格式');
      continue;
    }
    showToast('处理中...');
    try {
      await processEpubFile(file);
      refreshLibrary();
      showToast('添加成功');
    } catch (err) {
      console.error('Process error:', err);
      const msg = err && err.message ? err.message : String(err);
      showToast('失败: ' + msg);
    }
  }

  e.target.value = '';
});

// ===== Global event handlers =====
document.getElementById('overlay').addEventListener('click', hidePopover);
document.getElementById('popover-close').addEventListener('click', hidePopover);

document.getElementById('btn-nav-vocab').addEventListener('click', () => {
  switchScreen('vocabulary');
  loadVocabulary();
});

// ===== Init =====
function initApp() {
  openDB().then(() => {
    refreshLibrary();
  });

  initTTS();
  setupVocabularyScreen();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', initApp);
