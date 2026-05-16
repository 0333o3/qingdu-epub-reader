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
    setupParagraphTap();
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

// Tap paragraph to start TTS from there
function setupParagraphTap() {
  var scroller = document.getElementById('epub-scroller');
  if (!scroller) return;

  scroller.addEventListener('click', function(e) {
    var p = e.target.closest('p');
    if (!p) return;
    var text = p.textContent.trim();
    if (text.length > 20) {
      startTTSFromParagraph(text, p);
    }
  });
}

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

document.getElementById('btn-font-up').addEventListener('click', function() { changeFontSize(2); });
document.getElementById('btn-font-down').addEventListener('click', function() { changeFontSize(-2); });
document.getElementById('btn-tts-toggle').addEventListener('click', toggleTTSControls);
document.getElementById('btn-reader-back').addEventListener('click', function() {
  closeReader();
  switchScreen('library');
  refreshLibrary();
});
