var currentBook = null;
var currentEpub = null;
var currentBookId = null;
var fontSize = 100;

function openReader(bookId) {
  currentBookId = bookId;
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
  }).then(function(iframe) {
    updateProgress();
  }).catch(function(err) {
    console.error('Render error:', err);
    content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;color:#ef4444;font-size:14px;text-align:center;padding:20px;">无法打开此书籍<br><span style="font-size:12px;color:#9ca3af;">' + (err.message || '格式不兼容') + '</span></div>';
  });
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

function updateProgress() {
  if (!currentEpub || !currentEpub.spine) return;
  // scrolled mode: no page-based progress, show chapter count
  document.getElementById('reader-progress').textContent = currentEpub.spine.length + ' 章节';
}

function changeFontSize(delta) {
  fontSize = Math.max(60, Math.min(200, fontSize + delta));
  var iframe = document.querySelector('#reader-content iframe');
  if (iframe) {
    try {
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc && doc.body) {
        doc.body.style.fontSize = fontSize + '%';
      }
    } catch(e) {}
  }
}

function closeReader() {
  currentEpub = null;
  currentBook = null;
  currentBookId = null;
  stopTTS();
}

document.getElementById('btn-font-up').addEventListener('click', function() { changeFontSize(10); });
document.getElementById('btn-font-down').addEventListener('click', function() { changeFontSize(-10); });
document.getElementById('btn-tts-toggle').addEventListener('click', toggleTTSControls);
document.getElementById('btn-reader-back').addEventListener('click', function() {
  closeReader();
  switchScreen('library');
  refreshLibrary();
});
