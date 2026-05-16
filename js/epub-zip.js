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
          var re = /<item[^>]+id="([^"]*)"[^>]+href="([^"]*)"[^>]*>/gi;
          var item;
          while ((item = re.exec(manMatch[1]))) {
            epub._manifest[item[1]] = item[2];
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

        return epub;
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
    // Collect all image references
    var allImages = {};
    htmls.forEach(function(html) {
      html.replace(/src="([^"]+)"/gi, function(m, src) {
        if (!/^(https?:|data:)/i.test(src)) {
          allImages[src] = true;
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

      // Replace image src with blob URLs
      var fullHtml = htmls.map(function(html) {
        return html.replace(/src="([^"]+)"/gi, function(m, src) {
          if (imgMap[src]) return 'src="' + imgMap[src] + '"';
          return m;
        });
      }).join('\n<hr style="border:none;margin:20px 0;"/>');

      // Render in iframe
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:100%;min-height:100%;border:none;background:#fff;';
      iframe.sandbox = 'allow-scripts allow-same-origin';
      container.innerHTML = '';
      container.appendChild(iframe);

      var doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
        'body{font-family:Georgia,"Times New Roman","Noto Serif SC",serif;font-size:100%;line-height:1.8;padding:16px 20px;color:#1a1a1a;background:#fff;-webkit-text-size-adjust:100%;word-wrap:break-word;}' +
        'img{max-width:100%;height:auto;}' +
        'p{margin-bottom:0.8em;}' +
        '</style></head><body>' + fullHtml + '</body></html>');
      doc.close();

      // Setup word-tap on iframe
      setupWordTap(iframe);

      return iframe;
    });
  });
}

function resolveHref(base, href) {
  var parts = base.split('/');
  parts.pop();
  href.split('/').forEach(function(seg) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  });
  return parts.join('/');
}

function extractTag(xml, tag) {
  var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  var m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function guessMimeType(path) {
  var ext = path.split('.').pop().toLowerCase();
  var m = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', svg:'image/svg+xml', webp:'image/webp' };
  return m[ext] || 'image/octet-stream';
}

function setupWordTap(iframe) {
  try {
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc) return;

    var script = doc.createElement('script');
    script.textContent = [
      '(function(){',
      'var sx=0,sy=0,st=0,moved=false;',
      'document.addEventListener("touchstart",function(e){',
      'if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY;st=Date.now();moved=false;}',
      '},{passive:true});',
      'document.addEventListener("touchmove",function(e){',
      'if(Math.abs(e.touches[0].clientX-sx)>8||Math.abs(e.touches[0].clientY-sy)>8)moved=true;',
      '},{passive:true});',
      'document.addEventListener("touchend",function(e){',
      'if(moved||Date.now()-st>400)return;',
      'var x=e.changedTouches[0].clientX,y=e.changedTouches[0].clientY,range;',
      'if(document.caretRangeFromPoint)range=document.caretRangeFromPoint(x,y);',
      'else if(document.caretPositionFromPoint){var p=document.caretPositionFromPoint(x,y);',
      'if(p){range=document.createRange();range.setStart(p.offsetNode,p.offset);range.setEnd(p.offsetNode,p.offset);}}',
      'if(!range||!range.startContainer)return;',
      'var n=range.startContainer;if(n.nodeType!==3)return;',
      'var t=n.textContent,o=range.startOffset,s=o,e2=o;',
      'while(s>0&&/[a-zA-Z]/.test(t[s-1]))s--;',
      'while(e2<t.length&&/[a-zA-Z]/.test(t[e2]))e2++;',
      'var w=t.slice(s,e2);',
      'if(w.length>1&&/^[a-zA-Z]+$/.test(w))window.parent.postMessage({type:"word-tap",word:w.toLowerCase()},"*");',
      '});',
      '})();'
    ].join('\n');
    doc.body.appendChild(script);
  } catch(e) {}
}
