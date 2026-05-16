let vocabWords = [];

async function loadVocabulary(filter = '') {
  vocabWords = await getAllWords();
  renderVocabulary(filter);
}

function renderVocabulary(filter) {
  const list = document.getElementById('vocab-list');
  let words = vocabWords;

  if (filter) {
    const q = filter.toLowerCase();
    words = words.filter(w => w.word.toLowerCase().includes(q));
  }

  if (words.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>${filter ? '没有匹配的单词' : '还没有收藏的单词'}</p>
      ${filter ? '' : '<p>阅读时点击英文单词即可添加</p>'}
    </div>`;
    return;
  }

  // Group by date
  const groups = {};
  words.forEach(w => {
    const date = new Date(w.addedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(w);
  });

  let html = '';
  for (const [date, ws] of Object.entries(groups)) {
    html += `<div class="vocab-group-title">${date}</div>`;
    ws.forEach(w => {
      html += `
        <div class="vocab-item" data-id="${w.id}">
          <div>
            <div class="word">${w.word} ${w.zhCn ? '<span style="font-size:14px;color:#4f46e5;font-weight:600">' + w.zhCn + '</span>' : ''} ${w.phonetic ? '<span style="font-size:11px;color:#9ca3af;font-weight:400">' + w.phonetic + '</span>' : ''}</div>
            <div class="meaning">${w.pos ? '<span style="color:#4f46e5;font-size:10px">' + w.pos + '</span> ' : ''}${w.definition}</div>
          </div>
          <button class="btn-delete-word" data-delete="${w.id}" aria-label="删除">✕</button>
        </div>
      `;
    });
  }

  list.innerHTML = html;

  // Click to expand
  list.querySelectorAll('.vocab-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-delete-word')) return;
      const w = vocabWords.find(v => v.id === item.dataset.id);
      if (w && w.fullDefs && w.fullDefs.length > 0) {
        showPopover({
          word: w.word,
          phonetic: w.phonetic,
          audioUrl: w.audioUrl,
          definitions: w.fullDefs,
          zhCn: w.zhCn || null
        });
      }
    });
  });

  // Delete
  list.querySelectorAll('.btn-delete-word').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delete;
      await deleteWord(id);
      vocabWords = vocabWords.filter(w => w.id !== id);
      renderVocabulary(filter);
      showToast('已删除');
    });
  });
}

function setupVocabularyScreen() {
  document.getElementById('btn-vocab-back').addEventListener('click', () => {
    switchScreen('library');
  });

  document.getElementById('btn-vocab-export').addEventListener('click', () => {
    const text = vocabWords.map(w =>
      `${w.word} ${w.phonetic || ''} [${w.pos || ''}] ${w.definition}`
    ).join('\n');
    if (text) {
      navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板'));
    } else {
      showToast('生词本为空');
    }
  });

  document.getElementById('vocab-search-input').addEventListener('input', (e) => {
    renderVocabulary(e.target.value);
  });
}
