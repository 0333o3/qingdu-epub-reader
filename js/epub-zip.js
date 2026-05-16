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
          // Handle both id-first and href-first order
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

        // Parse TOC from NCX file (must complete before returning)
        epub.toc = [];
        var ncxPath = findNcxPath(z, epub);
        var tocPromise = Promise.resolve();
        if (ncxPath) {
          tocPromise = z.file(ncxPath).async('string').then(function(ncx) {
            try {
              var parser = new DOMParser();
              var doc = parser.parseFromString(ncx, 'text/xml');
              var points = doc.querySelectorAll('navPoint');
              for (var i = 0; i < points.length; i++) {
                var label = points[i].querySelector('navLabel text');
                var content = points[i].querySelector('content');
                if (label && content) {
                  var src = content.getAttribute('src');
                  if (src) {
                    epub.toc.push({ label: label.textContent.trim(), href: src });
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

  // Load all spine HTML files
  var loads = epub.spine.map(function(href) {
    var path = resolveHref(basePath, href);
    var file = z.file(path);
    if (file) return file.async('string');
    return Promise.resolve('');
  });

  return Promise.all(loads).then(function(htmls) {
    // Collect all image references (src and xlink:href)
    var allImages = {};
    htmls.forEach(function(html) {
      html.replace(/src="([^"]+)"/gi, function(m, src) {
        if (!/^(https?:|data:)/i.test(src)) {
          allImages[src] = true;
        }
        return m;
      });
      html.replace(/xlink:href="([^"]+)"/gi, function(m, href) {
        if (!/^(https?:|data:)/i.test(href)) {
          allImages[href] = true;
        }
        return m;
      });
    });

    // Load images as blob URLs
    var imgPromises = Object.keys(allImages).map(function(src) {
      var imgPath = resolveHref(basePath, src);
      var imgFile = z.file(imgPath);
      if (!imgFile) {
        // Try resolving from each spine item's directory
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
      // Build image map
      var imgMap = {};
      imgResults.forEach(function(r) {
        if (r) imgMap[r.src] = r.url;
      });

      // Replace image src and xlink:href with blob URLs
      // Also add file markers for TOC mapping
      var fullHtml = htmls.map(function(html, idx) {
        var href = epub.spine[idx] || '';
        var marker = '<span class="epub-file-marker" data-file="' + href + '" style="display:none;"></span>';
        html = html.replace(/src="([^"]+)"/gi, function(m, src) {
          if (imgMap[src]) return 'src="' + imgMap[src] + '"';
          return m;
        });
        html = html.replace(/xlink:href="([^"]+)"/gi, function(m, h) {
          if (imgMap[h]) return 'xlink:href="' + imgMap[h] + '"';
          return m;
        });
        return marker + html;
      }).join('\n<hr class="epub-chapter-break" style="border:none;margin:20px 0;"/>');

      // Render with pagination using native scroll-snap
      var pageWidth = container.clientWidth || window.innerWidth;
      var pageHeight = container.clientHeight || (window.innerHeight - 100);

      if (pageWidth <= 0) pageWidth = 320;
      if (pageHeight <= 0) pageHeight = 400;

      var fullHtml = '<style>' +
        'body{margin:0 !important;padding:0 !important;}' +
        'img{max-width:100% !important;height:auto !important;display:block;margin:8px auto;}' +
        'body,div,p,span,h1,h2,h3,h4,h5,h6,li,td,th,blockquote{color:#1a1a1a !important;font-family:Georgia,"Times New Roman","Noto Serif SC",serif !important;text-align:left !important;}' +
        '</style>' + fullHtml;

      // Build pages using a measurement div
      var pages = buildPages(fullHtml, pageWidth, pageHeight);

      // Create scrollable container with snap
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
          '-webkit-overflow-scrolling:touch;' +
          'padding:20px 24px;' +
          'font-family:Georgia,"Times New Roman","Noto Serif SC",serif;' +
          'font-size:18px;line-height:1.8;' +
          'color:#1a1a1a;background:#fff;' +
          'word-wrap:break-word;overflow-wrap:break-word;';
        page.innerHTML = pages[i];
        scroller.appendChild(page);
      }

      container.innerHTML = '';
      container.appendChild(scroller);

      // Build TOC → page mapping
      var tocMap = [];
      if (epub.toc && epub.toc.length > 0) {
        var pageEls = scroller.querySelectorAll('.epub-page');
        for (var pi = 0; pi < pageEls.length; pi++) {
          var markers = pageEls[pi].querySelectorAll('.epub-file-marker');
          for (var mi = 0; mi < markers.length; mi++) {
            var f = markers[mi].getAttribute('data-file');
            for (var ti = 0; ti < epub.toc.length; ti++) {
              // Compare normalized paths (handle encoding differences)
              if (normalizePath(epub.toc[ti].href) === normalizePath(f)) {
                tocMap.push({ label: epub.toc[ti].label, page: pi });
              }
            }
          }
        }
      }
      // If matching by file failed, try matching by label text in pages
      if (tocMap.length === 0 && epub.toc && epub.toc.length > 0) {
        var doneLabels = {};
        for (var ti2 = 0; ti2 < epub.toc.length; ti2++) {
          var searchLabel = epub.toc[ti2].label;
          if (doneLabels[searchLabel]) continue;
          doneLabels[searchLabel] = true;
          for (var pi2 = 0; pi2 < pageEls.length; pi2++) {
            if (pageEls[pi2].textContent.indexOf(searchLabel) >= 0) {
              tocMap.push({ label: searchLabel, page: pi2 });
              break;
            }
          }
        }
      }
      window._epubTocMap = tocMap;

      // Setup word-tap on each page
      setupWordTapOnDiv(scroller);

      return { container: scroller, pageWidth: pageWidth, pageHeight: pageHeight, totalPages: pages.length, tocMap: tocMap };
    });
  });
}

