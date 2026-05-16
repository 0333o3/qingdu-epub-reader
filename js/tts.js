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
  return document.getElementById('epub-scroller') ||
         document.getElementById('epub-content') ||
         document.body;
}

// Build text blocks: each block element (P, H1-6, LI, etc.) gets its own text chunk
// Blocks are separated by newlines so titles like "I" don't merge with body
function buildTextBlocks() {
  var body = getEpubBody();
  if (!body) return { text: '', blocks: [] };

  var blocks = [];
  var currentBlock = null;
  var currentText = [];
  var currentEl = null;

  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    var t = node.textContent;
    if (!t.trim()) continue;

    // Find the nearest block-level parent
    var block = node.parentElement;
    while (block && block !== body) {
      var tag = block.tagName;
      if (tag === 'P' || tag === 'H1' || tag === 'H2' || tag === 'H3' ||
          tag === 'H4' || tag === 'H5' || tag === 'H6' || tag === 'LI' ||
          tag === 'BLOCKQUOTE' || tag === 'TD' || tag === 'TH' ||
          block.classList.contains('calibre1') || block.classList.contains('s') ||
          block.classList.contains('s1') || block.classList.contains('s5') ||
          block.classList.contains('s6')) {
        break;
      }
      block = block.parentElement;
    }

    // If block changed, finalize the previous block
    if (block !== currentBlock) {
      if (currentText.length > 0) {
        blocks.push({ text: currentText.join(' ').replace(/\s+/g, ' ').trim(), el: currentEl });
      }
      currentText = [];
      currentBlock = block;
      currentEl = node.parentElement;
      while (currentEl && currentEl.parentElement !== block) {
        currentEl = currentEl.parentElement;
      }
    }

    currentText.push(t.replace(/\s+/g, ' '));
    if (!currentEl) currentEl = node.parentElement;
  }

  // Last block
  if (currentText.length > 0) {
    blocks.push({ text: currentText.join(' ').replace(/\s+/g, ' ').trim(), el: currentEl });
  }

  // Build full text with newlines between blocks
  var text = blocks.map(function(b) { return b.text; }).join('\n');
  return { text: text, blocks: blocks };
}

// Split text into sentences, respecting block boundaries
function extractSentences() {
  var result = buildTextBlocks();
  var text = result.text;
  if (!text) return [];

  // Split on newlines first (block boundaries), then on punctuation within each line
  var lines = text.split('\n');
  var sentences = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // Split on .!? followed by space or end
    var parts = line.split(/(?<=[.!?…])\s+/);
    for (var j = 0; j < parts.length; j++) {
      var s = parts[j].trim();
      if (s) sentences.push(s);
    }
  }
  return sentences.filter(function(s) { return s.length > 10; });
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
  var result = buildTextBlocks();
  ttsState.sentences = [];
  var lines = result.text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var parts = line.split(/(?<=[.!?…])\s+/);
    for (var j = 0; j < parts.length; j++) {
      var s = parts[j].trim();
      if (s && s.length > 10) ttsState.sentences.push(s);
    }
  }

  if (ttsState.sentences.length === 0) {
    showToast('没有可朗读的文本');
    return;
  }

  // Find paragraph's first sentence by matching its text against blocks
  var cleanPara = paraText.replace(/\s+/g, ' ').trim();
  var charPos = 0;
  for (var bi = 0; bi < result.blocks.length; bi++) {
    var blockText = result.blocks[bi].text;
    if (blockText.indexOf(cleanPara.substring(0, 40)) >= 0 ||
        cleanPara.indexOf(blockText) >= 0) {
      // Found the block containing this paragraph
      // Count sentences before this block
      var beforeText = result.blocks.slice(0, bi).map(function(b) { return b.text; }).join('\n');
      var beforeLines = beforeText.split('\n');
      var count = 0;
      for (var li = 0; li < beforeLines.length; li++) {
        var l = beforeLines[li].trim();
        if (!l) continue;
        var lparts = l.split(/(?<=[.!?…])\s+/);
        for (var lj = 0; lj < lparts.length; lj++) {
          if (lparts[lj].trim().length > 10) count++;
        }
      }
      // Also count sentences within this block before the paragraph starts
      if (beforeLines.length > 0) {
        var currentLineSents = beforeLines[beforeLines.length - 1];
        // This is approximate - we count all sentences in the block
        // A more precise approach would find the exact sentence index
      }
      ttsState.currentSentence = Math.max(0, count);
      break;
    }
    charPos += blockText.length + 1;
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
    if (ttsState.playing && !ttsState.paused) speakCurrent();
  };

  utter.onerror = function(e) {
    if (e.error !== 'canceled' && e.error !== 'interrupted') {
      ttsState.currentSentence++;
      if (ttsState.playing && !ttsState.paused) speakCurrent();
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

  // Find the first 20 chars of this sentence in any text node
  var search = text.replace(/\s+/g, ' ').substring(0, 20).trim();
  if (!search) return;

  // Walk text nodes looking for a match
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    // Normalize whitespace for matching
    var raw = node.textContent;
    var norm = raw.replace(/\s+/g, ' ');
    var idx = norm.indexOf(search);
    if (idx < 0) continue;

    // Convert normalized index to raw index
    var rawIdx = 0, normPos = 0;
    while (normPos < idx && rawIdx < raw.length) {
      if (/\s/.test(raw[rawIdx])) {
        while (rawIdx < raw.length && /\s/.test(raw[rawIdx])) rawIdx++;
        normPos++;
      } else {
        rawIdx++;
        normPos++;
      }
    }

    // Highlight a chunk of reasonable length
    var hlLen = Math.min(100, raw.length - rawIdx);
    var before = raw.substring(0, rawIdx);
    var hl = raw.substring(rawIdx, rawIdx + hlLen);
    var after = raw.substring(rawIdx + hlLen);

    var parent = node.parentNode;
    if (!parent) break;

    // Replace text node with three parts
    var afterNode = document.createTextNode(after);
    var hlNode = document.createElement('span');
    hlNode.className = 'tts-highlight';
    hlNode.style.cssText = 'background:rgba(79,70,229,0.2);border-radius:2px;';
    hlNode.textContent = hl;
    parent.replaceChild(afterNode, node);
    parent.insertBefore(hlNode, afterNode);
    parent.insertBefore(document.createTextNode(before), hlNode);

    navigateToHighlight(hlNode);
    break;
  }
}

function navigateToHighlight(el) {
  var scroller = document.getElementById('epub-scroller');
  if (!scroller || typeof pageWidth === 'undefined' || !pageWidth) return;

  var page = el;
  while (page && !page.classList.contains('epub-page')) {
    page = page.parentElement;
  }
  if (!page) return;

  var pages = scroller.querySelectorAll('.epub-page');
  var targetPage = 0;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i] === page) { targetPage = i; break; }
  }

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
