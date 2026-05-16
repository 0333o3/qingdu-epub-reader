// EPUB parsing using JSZip

function parseEpub(arrayBuffer) {
  var zip = new JSZip();
  return zip.loadAsync(arrayBuffer).then(function(z) {
    var epub = { _zip: z };
    var containerFile = z.file('META-INF/container.xml');
    if (!containerFile) return Promise.reject(new Error('Not a valid EPUB'));

    return containerFile.async('string').then(function(xml) {
      var m = xml.match(/full-path="([^"]+)"/i);
      if (!m) return Promise.reject(new Error('OPF not found'));
      epub._opfPath = m[1];
      epub._basePath = m[1].replace(/[^/]+$/, '');

      return z.file(epub._opfPath).async('string').then(function(opf) {
        epub.title = extractTag(opf, 'dc:title') || extractTag(opf, 'title') || '';
        epub.creator = extractTag(opf, 'dc:creator') || extractTag(opf, 'creator') || '';

        // Parse manifest: id → href
        epub._manifest = {};
        var manMatch = opf.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i);
        if (manMatch) {
          var re = /<item\s+[^>]*?(?:id="([^"]*)"[^>]*?href="([^"]*)"|href="([^"]*)"[^>]*?id="([^"]*)")[^>]*?\/?>/gi;
          var item;
          while ((item = re.exec(manMatch[1]))) {
            var mid = item[1] || item[4];
            var mhref = item[2] || item[3];
            if (mid && mhref) epub._manifest[mid] = mhref;
          }
        }

        // Parse spine (reading order)
        epub.spine = [];
        var spineMatch = opf.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
        if (spineMatch) {
          var sre = /<itemref[^>]+idref="([^"]*)"[^>]*>/gi;
          var s;
          while ((s = sre.exec(spineMatch[1]))) {
            var href = epub._manifest[s[1]] || s[1];
            epub.spine.push(href);
          }
        }

        // Parse TOC from NCX
        epub.toc = [];
        var ncxPath = findNcxPath(z, epub);
        var tocPromise = Promise.resolve();
        if (ncxPath) {
          tocPromise = z.file(ncxPath).async('string').then(function(ncx) {
            try {
              var parser = new DOMParser();
              var doc = parser.parseFromString(ncx, 'text/xml');
              var points = doc.getElementsByTagName('navPoint');
              for (var i = 0; i < points.length; i++) {
                var labels = points[i].getElementsByTagName('navLabel');
                var contents = points[i].getElementsByTagName('content');
                if (labels.length > 0 && contents.length > 0) {
                  var texts = labels[0].getElementsByTagName('text');
                  if (texts.length > 0) {
                    var src = contents[0].getAttribute('src');
                    if (src) {
                      epub.toc.push({ label: texts[0].textContent.trim(), href: src });
                    }
                  }
                }
              }
            } catch(e) {}
          }).catch(function() {});
        }
        return tocPromise.then(function() { return epub; });
      });
    });
  });
}

