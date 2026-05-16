let currentBook = null;
let currentRendition = null;
let currentBookId = null;
let fontSize = 100;

function openReader(bookId) {
  currentBookId = bookId;
  getBook(bookId).then(book => {
    if (!book) { showToast('书籍加载失败'); return; }
    currentBook = book;
    document.getElementById('reader-title').textContent = book.title || '阅读';
    switchScreen('reader');

    const content = document.getElementById('reader-content');
    content.innerHTML = '';

    const blob = new Blob([book.file], { type: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);

    const epub = ePub(url);
    const rendition = epub.renderTo(content, {
      width: content.clientWidth,
      height: content.clientHeight,
      spread: 'none',
      flow: 'paginated',
      manager: 'default'
    });

    currentRendition = rendition;

    rendition.display().then(() => {
      injectReaderResources();
      updateProgress();
    });

    rendition.on('relocated', () => {
      updateProgress();
      injectReaderResources();
    });

    setupSwipeNavigation(content);
    recalcOnResize(content);
  });
}

// Listen for word-tap messages from iframe
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'word-tap') {
    const word = e.data.word;
    if (word && isEnglishWord(word)) {
      lookupWord(word).then(result => {
        if (result && (result.definitions.length > 0 || result.phonetic)) {
          showPopover(result);
        }
      });
    }
  }
});

function injectReaderResources() {
  const iframe = document.querySelector('#reader-content iframe');
  if (!iframe || !iframe.contentDocument) return;

  const doc = iframe.contentDocument;

  // Inject CSS
  let style = doc.getElementById('qingdu-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'qingdu-style';
    doc.head.appendChild(style);
  }
  style.textContent = `
    body {
      font-family: Georgia, "Times New Roman", "Noto Serif SC", serif !important;
      font-size: ${fontSize}% !important;
      line-height: 1.8 !important;
      padding: 16px 20px !important;
      color: #1a1a1a !important;
      background: #fff !important;
      -webkit-text-size-adjust: 100% !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    p { margin-bottom: 0.8em; }
    img { max-width: 100%; height: auto; }
    .tts-highlight {
      background: rgba(79, 70, 229, 0.12) !important;
      border-radius: 2px !important;
      transition: background 0.2s !important;
    }
  `;

  // Inject word-tap script
  if (!doc.getElementById('qingdu-tap')) {
    const script = doc.createElement('script');
    script.id = 'qingdu-tap';
    script.textContent = `
      (function() {
        var touchStartX = 0, touchStartY = 0;
        var touchStartTime = 0;
        var moved = false;

        document.addEventListener('touchstart', function(e) {
          if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            moved = false;
          }
        }, { passive: true });

        document.addEventListener('touchmove', function(e) {
          if (e.touches.length === 1) {
            var dx = e.touches[0].clientX - touchStartX;
            var dy = e.touches[0].clientY - touchStartY;
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
              moved = true;
            }
          }
        }, { passive: true });

        document.addEventListener('touchend', function(e) {
          var dt = Date.now() - touchStartTime;
          if (moved || dt > 400) return;

          var x = e.changedTouches[0].clientX;
          var y = e.changedTouches[0].clientY;

          var range;
          if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
          } else if (document.caretPositionFromPoint) {
            var pos = document.caretPositionFromPoint(x, y);
            if (pos) {
              range = document.createRange();
              range.setStart(pos.offsetNode, pos.offset);
              range.setEnd(pos.offsetNode, pos.offset);
            }
          }

          if (!range || !range.startContainer) return;
          var node = range.startContainer;
          if (node.nodeType !== Node.TEXT_NODE) return;

          var text = node.textContent;
          var offset = range.startOffset;

          // Expand to word boundaries
          var start = offset, end = offset;
          while (start > 0 && /[a-zA-Z]/.test(text[start - 1])) start--;
          while (end < text.length && /[a-zA-Z]/.test(text[end])) end++;

          var word = text.slice(start, end);
          if (word.length > 1 && /^[a-zA-Z]+$/.test(word)) {
            window.parent.postMessage({
              type: 'word-tap',
              word: word.toLowerCase()
            }, '*');
          }
        });
      })();
    `;
    doc.body.appendChild(script);
  }
}

function setupSwipeNavigation(container) {
  let touchStartX = 0;
  let touchStartY = 0;

  container.addEventListener('touchstart', (e) => {
    if (e.target.closest('.popover') || e.target.closest('#tts-controls')) return;
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (e.target.closest('.popover') || e.target.closest('#tts-controls')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) {
        currentRendition && currentRendition.next();
      } else {
        currentRendition && currentRendition.prev();
      }
    }
  });
}

function recalcOnResize(container) {
  window.addEventListener('resize', () => {
    if (currentRendition && container.clientWidth > 0) {
      currentRendition.resize(container.clientWidth, container.clientHeight);
    }
  });
}

function updateProgress() {
  if (!currentRendition) return;
  const loc = currentRendition.currentLocation();
  if (!loc || !loc.start) return;
  const book = currentRendition.book;
  if (book.locations && book.locations.total) {
    const pct = Math.round((loc.start.index / book.locations.total) * 100);
    document.getElementById('reader-progress').textContent = pct + '%';
  }
}

function changeFontSize(delta) {
  fontSize = Math.max(60, Math.min(200, fontSize + delta));
  injectReaderResources();
}

function closeReader() {
  if (currentRendition) {
    currentRendition.destroy();
    currentRendition = null;
  }
  currentBook = null;
  currentBookId = null;
  stopTTS();
}

document.getElementById('btn-font-up').addEventListener('click', () => changeFontSize(10));
document.getElementById('btn-font-down').addEventListener('click', () => changeFontSize(-10));
document.getElementById('btn-tts-toggle').addEventListener('click', toggleTTSControls);

document.getElementById('btn-reader-back').addEventListener('click', () => {
  closeReader();
  switchScreen('library');
  refreshLibrary();
});
