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
  var lastBlock = null;
  while ((node = walker.nextNode())) {
    var t = node.textContent.trim();
    if (!t) continue;
    // Add newline between different block-level parents to separate titles from body
    var block = node.parentElement;
    while (block && block !== body && !/^(P|H[1-6]|DIV|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
      block = block.parentElement;
    }
    if (lastBlock && block && block !== lastBlock) {
      textParts.push('\n');
    }
    textParts.push(t);
    lastBlock = block;
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

function startTTSFromParagraph(paraText, paraEl) {
  // Build the SAME text that extractSentences uses
  var body = getEpubBody();
  var textParts = [];
  var charCounts = [0];
  var total = 0;
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  var paraStartIdx = -1;
  var lastBlock2 = null;

  while ((node = walker.nextNode())) {
    var txt = node.textContent;
    var trimmed = txt.trim();
    if (!trimmed) continue;

    // Newline between different block parents (same logic as extractSentences)
    var block = node.parentElement;
    while (block && block !== body && !/^(P|H[1-6]|DIV|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
      block = block.parentElement;
    }
    if (lastBlock2 && block && block !== lastBlock2) {
      textParts.push('\n');
      total += 2;
      charCounts.push(total);
    }
    lastBlock2 = block;

    textParts.push(trimmed);
    total += trimmed.length + 1;
    charCounts.push(total);

    // Check if this node is inside the paragraph
    if (paraStartIdx < 0) {
      var cur = node.parentElement;
      while (cur && cur !== body) {
        if (cur === paraEl) {
          paraStartIdx = charCounts[charCounts.length - 2];
          break;
        }
        cur = cur.parentElement;
      }
    }
  }

  var fullText = textParts.join(' ');

  ttsState.sentences = [];
  var sents = fullText.match(/[^.!?…\n]+[.!?…]*[\n"」』]?/g) || [];
  ttsState.sentences = sents.filter(function(s) { return s.trim().length > 10; });

  if (ttsState.sentences.length === 0) {
    showToast('没有可朗读的文本');
    return;
  }

  if (paraStartIdx >= 0) {
    // Find which sentence this position falls in, filtering short ones to match ttsState.sentences
    var before = fullText.substring(0, paraStartIdx);
    var allBefore = before.match(/[^.!?…\n]+[.!?…]*[\n"」』]?/g) || [];
    var sentsBefore = allBefore.filter(function(s) { return s.trim().length > 10; });
    ttsState.currentSentence = Math.max(0, sentsBefore.length);
  } else {
    ttsState.currentSentence = 0;
  }

  ttsState.playing = true;
  ttsState.paused = false;
  updateTTSButton();
  showToast('从第' + (ttsState.currentSentence + 1) + '句开始');
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

  // Try to find the sentence text in text nodes
  var prefix = text.substring(0, 20).replace(/\s+/g, ' ').trim();
  if (prefix.length < 3) return;

  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    var idx = node.textContent.indexOf(prefix);
    if (idx >= 0) {
      var range = document.createRange();
      // Only highlight what fits in this text node
      var endIdx = Math.min(idx + text.length, node.textContent.length);
      range.setStart(node, idx);
      range.setEnd(node, endIdx);
      var span = document.createElement('span');
      span.className = 'tts-highlight';
      span.style.cssText = 'background:rgba(79,70,229,0.2);border-radius:2px;';
      try {
        range.surroundContents(span);
        navigateToHighlight(span);
      } catch(e) {}
      break;
    }
  }

  // Also search for shorter prefix if not found
  if (!body.querySelector('.tts-highlight')) {
    var short = prefix.substring(0, 10);
    var w2 = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    while ((node = w2.nextNode())) {
      var i2 = node.textContent.indexOf(short);
      if (i2 >= 0) {
        var r2 = document.createRange();
        r2.setStart(node, i2);
        r2.setEnd(node, Math.min(i2 + 20, node.textContent.length));
        var s2 = document.createElement('span');
        s2.className = 'tts-highlight';
        s2.style.cssText = 'background:rgba(79,70,229,0.2);border-radius:2px;';
        try { r2.surroundContents(s2); navigateToHighlight(s2); } catch(e) {}
        break;
      }
    }
  }
}

function navigateToHighlight(el) {
  var scroller = document.getElementById('epub-scroller');
  if (!scroller || typeof pageWidth === 'undefined' || !pageWidth) return;

  // Walk up DOM tree to find the page container
  var page = el;
  while (page && !page.classList.contains('epub-page')) {
    page = page.parentElement;
  }
  if (!page) return;

  // Find page index
  var pages = scroller.querySelectorAll('.epub-page');
  var targetPage = 0;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i] === page) { targetPage = i; break; }
  }

  // Scroll if needed
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    scroller.scrollTo({ left: targetPage * pageWidth, behavior: 'smooth' });
    if (typeof updatePageCount === 'function') updatePageCount();
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
