var currentBook = null;
var currentEpub = null;
var currentBookId = null;
var fontSize = 18;
var currentPage = 0;
var totalPages = 0;
var pageWidth = 0;
var touchStartX = 0;
var touchStartY = 0;
var swipeHandled = false;

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
    goToPage(currentPage, false);
    updatePageCount();
    setupSwipe();
    setupParagraphTap(result.columns);
  }).catch(function(err) {
    console.error('Render error:', err);
    content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;color:#ef4444;font-size:14px;text-align:center;padding:20px;">无法打开此书籍<br><span style="font-size:12px;color:#9ca3af;">' + (err.message || '格式不兼容') + '</span></div>';
  });
}

function setupSwipe() {
  var el = document.getElementById('reader-content');
  el.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeHandled = false;
  }, { passive: true });

  el.addEventListener('touchend', function(e) {
    if (swipeHandled) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && currentPage < totalPages - 1) {
        goToPage(currentPage + 1, true);
      } else if (dx > 0 && currentPage > 0) {
        goToPage(currentPage - 1, true);
      }
      swipeHandled = true;
    }
  });

  // Also support click on left/right edges
  el.addEventListener('click', function(e) {
    if (swipeHandled) return;
    var rect = el.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var w = rect.width;

    if (x < w * 0.25 && currentPage > 0) {
      goToPage(currentPage - 1, true);
    } else if (x > w * 0.75 && currentPage < totalPages - 1) {
      goToPage(currentPage + 1, true);
    }
  });
}

function goToPage(page, animate) {
  currentPage = page;
  var columns = document.getElementById('epub-columns');
  if (columns) {
    if (animate === false) {
      columns.style.transition = 'none';
    } else {
      columns.style.transition = 'transform 0.3s ease';
    }
    columns.style.transform = 'translateX(-' + (page * pageWidth) + 'px)';
  }
  updatePageCount();
  saveProgress();
}

function updatePageCount() {
  var columns = document.getElementById('epub-columns');
  if (columns && pageWidth > 0) {
    totalPages = Math.ceil(columns.scrollWidth / pageWidth);
  }
  var el = document.getElementById('reader-progress');
  if (el) {
    el.textContent = (currentPage + 1) + '/' + (totalPages || '?');
  }
}

function saveProgress() {
  if (!currentBookId || currentPage < 0) return;
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
function setupParagraphTap(columns) {
  columns.addEventListener('click', function(e) {
    var p = e.target.closest('p');
    if (!p) return;
    // Only trigger if it's a deliberate tap on text (not a swipe or edge tap)
    var text = p.textContent.trim();
    if (text.length > 20) {
      startTTSFromParagraph(text, p);
    }
  });
}

function changeFontSize(delta) {
  fontSize = Math.max(12, Math.min(26, fontSize + delta));
  var columns = document.getElementById('epub-columns');
  if (columns) {
    columns.style.fontSize = fontSize + 'px';
    // Recalculate pages after font change
    setTimeout(function() {
      updatePageCount();
      if (currentPage >= totalPages) {
        goToPage(Math.max(0, totalPages - 1), false);
      } else {
        goToPage(currentPage, false);
      }
    }, 400);
  }
}

function closeReader() {
  currentEpub = null;
  currentBook = null;
  currentBookId = null;
  stopTTS();
}

// Update openReader to check for saved progress
var origOpenReader = openReader;
openReader = function(bookId) {
  getBook(bookId).then(function(book) {
    var startPage = (book && book.lastPage) ? book.lastPage : 0;
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
