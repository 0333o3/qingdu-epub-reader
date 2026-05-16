let ttsState = {
  playing: false,
  paused: false,
  currentSentence: 0,
  sentences: [],
  rate: 0.9,
  voice: null
};

function initTTS() {
  // Load voices (they load async in some browsers)
  speechSynthesis.onvoiceschanged = () => populateVoices();
  populateVoices();

  document.getElementById('tts-rate').addEventListener('input', (e) => {
    ttsState.rate = parseFloat(e.target.value);
    document.getElementById('tts-rate-label').textContent = ttsState.rate.toFixed(1) + 'x';
  });

  document.getElementById('tts-voice').addEventListener('change', (e) => {
    const voices = getEnglishVoices();
    ttsState.voice = voices.find(v => v.name === e.target.value) || null;
  });

  document.getElementById('btn-tts-play').addEventListener('click', () => {
    if (ttsState.paused) resumeTTS();
    else if (ttsState.playing) pauseTTS();
    else startTTS();
  });

  document.getElementById('btn-tts-stop').addEventListener('click', stopTTS);
  document.getElementById('btn-tts-prev').addEventListener('click', prevSentence);
  document.getElementById('btn-tts-next').addEventListener('click', nextSentence);
}

function populateVoices() {
  const voices = getEnglishVoices();
  const select = document.getElementById('tts-voice');
  select.innerHTML = voices.map(v =>
    `<option value="${v.name}">${v.name} (${v.lang})</option>`
  ).join('');
  if (voices.length > 0 && !ttsState.voice) {
    // Prefer a good English voice
    const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Google'));
    ttsState.voice = preferred || voices[0];
    select.value = ttsState.voice.name;
  }
}

function getEnglishVoices() {
  return speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
}

function extractSentences() {
  const iframe = document.querySelector('#reader-content iframe');
  if (!iframe || !iframe.contentDocument) return [];

  const body = iframe.contentDocument.body;
  if (!body) return [];

  // Get all text nodes, split into sentences
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  const textParts = [];
  let node;
  while ((node = walker.nextNode())) {
    textParts.push(node.textContent.trim());
  }

  const fullText = textParts.join(' ');
  // Split on sentence boundaries
  const sentences = fullText.match(/[^.!?…\n]+[.!?…]*[\n”"」』]?/g) || [];
  return sentences.filter(s => s.trim().length > 0);
}

function startTTS() {
  ttsState.sentences = extractSentences();
  if (ttsState.sentences.length === 0) {
    showToast('没有可朗读的文本');
    return;
  }
  ttsState.currentSentence = 0;
  ttsState.playing = true;
  ttsState.paused = false;
  updateTTSButton();
  speakCurrent();
}

function speakCurrent() {
  if (!ttsState.playing || ttsState.paused) return;
  if (ttsState.currentSentence >= ttsState.sentences.length) {
    stopTTS();
    return;
  }

  const text = ttsState.sentences[ttsState.currentSentence];
  highlightSentence(text);

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = ttsState.rate;
  if (ttsState.voice) utter.voice = ttsState.voice;

  utter.onend = () => {
    ttsState.currentSentence++;
    if (ttsState.playing && !ttsState.paused) {
      speakCurrent();
    }
  };

  utter.onerror = (e) => {
    if (e.error !== 'canceled' && e.error !== 'interrupted') {
      ttsState.currentSentence++;
      if (ttsState.playing && !ttsState.paused) {
        speakCurrent();
      }
    }
  };

  speechSynthesis.speak(utter);
}

function pauseTTS() {
  ttsState.paused = true;
  speechSynthesis.cancel();
  updateTTSButton();
}

function resumeTTS() {
  ttsState.paused = false;
  updateTTSButton();
  speakCurrent();
}

function stopTTS() {
  ttsState.playing = false;
  ttsState.paused = false;
  speechSynthesis.cancel();
  updateTTSButton();
  clearHighlight();
}

function prevSentence() {
  speechSynthesis.cancel();
  ttsState.currentSentence = Math.max(0, ttsState.currentSentence - 1);
  if (ttsState.playing) speakCurrent();
}

function nextSentence() {
  speechSynthesis.cancel();
  ttsState.currentSentence = Math.min(ttsState.sentences.length - 1, ttsState.currentSentence + 1);
  if (ttsState.playing) speakCurrent();
}

function updateTTSButton() {
  const btn = document.getElementById('btn-tts-play');
  const svg = btn.querySelector('svg');
  if (ttsState.paused) {
    svg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  } else if (ttsState.playing) {
    svg.innerHTML = '<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>';
  } else {
    svg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  }
}

function highlightSentence(text) {
  clearHighlight();
  const iframe = document.querySelector('#reader-content iframe');
  if (!iframe || !iframe.contentDocument) return;
  const body = iframe.contentDocument.body;
  if (!body) return;

  // Find and highlight the sentence text
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  const cleanSearch = text.substring(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.includes(text.substring(0, 30))) {
      const range = document.createRange();
      const idx = node.textContent.indexOf(text.substring(0, 30));
      if (idx >= 0) {
        range.setStart(node, idx);
        range.setEnd(node, Math.min(idx + text.length, node.textContent.length));
        const span = iframe.contentDocument.createElement('span');
        span.className = 'tts-highlight';
        try {
          range.surroundContents(span);
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {}
        break;
      }
    }
  }
}

function clearHighlight() {
  const iframe = document.querySelector('#reader-content iframe');
  if (!iframe || !iframe.contentDocument) return;
  iframe.contentDocument.querySelectorAll('.tts-highlight').forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
}

function toggleTTSControls() {
  const ctrl = document.getElementById('tts-controls');
  ctrl.classList.toggle('hidden');
  if (!ctrl.classList.contains('hidden')) {
    populateVoices();
  }
}