// Load and render all spine content into container
function renderEpubTo(epub, container) {
  container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#9ca3af;font-size:14px;">加载中...</div>';

  var z = epub._zip;
  var basePath = epub._basePath;

  var loads = epub.spine.map(function(href) {
    var path = resolveHref(basePath, href);
    var file = z.file(path);
    if (file) return file.async('string');
    return Promise.resolve('');
  });

  return Promise.all(loads).then(function(htmls) {
    // Collect all image references
    var allImages = {};
    htmls.forEach(function(html) {
      html.replace(/src="([^"]+)"/gi, function(m, src) {
        if (!/^(https?:|data:)/i.test(src)) allImages[src] = true;
        return m;
      });
      html.replace(/xlink:href="([^"]+)"/gi, function(m, href) {
        if (!/^(https?:|data:)/i.test(href)) allImages[href] = true;
        return m;
      });
    });

    // Load images as blob URLs
    var imgPromises = Object.keys(allImages).map(function(src) {
      var imgPath = resolveHref(basePath, src);
      var imgFile = z.file(imgPath);
      if (!imgFile) {
        epub.spine.forEach(function(href) {
          if (!imgFile) {
            var itemDir = resolveHref(basePath, href).replace(/[^/]+$/, '');
            imgPath = resolveHref(itemDir, src);
            imgFile = z.file(imgPath);
          }
        });
      }
      if (imgFile) {
        return imgFile.async('uint8array').then(function(data) {
          return {
            src: src,
            url: URL.createObjectURL(new Blob([data], { type: guessMimeType(src) }))
          };
        });
      }
      return Promise.resolve(null);
    });

    return Promise.all(imgPromises).then(function(imgResults) {
      var imgMap = {};
      imgResults.forEach(function(r) { if (r) imgMap[r.src] = r.url; });

      // Wrap each spine file's content in a section div with its href as data-file
      var fullHtml = htmls.map(function(html, idx) {
        var href = epub.spine[idx] || '';
        html = html.replace(/src="([^"]+)"/gi, function(m, src) {
          if (imgMap[src]) return 'src="' + imgMap[src] + '"';
          return m;
        });
        html = html.replace(/xlink:href="([^"]+)"/gi, function(m, h) {
          if (imgMap[h]) return 'xlink:href="' + imgMap[h] + '"';
          return m;
        });
        return '<div class="epub-section" data-file="' + href + '">' + html + '</div>';
      }).join('');

      fullHtml = '<style>' +
        'body{margin:0;padding:0;}img{max-width:100%;height:auto;display:block;margin:8px auto;}' +
        'body,div,p,span,h1,h2,h3,h4,h5,h6,li,td,th,blockquote{color:#1a1a1a;font-family:Georgia,"Times New Roman","Noto Serif SC",serif;text-align:left;}' +
        '</style>' + fullHtml;

      var pageWidth = container.clientWidth || window.innerWidth;
      var pageHeight = container.clientHeight || (window.innerHeight - 100);
      if (pageWidth <= 0) pageWidth = 320;
      if (pageHeight <= 0) pageHeight = 400;

      var pages = buildPages(fullHtml, pageWidth, pageHeight);

      // Create scrollable container
      var scroller = document.createElement('div');
      scroller.id = 'epub-scroller';
      scroller.style.cssText = 'display:flex;overflow-x:auto;overflow-y:hidden;' +
        'scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;' +
        'height:100%;width:100%;background:#fff;';

      for (var i = 0; i < pages.length; i++) {
        var page = document.createElement('div');
        page.className = 'epub-page';
        page.setAttribute('data-page', i);
        page.style.cssText = 'min-width:' + pageWidth + 'px;max-width:' + pageWidth + 'px;' +
          'height:' + pageHeight + 'px;' +
          'scroll-snap-align:start;scroll-snap-stop:always;' +
          'overflow-y:auto;overflow-x:hidden;' +
          '-webkit-overflow-scrolling:touch;padding:20px 24px;' +
          'font-family:Georgia,"Times New Roman","Noto Serif SC",serif;' +
          'font-size:18px;line-height:1.8;color:#1a1a1a;background:#fff;' +
          'word-wrap:break-word;overflow-wrap:break-word;';
        page.innerHTML = pages[i];
        scroller.appendChild(page);
      }

      container.innerHTML = '';
      container.appendChild(scroller);

      // Build TOC → page mapping: find which page each TOC entry's file first appears on
      var tocMap = buildTocMap(epub, scroller);
      window._epubTocMap = tocMap;

      setupWordTapOnDiv(scroller);

      return { container: scroller, pageWidth: pageWidth, pageHeight: pageHeight, totalPages: pages.length, tocMap: tocMap };
    });
  });
}

