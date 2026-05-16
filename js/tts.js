var ttsState = {
  playing: false,
  paused: false,
  currentSentence: 0,
  sentences: [],
  rate: 0.9,
  voice: null
};

function initTTS() {
  speechSynthesis.onvoiceschanged = function() { populateVoices(); };
  populateVoices();

  document.getElementById('tts-rate').addEventListener('input', function(e) {
    ttsState.rate = parseFloat(e.target.value);
    document.getElementById('tts-rate-label').textContent = ttsState.rate.toFixed(1) + 'x';
  });

  document.getElementById('tts-voice').addEventListener('change', function(e) {
    var voices = getEnglishVoices();
    ttsState.voice = voices.find(function(v) { return v.name === e.target.value; }) || null;
  });

  document.getElementById('btn-tts-play').addEventListener('click', function() {
    if (ttsState.paused) resumeTTS();
    else if (ttsState.playing) pauseTTS();
    else startTTS(0);
  });

  document.getElementById('btn-tts-stop').addEventListener('click', stopTTS);
  document.getElementById('btn-tts-prev').addEventListener('click', prevSentence);
  document.getElementById('btn-tts-next').addEventListener('click', nextSentence);
}

function populateVoices() {
  var voices = getEnglishVoices();
  var select = document.getElementById('tts-voice');
  select.innerHTML = voices.map(function(v) {
    return '<option value="' + v.name + '">' + v.name + ' (' + v.lang + ')</option>';
  }).join('');
  if (voices.length > 0 && !ttsState.voice) {
    var preferred = voices.find(function(v) {
      return v.name.indexOf('Samantha') > -1 || v.name.indexOf('Daniel') > -1 || v.name.indexOf('Google') > -1;
    });
    ttsState.voice = preferred || voices[0];
    select.value = ttsState.voice.name;
  }
}

function getEnglishVoices() {
  return speechSynthesis.getVoices().filter(function(v) { return v.lang.indexOf('en') === 0; });
}

function getEpubBody() {
  // Get all page divs' content
  var scroller = document.getElementById('epub-scroller');
  if (scroller) {
    // Combine text from all pages
    var pages = scroller.querySelectorAll('.epub-page');
    if (pages.length > 0) return scroller;
  }
  return document.getElementById('epub-content') || document.body;
}

function extractSentences() {
  var body = getEpubBody();
  if (!body) return [];

  var textParts = [];
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    var t = node.textContent.trim();
    if (t) textParts.push(t);
  }

  var fullText = textParts.join(' ');
  var sentences = fullText.match(/[^.!?…\n]+[.!?…]*[\n"」』]?/g) || [];
  return sentences.filter(function(s) { return s.trim().length > 10; });
}

function startTTS(startIdx) {
  ttsState.sentences = extractSentences();
  if (ttsState.sentences.length === 0) {
    showToast('没有可朗读的文本');
    return;
  }
  ttsState.currentSentence = startIdx || 0;
  ttsState.playing = true;
  ttsState.paused = false;
  updateTTSButton();
  speakCurrent();
}

// Start TTS from a specific paragraph
function startTTSFromParagraph(paraText, paraEl) {
  ttsState.sentences = extractSentences();
  if (ttsState.sentences.length === 0) {
    showToast('没有可朗读的文本');
    return;
  }

  // Find the sentence that best matches the start of the paragraph
  var paraStart = paraText.substring(0, 40).replace(/[^a-zA-Z0-9]/g, ' ').trim();
  var bestIdx = 0;
  for (var i = 0; i < ttsState.sentences.length; i++) {
    var sStart = ttsState.sentences[i].substring(0, 40).replace(/[^a-zA-Z0-9]/g, ' ').trim();
    if (sStart.indexOf(paraStart) === 0 || paraStart.indexOf(sStart) === 0) {
      bestIdx = i;
      break;
    }
    // Partial match
    var words = paraStart.split(/\s+/).slice(0, 4).join(' ');
    if (words.length > 10 && sStart.indexOf(words) > -1) {
      bestIdx = i;
      break;
    }
  }

  ttsState.currentSentence = bestIdx;
  ttsState.playing = true;
  ttsState.paused = false;
  updateTTSButton();
  showToast('从选中段落开始朗读');
  speakCurrent();
}

function speakCurrent() {
  if (!ttsState.playing || ttsState.paused) return;
  if (ttsState.currentSentence >= ttsState.sentences.length) {
    stopTTS();
    return;
  }

  var text = ttsState.sentences[ttsState.currentSentence];
  highlightSentence(text);

  var utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = ttsState.rate;
  if (ttsState.voice) utter.voice = ttsState.voice;

  utter.onend = function() {
    ttsState.currentSentence++;
    if (ttsState.playing && !ttsState.paused) {
      speakCurrent();
    }
  };

  utter.onerror = function(e) {
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
  var btn = document.getElementById('btn-tts-play');
  var svg = btn.querySelector('svg');
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
  var body = getEpubBody();
  if (!body) return;

  var prefix = text.substring(0, 30);
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    if (node.textContent.indexOf(prefix) >= 0) {
      var range = document.createRange();
      var idx = node.textContent.indexOf(prefix);
      range.setStart(node, idx);
      range.setEnd(node, Math.min(idx + text.length, node.textContent.length));
      var span = document.createElement('span');
      span.className = 'tts-highlight';
      span.style.cssText = 'background:rgba(79,70,229,0.2);border-radius:2px;';
      try {
        range.surroundContents(span);
        // Navigate to the page containing this highlight
        navigateToHighlight(span);
      } catch(e) {}
      break;
    }
  }
}

function navigateToHighlight(el) {
  var scroller = document.getElementById('epub-scroller');
  if (!scroller || typeof pageWidth === 'undefined' || !pageWidth) return;

  // Find which page contains this element
  var page = el.closest('.epub-page');
  if (!page) return;

  // Get all pages and find the index
  var pages = scroller.querySelectorAll('.epub-page');
  var targetPage = 0;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i] === page) { targetPage = i; break; }
  }

  // Scroll to the target page
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    scroller.scrollTo({ left: targetPage * pageWidth, behavior: 'smooth' });
    updatePageCount();
  }
}

function clearHighlight() {
  var body = getEpubBody();
  if (!body) return;
  body.querySelectorAll('.tts-highlight').forEach(function(el) {
    var parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    if (parent.normalize) parent.normalize();
  });
}

function toggleTTSControls() {
  var ctrl = document.getElementById('tts-controls');
  ctrl.classList.toggle('hidden');
  if (!ctrl.classList.contains('hidden')) {
    populateVoices();
  }
}
