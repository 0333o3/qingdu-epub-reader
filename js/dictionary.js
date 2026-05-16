const DICT_CACHE = new Map();

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.add('hidden'), 2000);
}

function isEnglishWord(text) {
  return /^[a-zA-Z]+$/.test(text);
}

async function lookupWord(word) {
  const key = word.toLowerCase();
  if (DICT_CACHE.has(key)) return DICT_CACHE.get(key);

  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (!resp.ok) throw new Error('Not found');
    const data = await resp.json();
    const result = parseDictResponse(data, word);
    DICT_CACHE.set(key, result);
    return result;
  } catch {
    return { word, phonetic: null, audioUrl: null, definitions: [] };
  }
}

function parseDictResponse(data, word) {
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return { word, phonetic: null, audioUrl: null, definitions: [] };

  let phonetic = null;
  let audioUrl = null;

  if (entry.phonetics) {
    for (const p of entry.phonetics) {
      if (p.text && !phonetic) phonetic = p.text;
      if (p.audio && !audioUrl) audioUrl = p.audio;
    }
  }

  const definitions = [];
  if (entry.meanings) {
    for (const m of entry.meanings) {
      for (const d of (m.definitions || []).slice(0, 3)) {
        definitions.push({
          pos: m.partOfSpeech,
          definition: d.definition,
          example: d.example || null
        });
      }
    }
  }

  return { word, phonetic, audioUrl, definitions: definitions.slice(0, 6) };
}

// Popover UI
function showPopover(result) {
  const popover = document.getElementById('popover-dictionary');
  const overlay = document.getElementById('overlay');

  document.getElementById('popover-word').textContent = result.word;

  const phoneticEl = document.getElementById('popover-phonetic');
  phoneticEl.textContent = result.phonetic ? result.phonetic : '';

  const defsEl = document.getElementById('popover-definitions');
  if (result.definitions.length === 0) {
    defsEl.innerHTML = '<div class="popover-loading">未找到释义</div>';
  } else {
    defsEl.innerHTML = result.definitions.map(d =>
      `<div class="def-item">
        <span class="pos">${d.pos || ''}</span>
        <span class="def-text">${d.definition}</span>
        ${d.example ? `<div class="def-example">"${d.example}"</div>` : ''}
      </div>`
    ).join('');
  }

  const pronounceBtn = document.getElementById('popover-pronounce');
  if (result.audioUrl) {
    pronounceBtn.style.display = 'flex';
    pronounceBtn.onclick = () => {
      const audio = new Audio(result.audioUrl);
      audio.play().catch(() => pronounceWord(result.word));
    };
  } else {
    pronounceBtn.style.display = 'flex';
    pronounceBtn.onclick = () => pronounceWord(result.word);
  }

  const saveBtn = document.getElementById('popover-save');
  saveBtn.classList.remove('saved');
  saveBtn.textContent = '';
  saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 加入生词本';
  saveBtn.onclick = () => saveToVocabulary(result, saveBtn);

  popover.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function hidePopover() {
  document.getElementById('popover-dictionary').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}

function pronounceWord(word) {
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    utter.rate = 0.85;
    utter.onend = resolve;
    utter.onerror = resolve;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  });
}

async function saveToVocabulary(result, btn) {
  const existing = await findWord(result.word);
  if (existing.length > 0) {
    showToast('已在生词本中');
    return;
  }
  await saveWord({
    id: 'vocab_' + Date.now(),
    word: result.word,
    phonetic: result.phonetic,
    definition: result.definitions[0]?.definition || '',
    pos: result.definitions[0]?.pos || '',
    fullDefs: result.definitions,
    audioUrl: result.audioUrl,
    addedAt: Date.now()
  });
  btn.classList.add('saved');
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已添加';
  showToast('已加入生词本');
}