// Build chapters by searching for file sections, then mapping to TOC
function buildTocMap(epub, scroller) {
  var toc = epub.toc;
  if (!toc || toc.length === 0) return [];

  // First pass: find which page each file starts on
  var filePageMap = {};
  var pages = scroller.querySelectorAll('.epub-page');
  for (var pi = 0; pi < pages.length; pi++) {
    var sections = pages[pi].querySelectorAll('.epub-section');
    for (var si = 0; si < sections.length; si++) {
      var f = sections[si].getAttribute('data-file');
      if (f && !(f in filePageMap)) {
        filePageMap[f] = pi;
      }
    }
  }

  // Map TOC entries to pages by matching file href
  var tocMap = [];
  for (var ti = 0; ti < toc.length; ti++) {
    var targetHref = normalizePath(toc[ti].href);
    var bestPage = -1;

    // Try exact file match first
    for (var filePath in filePageMap) {
      if (normalizePath(filePath) === targetHref) {
        bestPage = filePageMap[filePath];
        break;
      }
    }

    // If no file match, try partial match (file ends with the target)
    if (bestPage < 0) {
      for (var fp in filePageMap) {
        if (normalizePath(fp).indexOf(targetHref) >= 0 || targetHref.indexOf(normalizePath(fp)) >= 0) {
          bestPage = filePageMap[fp];
          break;
        }
      }
    }

    // If still no match, search page text
    if (bestPage < 0 && toc[ti].label.length > 3) {
      var label = toc[ti].label;
      for (var pi2 = 0; pi2 < pages.length; pi2++) {
        if (pages[pi2].textContent.indexOf(label) >= 0) {
          bestPage = pi2;
          break;
        }
      }
    }

    if (bestPage >= 0) {
      tocMap.push({ label: toc[ti].label, page: bestPage });
    }
  }

  return tocMap;
}

// Split HTML content into page-sized chunks
function buildPages(fullHtml, pageWidth, pageHeight) {
  var measure = document.createElement('div');
  measure.style.cssText = 'position:fixed;left:-9999px;top:0;' +
    'width:' + pageWidth + 'px;height:auto;overflow:hidden;' +
    'font-family:Georgia,"Times New Roman","Noto Serif SC",serif;' +
    'font-size:18px;line-height:1.8;color:#1a1a1a;' +
    'word-wrap:break-word;overflow-wrap:break-word;';
  measure.innerHTML = fullHtml;
  document.body.appendChild(measure);

  var contentHeight = pageHeight - 40;
  var pages = [];

  // Paginate each epub-section independently (avoids duplication)
  var sections = measure.querySelectorAll('.epub-section');
  if (sections.length > 0) {
    for (var si = 0; si < sections.length; si++) {
      // Get blocks within this section
      var sectionBlocks = sections[si].querySelectorAll('p, h1, h2, h3, h4, h5, h6, img, blockquote, li, hr, table, pre, div.calibre, div.calibre1, div.s, div.s1, div[style*="text-align"]');
      if (sectionBlocks.length === 0) {
        sectionBlocks = sections[si].querySelectorAll('div, p, span');
      }
      if (sectionBlocks.length === 0) {
        // Empty or text-only section, include the whole section
        pages.push(sections[si].outerHTML);
        continue;
      }

      var tempPage = document.createElement('div');
      tempPage.style.cssText = 'width:' + pageWidth + 'px;height:auto;overflow:hidden;';
      measure.appendChild(tempPage);

      for (var i = 0; i < sectionBlocks.length; i++) {
        var clone = sectionBlocks[i].cloneNode(true);
        tempPage.appendChild(clone);

        if (tempPage.scrollHeight > contentHeight) {
          tempPage.removeChild(clone);
          if (tempPage.innerHTML.trim()) {
            // Wrap in the section div to preserve data-file
            var sectionClone = sections[si].cloneNode(false);
            sectionClone.innerHTML = tempPage.innerHTML;
            pages.push(sectionClone.outerHTML);
          }
          tempPage.innerHTML = '';
          tempPage.appendChild(clone);
        }
      }
      if (tempPage.innerHTML.trim()) {
        var sectionClone = sections[si].cloneNode(false);
        sectionClone.innerHTML = tempPage.innerHTML;
        pages.push(sectionClone.outerHTML);
      }
      if (tempPage.parentNode) tempPage.parentNode.removeChild(tempPage);
    }
  } else {
    // No sections: use old block-based pagination
    var blocks = measure.querySelectorAll('p, h1, h2, h3, h4, h5, h6, img, blockquote, li, hr, table, pre, div');
    if (blocks.length === 0) blocks = measure.querySelectorAll('div, p, span');
    var tempPage = document.createElement('div');
    tempPage.style.cssText = 'width:' + pageWidth + 'px;height:auto;overflow:hidden;';
    measure.appendChild(tempPage);
    for (var b = 0; b < blocks.length; b++) {
      var c = blocks[b].cloneNode(true);
      tempPage.appendChild(c);
      if (tempPage.scrollHeight > contentHeight) {
        tempPage.removeChild(c);
        if (tempPage.innerHTML.trim()) pages.push(tempPage.innerHTML);
        tempPage.innerHTML = '';
        tempPage.appendChild(c);
      }
    }
    if (tempPage.innerHTML.trim()) pages.push(tempPage.innerHTML);
    if (tempPage.parentNode) tempPage.parentNode.removeChild(tempPage);
  }

  document.body.removeChild(measure);
  if (pages.length === 0) pages.push(fullHtml);
  return pages;
}

