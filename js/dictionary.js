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

  var enPromise = fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key))
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  var zhPromise = fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(key) + '&langpair=en|zh')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.responseData && d.responseData.translatedText &&
          d.responseData.translatedText.toLowerCase() !== key.toLowerCase()) {
        return d.responseData.translatedText;
      }
      return null;
    })
    .catch(function() { return null; });

  try {
    var results = await Promise.all([enPromise, zhPromise]);
    var enData = results[0];
    var zhText = results[1];
    var result = parseDictResponse(enData, word, zhText);
    DICT_CACHE.set(key, result);
    return result;
  } catch(e) {
    return { word: word, phonetic: null, audioUrl: null, definitions: [], zhCn: null };
  }
}

function parseDictResponse(data, word, zhText) {
  var entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return { word: word, phonetic: null, audioUrl: null, definitions: [], zhCn: zhText };

  var phonetic = null;
  var audioUrl = null;

  if (entry.phonetics) {
    for (var i = 0; i < entry.phonetics.length; i++) {
      var p = entry.phonetics[i];
      if (p.text && !phonetic) phonetic = p.text;
      if (p.audio && !audioUrl) audioUrl = p.audio;
    }
  }

  var definitions = [];
  if (entry.meanings) {
    for (var mi = 0; mi < entry.meanings.length; mi++) {
      var m = entry.meanings[mi];
      for (var di = 0; di < (m.definitions || []).length && di < 3; di++) {
        var d = m.definitions[di];
        definitions.push({
          pos: m.partOfSpeech,
          definition: d.definition,
          example: d.example || null
        });
      }
    }
  }

  return { word: word, phonetic: phonetic, audioUrl: audioUrl, definitions: definitions.slice(0, 6), zhCn: zhText };
}

// Popover UI
function showPopover(result) {
  const popover = document.getElementById('popover-dictionary');
  const overlay = document.getElementById('overlay');

  document.getElementById('popover-word').textContent = result.word;

  const phoneticEl = document.getElementById('popover-phonetic');
  phoneticEl.textContent = result.phonetic ? result.phonetic : '';

  var zhHtml = result.zhCn ? '<div style="color:#4f46e5;font-size:18px;font-weight:600;margin-bottom:12px;">' + result.zhCn + '</div>' : '';

  const defsEl = document.getElementById('popover-definitions');
  if (result.definitions.length === 0 && !result.zhCn) {
    defsEl.innerHTML = '<div class="popover-loading">未找到释义</div>';
  } else {
    defsEl.innerHTML = zhHtml + result.definitions.map(function(d) {
      return '<div class="def-item">' +
        '<span class="pos">' + (d.pos || '') + '</span>' +
        '<span class="def-text">' + d.definition + '</span>' +
        (d.example ? '<div class="def-example">"' + d.example + '"</div>' : '') +
        '</div>';
    }).join('');
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
    zhCn: result.zhCn || '',
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