// Split full HTML content into page-sized chunks
function buildPages(fullHtml, pageWidth, pageHeight) {
  var measure = document.createElement('div');
  measure.style.cssText = 'position:fixed;left:-9999px;top:0;' +
    'width:' + pageWidth + 'px;height:auto;overflow:hidden;' +
    'font-family:Georgia,"Times New Roman","Noto Serif SC",serif;' +
    'font-size:18px;line-height:1.8;color:#1a1a1a;' +
    'word-wrap:break-word;overflow-wrap:break-word;';
  measure.innerHTML = fullHtml;
  document.body.appendChild(measure);

  // Collect all visible block-level elements at any depth
  var blocks = measure.querySelectorAll('p, h1, h2, h3, h4, h5, h6, img, blockquote, li, hr, table, pre, div.calibre, div.calibre1, div.s, div.s1, div[style*="text-align"]');
  if (blocks.length === 0) {
    blocks = measure.querySelectorAll('div, p, span');
  }

  var pages = [];
  var contentHeight = pageHeight - 40;
  var tempPage = document.createElement('div');
  tempPage.style.cssText = 'width:' + pageWidth + 'px;height:auto;overflow:hidden;';
  measure.appendChild(tempPage);

  for (var i = 0; i < blocks.length; i++) {
    var clone = blocks[i].cloneNode(true);
    tempPage.appendChild(clone);

    if (tempPage.scrollHeight > contentHeight) {
      tempPage.removeChild(clone);
      if (tempPage.innerHTML.trim()) {
        pages.push(tempPage.innerHTML);
      }
      tempPage.innerHTML = '';
      tempPage.appendChild(clone);
    }
  }

  if (tempPage.innerHTML.trim()) {
    pages.push(tempPage.innerHTML);
  }

  if (tempPage.parentNode) tempPage.parentNode.removeChild(tempPage);
  document.body.removeChild(measure);

  if (pages.length === 0) pages.push(fullHtml);
  return pages;
}

// Find NCX path from manifest or by searching
function findNcxPath(zip, epub) {
  // Check manifest for NCX media type
  for (var id in epub._manifest) {
    if (epub._manifest[id] === 'toc.ncx' || id === 'ncx') {
      return resolveHref(epub._basePath, epub._manifest[id]);
    }
  }
  // Fallback: try standard locations
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
  var sx = 0, sy = 0, st = 0, moved = false;

  el.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      st = Date.now();
      moved = false;
    }
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    if (Math.abs(e.touches[0].clientX - sx) > 8 ||
        Math.abs(e.touches[0].clientY - sy) > 8) {
      moved = true;
    }
  }, { passive: true });

  el.addEventListener('touchend', function(e) {
    if (moved || (Date.now() - st) > 400) return;
    var x = e.changedTouches[0].clientX;
    var y = e.changedTouches[0].clientY;
    var range;

    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range || !range.startContainer) return;
    var n = range.startContainer;
    if (n.nodeType !== 3) return;

    var t = n.textContent;
    var o = range.startOffset, s2 = o, e2 = o;
    while (s2 > 0 && /[a-zA-Z]/.test(t[s2 - 1])) s2--;
    while (e2 < t.length && /[a-zA-Z]/.test(t[e2])) e2++;
    var w = t.slice(s2, e2);
    if (w.length > 1 && /^[a-zA-Z]+$/.test(w)) {
      window.postMessage({ type: 'word-tap', word: w.toLowerCase() }, '*');
    }
  });
}
