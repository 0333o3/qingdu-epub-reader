var currentBook = null;
var currentEpub = null;
var currentBookId = null;
var fontSize = 18;
var currentPage = 0;
var totalPages = 0;
var pageWidth = 0;
var saveTimeout = null;

function openReader(bookId, startPage) {
  currentBookId = bookId;
  currentPage = startPage || 0;
  getBook(bookId).then(function(book) {
    if (!book || !book.file) { showToast('书籍数据异常'); return; }
    currentBook = book;
    document.getElementById('reader-title').textContent = book.title || '阅读';
    switchScreen('reader');
    loadAndRender(book);
  }).catch(function(err) {
    console.error('openReader error:', err);
    showToast('书籍加载失败');
  });
}

function loadAndRender(book) {
  var content = document.getElementById('reader-content');
  content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:14px;">加载中...</div>';

  parseEpub(book.file).then(function(epub) {
    currentEpub = epub;
    return renderEpubTo(epub, content);
  }).then(function(result) {
    pageWidth = result.pageWidth;
    totalPages = result.totalPages;

    var scroller = document.getElementById('epub-scroller');
    if (scroller) {
      // Track page changes without interfering with native scroll momentum
      scroller.addEventListener('scroll', function() {
        var pg = Math.round(scroller.scrollLeft / pageWidth);
        if (pg !== currentPage && pg >= 0 && pg < totalPages) {
          currentPage = pg;
          updateProgress();
        }
      }, { passive: true });

      // Save progress when scrolling stops
      scroller.addEventListener('touchend', function() {
        scheduleSave();
      });


      // Jump to saved page
      if (currentPage > 0 && currentPage < totalPages) {
        scroller.scrollLeft = currentPage * pageWidth;
      }
    }

    updateProgress();
  }).catch(function(err) {
    console.error('Render error:', err);
    content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;color:#ef4444;font-size:14px;text-align:center;padding:20px;">无法打开此书籍<br><span style="font-size:12px;color:#9ca3af;">' + (err.message || '格式不兼容') + '</span></div>';
  });
}

function updateProgress() {
  var el = document.getElementById('reader-progress');
  if (el) {
    el.textContent = (currentPage + 1) + '/' + (totalPages || '?');
  }
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveProgress, 500);
}

function saveProgress() {
  if (!currentBookId) return;
  getBook(currentBookId).then(function(book) {
    if (book) {
      book.lastPage = currentPage;
      saveBook(book);
    }
  }).catch(function() {});
}

// Listen for word-tap messages
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

// TTS is controlled via the TTS button only (no auto paragraph tap)

function changeFontSize(delta) {
  fontSize = Math.max(12, Math.min(26, fontSize + delta));
  var scroller = document.getElementById('epub-scroller');
  if (!scroller) return;

  var pages = scroller.querySelectorAll('.epub-page');
  for (var i = 0; i < pages.length; i++) {
    pages[i].style.fontSize = fontSize + 'px';
  }

  // Save current page
  var savedPage = currentPage;
  setTimeout(function() {
    var scroller2 = document.getElementById('epub-scroller');
    if (scroller2 && pageWidth > 0) {
      scroller2.scrollLeft = savedPage * pageWidth;
    }
  }, 100);
}

function closeReader() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveProgress();
  currentEpub = null;
  currentBook = null;
  currentBookId = null;
  stopTTS();
}

// Override openReader to check for saved progress
var origOpenReader = openReader;
openReader = function(bookId) {
  getBook(bookId).then(function(book) {
    var startPage = (book && typeof book.lastPage === 'number') ? book.lastPage : 0;
    origOpenReader(bookId, startPage);
  }).catch(function() {
    origOpenReader(bookId, 0);
  });
};

// ===== Chapter Navigation =====
function jumpChapter(forward) {
  var map = window._epubTocMap || [];
  if (map.length < 2) return;
  var cur = -1;
  for (var i = map.length - 1; i >= 0; i--) {
    if (currentPage >= map[i].page) { cur = i; break; }
  }
  var tgt = forward ? cur + 1 : cur - 1;
  if (tgt < 0 || tgt >= map.length) return;
  jumpToPage(map[tgt].page);
}

function jumpToPage(pg) {
  var scroller = document.getElementById('epub-scroller');
  if (scroller && typeof pageWidth !== 'undefined' && pageWidth > 0) {
    currentPage = pg;
    scroller.scrollTo({ left: pg * pageWidth, behavior: 'smooth' });
    updateProgress();
    scheduleSave();
  }
}

// ===== TOC Sidebar =====
function toggleToc() {
  var panel = document.getElementById('toc-panel');
  if (panel.classList.contains('hidden')) {
    buildTocContent();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function buildTocContent() {
  var list = document.getElementById('toc-list');
  var map = window._epubTocMap || [];
  if (map.length === 0) {
    list.innerHTML = '<div style="padding:24px;color:#9ca3af;font-size:13px;text-align:center;">暂无目录</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < map.length; i++) {
    var cls = (currentPage >= map[i].page) ? ' toc-item current' : 'toc-item';
    html += '<button class="' + cls + '" data-page="' + map[i].page + '">' +
      '<span class="toc-dot"></span>' + map[i].label + '</button>';
  }
  list.innerHTML = html;

  list.querySelectorAll('.toc-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var pg = parseInt(btn.getAttribute('data-page'));
      jumpToPage(pg);
      document.getElementById('toc-panel').classList.add('hidden');
    });
  });
}

document.getElementById('btn-toc').addEventListener('click', toggleToc);
document.getElementById('btn-toc-close').addEventListener('click', function() {
  document.getElementById('toc-panel').classList.add('hidden');
});
document.getElementById('btn-prev-chapter').addEventListener('click', function() { jumpChapter(false); });
document.getElementById('btn-next-chapter').addEventListener('click', function() { jumpChapter(true); });
document.getElementById('btn-font-up').addEventListener('click', function() { changeFontSize(2); });
document.getElementById('btn-font-down').addEventListener('click', function() { changeFontSize(-2); });
document.getElementById('btn-tts-toggle').addEventListener('click', toggleTTSControls);
document.getElementById('btn-reader-back').addEventListener('click', function() {
  closeReader();
  switchScreen('library');
  refreshLibrary();
});
