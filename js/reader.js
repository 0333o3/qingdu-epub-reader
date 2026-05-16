let currentBook = null;
let currentRendition = null;
let currentBookId = null;
let fontSize = 100;
let currentEpubUrl = null;

function openReader(bookId) {
  currentBookId = bookId;
  getBook(bookId).then(book => {
    if (!book || !book.file) { showToast('书籍数据异常'); return; }
    currentBook = book;
    document.getElementById('reader-title').textContent = book.title || '阅读';
    switchScreen('reader');

    const content = document.getElementById('reader-content');
    content.textContent = '';

    // Small delay to ensure screen is visible and has dimensions
    setTimeout(() => {
      initRendition(content, book);
    }, 100);
  }).catch(err => {
    console.error('getBook error:', err);
    showToast('书籍加载失败');
  });
}

function initRendition(content, book) {
  if (typeof ePub === 'undefined') {
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;">epub.js 未加载<br>请检查网络后刷新</div>';
    return;
  }

  const w = Math.max(content.clientWidth, window.innerWidth, 320);
  const h = Math.max(content.clientHeight, window.innerHeight - 100, 400);

  content.innerHTML = '';

  // Clean up previous blob URL
  if (currentEpubUrl) { URL.revokeObjectURL(currentEpubUrl); }

  const blob = new Blob([book.file], { type: 'application/epub+zip' });
  currentEpubUrl = URL.createObjectURL(blob);

  try {
    const epub = ePub(currentEpubUrl);
    const rendition = epub.renderTo(content, {
      width: w,
      height: h,
      spread: 'none',
      flow: 'scrolled',
      manager: 'default'
    });

    currentRendition = rendition;

    rendition.display().then(function() {
      injectReaderResources();
      updateProgress();
      setupIframeTouch(content);
    }).catch(function(err) {
      console.error('Display error:', err);
      showError(content, '无法渲染此书籍，可能是 EPUB 格式不兼容');
    });

    rendition.on('relocated', function(loc) {
      updateProgress();
      injectReaderResources();
    });

  } catch (err) {
    console.error('Init error:', err);
    showError(content, '初始化失败');
  }
}

function showError(content, msg) {
  content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#ef4444;font-size:14px;text-align:center;padding:20px;">' + msg + '</div>';
}

// Listen for word-tap messages from iframe
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'word-tap') {
    var word = e.data.word;
    if (word && isEnglishWord(word)) {
      lookupWord(word).then(function(result) {
        if (result && (result.definitions.length > 0 || result.phonetic)) {
          showPopover(result);
        }
      });
    }
  }
});

function setupIframeTouch(content) {
  var iframe = content.querySelector('iframe');
  if (!iframe) return;

  // Try to access iframe content for word tap detection
  try {
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    if (doc && doc.body && !doc.getElementById('qingdu-tap')) {
      injectReaderResources();
    }
  } catch (e) {
    // Cross-origin iframe - can't inject
  }
}

function injectReaderResources() {
  var iframe = document.querySelector('#reader-content iframe');
  if (!iframe) return;

  var doc;
  try {
    doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc || !doc.body) return;
  } catch (e) {
    return;
  }

  // Inject CSS
  var style = doc.getElementById('qingdu-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'qingdu-style';
    doc.head.appendChild(style);
  }
  style.textContent = [
    'body {',
    '  font-family: Georgia, "Times New Roman", "Noto Serif SC", serif !important;',
    '  font-size: ' + fontSize + '% !important;',
    '  line-height: 1.8 !important;',
    '  padding: 16px 20px !important;',
    '  color: #1a1a1a !important;',
    '  background: #fff !important;',
    '  -webkit-text-size-adjust: 100% !important;',
    '  -webkit-tap-highlight-color: transparent !important;',
    '  max-width: 100% !important;',
    '  word-wrap: break-word !important;',
    '}',
    'p { margin-bottom: 0.8em; }',
    'img { max-width: 100% !important; height: auto !important; }',
    '.tts-highlight { background: rgba(79, 70, 229, 0.12) !important; border-radius: 2px !important; }'
  ].join('\n');

  // Inject word-tap script
  if (!doc.getElementById('qingdu-tap')) {
    var script = doc.createElement('script');
    script.id = 'qingdu-tap';
    script.textContent = [
      '(function() {',
      '  var sx = 0, sy = 0, st = 0, moved = false;',
      '  document.addEventListener("touchstart", function(e) {',
      '    if (e.touches.length === 1) {',
      '      sx = e.touches[0].clientX; sy = e.touches[0].clientY;',
      '      st = Date.now(); moved = false;',
      '    }',
      '  }, { passive: true });',
      '  document.addEventListener("touchmove", function(e) {',
      '    if (Math.abs(e.touches[0].clientX - sx) > 8 ||',
      '        Math.abs(e.touches[0].clientY - sy) > 8) moved = true;',
      '  }, { passive: true });',
      '  document.addEventListener("touchend", function(e) {',
      '    if (moved || (Date.now() - st) > 400) return;',
      '    var x = e.changedTouches[0].clientX;',
      '    var y = e.changedTouches[0].clientY;',
      '    var range;',
      '    if (document.caretRangeFromPoint) {',
      '      range = document.caretRangeFromPoint(x, y);',
      '    } else if (document.caretPositionFromPoint) {',
      '      var pos = document.caretPositionFromPoint(x, y);',
      '      if (pos) { range = document.createRange();',
      '        range.setStart(pos.offsetNode, pos.offset);',
      '        range.setEnd(pos.offsetNode, pos.offset); }',
      '    }',
      '    if (!range || !range.startContainer) return;',
      '    var node = range.startContainer;',
      '    if (node.nodeType !== 3) return;',
      '    var text = node.textContent;',
      '    var o = range.startOffset, s = o, e2 = o;',
      '    while (s > 0 && /[a-zA-Z]/.test(text[s-1])) s--;',
      '    while (e2 < text.length && /[a-zA-Z]/.test(text[e2])) e2++;',
      '    var word = text.slice(s, e2);',
      '    if (word.length > 1 && /^[a-zA-Z]+$/.test(word)) {',
      '      window.parent.postMessage({type:"word-tap",word:word.toLowerCase()}, "*");',
      '    }',
      '  });',
      '})();'
    ].join('\n');
    doc.body.appendChild(script);
  }
}

function updateProgress() {
  if (!currentRendition) return;
  try {
    var loc = currentRendition.currentLocation();
    if (loc && loc.start && currentRendition.book.locations) {
      var total = currentRendition.book.locations.total;
      if (total) {
        var pct = Math.round((loc.start.index / total) * 100);
        document.getElementById('reader-progress').textContent = pct + '%';
      }
    }
  } catch (e) {}
}

function changeFontSize(delta) {
  fontSize = Math.max(60, Math.min(200, fontSize + delta));
  injectReaderResources();
}

function closeReader() {
  if (currentRendition) {
    try { currentRendition.destroy(); } catch (e) {}
    currentRendition = null;
  }
  if (currentEpubUrl) {
    URL.revokeObjectURL(currentEpubUrl);
    currentEpubUrl = null;
  }
  currentBook = null;
  currentBookId = null;
  stopTTS();
}

// Event listeners
document.getElementById('btn-font-up').addEventListener('click', function() { changeFontSize(10); });
document.getElementById('btn-font-down').addEventListener('click', function() { changeFontSize(-10); });
document.getElementById('btn-tts-toggle').addEventListener('click', toggleTTSControls);
document.getElementById('btn-reader-back').addEventListener('click', function() {
  closeReader();
  switchScreen('library');
  refreshLibrary();
});