// Find NCX path from manifest
function findNcxPath(zip, epub) {
  for (var id in epub._manifest) {
    if (id === 'ncx' || epub._manifest[id] === 'toc.ncx') {
      return resolveHref(epub._basePath, epub._manifest[id]);
    }
  }
  if (zip.file(epub._basePath + 'toc.ncx')) return epub._basePath + 'toc.ncx';
  if (zip.file('toc.ncx')) return 'toc.ncx';
  return null;
}

function resolveHref(base, href) {
  var parts = base.split('/');
  parts.pop();
  href.split('/').forEach(function(seg) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  });
  return parts.join('/');
}

function extractTag(xml, tag) {
  var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  var m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function normalizePath(p) {
  if (!p) return '';
  try { p = decodeURIComponent(p); } catch(e) {}
  return p.replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

function guessMimeType(path) {
  var ext = path.split('.').pop().toLowerCase();
  var m = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', svg:'image/svg+xml', webp:'image/webp' };
  return m[ext] || 'image/octet-stream';
}

function setupWordTapOnDiv(el) {
  var sx = 0, sy = 0, st = 0, moved = false, longPressTimer = null;

  el.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      st = Date.now(); moved = false;
      // Long press: 600ms hold → TTS from paragraph
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(function() {
        if (!moved) {
          var el2 = document.elementFromPoint(sx, sy);
          var p = null;
          // Walk up DOM to find a paragraph or content block
          var cur = el2;
          while (cur && cur !== document.body && cur !== el) {
            if (cur.tagName === 'P') { p = cur; break; }
            cur = cur.parentElement;
          }
          if (p && p.textContent.trim().length > 10) {
            startTTSFromParagraph(p.textContent.trim(), p);
          }
        }
      }, 600);
    }
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    if (Math.abs(e.touches[0].clientX - sx) > 8 ||
        Math.abs(e.touches[0].clientY - sy) > 8) {
      moved = true;
      clearTimeout(longPressTimer);
    }
  }, { passive: true });

  el.addEventListener('touchend', function(e) {
    clearTimeout(longPressTimer);
    // Short tap: word lookup only
    if (moved || (Date.now() - st) > 400) return;
    var x = e.changedTouches[0].clientX, y = e.changedTouches[0].clientY, range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) { range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset); }
    }
    if (!range || !range.startContainer) return;
    var n = range.startContainer;
    if (n.nodeType !== 3) return;
    var t = n.textContent, o = range.startOffset, s2 = o, e2 = o;
    while (s2 > 0 && /[a-zA-Z]/.test(t[s2 - 1])) s2--;
    while (e2 < t.length && /[a-zA-Z]/.test(t[e2])) e2++;
    var w = t.slice(s2, e2);
    if (w.length > 1 && /^[a-zA-Z]+$/.test(w)) {
      window.postMessage({ type: 'word-tap', word: w.toLowerCase() }, '*');
    }
  });
}

function findClosestP(el) {
  while (el) {
    if (el.tagName === 'P') return el;
    el = el.parentElement;
  }
  return null;
}
