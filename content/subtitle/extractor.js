/**
 * Subtitle data extractor for YouTube.
 *
 * 字幕提取策略（2025+ PoToken 时代）：
 *
 *   策略 1（主方案）：CC 按钮触发 + MAIN world 拦截
 *     - 点击 YouTube 的 CC 字幕按钮，让 YouTube 自己去请求 timedtext
 *     - MAIN world 的 fetcher.js 已猴子补丁了 fetch/XHR，自动捕获响应
 *     - 通过 window.postMessage 把数据传给 isolated world
 *
 *   策略 2（备用）：Transcript Panel DOM 读取
 *     - 点击 YouTube 的"显示字幕稿"按钮，从 DOM 面板读文本
 *     - 绕过 PoToken，但依赖 YouTube UI 结构
 */
(function () {
  var extractor = {};

  // ================================================================
  //  注入 MAIN world 拦截脚本（兼容所有 Chrome 版本）
  //
  //  通过 <script src="..."> 加载 fetcher.js 到页面主世界。
  //  不需要 "world": "MAIN"（Chrome 128+），兼容旧版本。
  //  CSP 允许：fetcher.js 在 web_accessible_resources 中声明。
  // ================================================================
  var _fetcherReady = false;
  var _fetcherReadyCallbacks = [];

  function _onFetcherReady(cb) {
    if (_fetcherReady) { cb(); return; }
    _fetcherReadyCallbacks.push(cb);
  }

  (function _injectFetcher() {
    window.addEventListener('message', function onReady(event) {
      if (event.data && event.data.source === 'yt-translate-fetcher' &&
          event.data.type === 'YT_FETCHER_READY') {
        _fetcherReady = true;
        var cbs = _fetcherReadyCallbacks;
        _fetcherReadyCallbacks = [];
        for (var k = 0; k < cbs.length; k++) cbs[k]();
      }
    });

    function doInject() {
      var script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/subtitle/fetcher.js');
      script.onload = function () { script.remove(); };
      (document.head || document.documentElement).appendChild(script);
      console.log('YT Translate: Injected MAIN world fetcher');
    }

    if (document.head) { doInject(); }
    else {
      var obs = new MutationObserver(function () {
        if (document.head) { obs.disconnect(); doInject(); }
      });
      obs.observe(document.documentElement, { childList: true });
    }
  })();

  // ================================================================
  //  从 DOM script 标签中提取 ytInitialPlayerResponse JSON
  // ================================================================

  extractor.getPlayerResponse = function () {
    var self = this;
    return new Promise(function (resolve) {
      var attempts = 0;
      var maxAttempts = 30;

      function tryExtract() {
        attempts++;
        var data = self._extractFromDOM();
        if (data && data.captions) {
          resolve(data);
          return;
        }
        if (attempts < maxAttempts) {
          setTimeout(tryExtract, 500);
        } else {
          console.warn('YT Translate: ytInitialPlayerResponse not found after ' + maxAttempts + ' attempts');
          resolve(null);
        }
      }

      tryExtract();
    });
  };

  extractor._extractFromDOM = function () {
    var scripts = document.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      var marker = 'ytInitialPlayerResponse';
      var idx = text.indexOf(marker);
      if (idx === -1) continue;

      var afterMarker = text.substring(idx);
      var eqIdx = afterMarker.indexOf('=');
      if (eqIdx === -1 || eqIdx > 200) continue;
      var braceIdx = afterMarker.indexOf('{', eqIdx);
      if (braceIdx === -1 || braceIdx > 300) continue;

      var start = idx + braceIdx;

      var depth = 0, inString = false, escape = false;
      for (var j = start; j < text.length; j++) {
        var ch = text[j];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') { depth++; }
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.substring(start, j + 1));
            } catch (e) { break; }
          }
        }
      }
    }
    return null;
  };

  // ================================================================
  //  从 playerResponse 提取字幕轨道信息
  // ================================================================

  extractor.getCaptionTracks = function (playerResponse) {
    try {
      var tracks = playerResponse.captions
        .playerCaptionsTracklistRenderer
        .captionTracks;
      if (!tracks || tracks.length === 0) return null;

      var selectedIndex = 0;
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].languageCode === 'en' && tracks[i].kind !== 'asr') {
          selectedIndex = i; break;
        }
      }
      if (selectedIndex === 0) {
        for (var j = 0; j < tracks.length; j++) {
          if (tracks[j].languageCode === 'en') {
            selectedIndex = j; break;
          }
        }
      }
      return { tracks: tracks, selectedIndex: selectedIndex };
    } catch (e) {
      console.warn('YT Translate: Failed to extract caption tracks', e);
      return null;
    }
  };

  // ================================================================
  //  策略 1：CC 按钮触发 + MAIN world 拦截
  // ================================================================

  /**
   * 点击 YouTube CC 字幕按钮，触发 YouTube 自己请求 timedtext，
   * 然后等待 MAIN world fetcher 拦截响应。
   *
   * @param {string} videoId - 当前视频 ID（用于校验拦截数据是否匹配）
   * @returns {Promise<Array<{start, dur, text}>>}
   */
  extractor._triggerAndWaitForCaptions = function (videoId) {
    var self = this;
    return new Promise(function (resolve) {
      var timeoutMs = 25000; // 最多等 25 秒
      var startTime = Date.now();
      var settled = false;

      function finish(subtitles) {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimeout);
        clearInterval(pollInterval);
        window.removeEventListener('message', onMessage);
        resolve(subtitles || []);
      }

      // 超时兜底
      var fallbackTimeout = setTimeout(function () {
        console.warn('YT Translate: Timed out waiting for caption intercept (' + timeoutMs / 1000 + 's)');
        finish([]);
      }, timeoutMs);

      // 周期检查兜底
      var pollInterval = setInterval(function () {
        if (Date.now() - startTime > timeoutMs) {
          finish([]);
        }
      }, 1000);

      // 监听来自 MAIN world 的拦截消息
      function onMessage(event) {
        if (!event.data || event.data.source !== 'yt-translate-fetcher') return;

        if (event.data.type === 'YT_TIMEDTEXT_INTERCEPTED') {
          var data = event.data;
          // 校验数据完整性
          if (!data.text || data.text.length < 50) return;
          // 校验视频 ID 匹配（如果有的话）
          if (data.videoId && videoId && data.videoId !== videoId) {
            console.log('YT Translate: Ignoring intercept for different video: ' + data.videoId);
            return;
          }

          console.log('YT Translate: Captured timedtext! ' + data.text.length + ' chars');
          var subtitles = self._parseTimedText(data.text);
          if (subtitles.length > 0) {
            console.log('YT Translate: Parsed ' + subtitles.length + ' subtitles from intercept');
            finish(subtitles);
          } else {
            console.warn('YT Translate: Intercepted text parsed to 0 subtitles');
          }
        }

        // 也处理对已拦截数据的查询响应（CC 按钮已开启的情况）
        if (event.data.type === 'YT_INTERCEPTED_RESPONSE') {
          if (event.data.text && event.data.text.length > 50) {
            if (event.data.videoId && videoId && event.data.videoId !== videoId) return;
            var subtitles = self._parseTimedText(event.data.text);
            if (subtitles.length > 0) {
              console.log('YT Translate: Using already-intercepted data (' + subtitles.length + ' subs)');
              finish(subtitles);
            }
          }
        }
      }

      window.addEventListener('message', onMessage);

      // --- Step 1: 清除旧拦截数据（SPA 导航安全） ---
      window.postMessage({
        target: 'yt-translate-fetcher',
        type: 'YT_CLEAR_INTERCEPTED'
      }, '*');

      // --- Step 2: 操作 CC 按钮 ---
      var ccBtn = document.querySelector('.ytp-subtitles-button');
      if (ccBtn) {
        var pressed = ccBtn.getAttribute('aria-pressed');
        console.log('YT Translate: CC button found, aria-pressed=' + pressed);

        if (pressed === 'false') {
          // 字幕关闭 → 点击打开，触发 YouTube 请求 timedtext
          ccBtn.click();
          console.log('YT Translate: Clicked CC button → waiting for timedtext intercept...');
        } else {
          // 字幕已开启 → 先检查是否已有拦截数据
          console.log('YT Translate: Captions already on, checking for cached data...');
          window.postMessage({
            target: 'yt-translate-fetcher',
            type: 'YT_GET_INTERCEPTED'
          }, '*');

          // 如果没有已拦截数据，关闭再打开以触发新请求
          setTimeout(function () {
            if (settled) return;
            console.log('YT Translate: No cached data, toggling CC off/on to re-trigger...');
            ccBtn.click(); // 关闭
            setTimeout(function () {
              if (settled) return;
              ccBtn.click(); // 重新打开 → 触发 timedtext 请求
            }, 400);
          }, 2000);
        }
      } else {
        console.log('YT Translate: CC button not found — user may need to enable captions manually');
        // CC 按钮还没渲染，等它出现后再试
        var ccRetries = 0;
        var ccInterval = setInterval(function () {
          if (settled) { clearInterval(ccInterval); return; }
          ccRetries++;
          var btn = document.querySelector('.ytp-subtitles-button');
          if (btn) {
            clearInterval(ccInterval);
            var p = btn.getAttribute('aria-pressed');
            if (p === 'false') {
              btn.click();
              console.log('YT Translate: CC button appeared, clicked it');
            }
          }
          if (ccRetries > 30) clearInterval(ccInterval); // 15 秒放弃
        }, 500);
      }
    });
  };

  // ================================================================
  //  TIMED TEXT 解析
  // ================================================================

  extractor._parseTimedText = function (rawText) {
    if (!rawText || rawText.trim().length < 10) {
      console.warn('YT Translate: TimedText too short (' + (rawText ? rawText.length : 0) + ' chars)');
      return [];
    }

    // 尝试 XML（srv3 格式）
    var trimmed = rawText.trim();
    if (trimmed.indexOf('<?xml') === 0 || trimmed.indexOf('<transcript') === 0) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(rawText, 'text/xml');
      if (doc.querySelector('parsererror')) {
        console.warn('YT Translate: XML parse error');
        return [];
      }
      var texts = doc.querySelectorAll('text');
      var subs = [];
      for (var i = 0; i < texts.length; i++) {
        var el = texts[i];
        var start = parseFloat(el.getAttribute('start') || '0');
        var dur = parseFloat(el.getAttribute('dur') || '0');
        var text = (el.textContent || '').trim();
        if (text) {
          var ta = document.createElement('textarea');
          ta.innerHTML = text;
          subs.push({ start: start, dur: dur, text: ta.value });
        }
      }
      return subs;
    }

    // 尝试 JSON（json3 格式）
    try {
      var json = JSON.parse(rawText);
      var events = json.events || [];
      var subs = [];
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev.segs) {
          var text = '';
          for (var j = 0; j < ev.segs.length; j++) {
            text += (ev.segs[j].utf8 || '');
          }
          if (text.trim()) {
            subs.push({
              start: (ev.tStartMs || 0) / 1000,
              dur: (ev.dDurationMs || 0) / 1000,
              text: text.trim()
            });
          }
        }
      }
      if (subs.length > 0) return subs;
    } catch (e) { /* 不是 JSON */ }

    // 兜底：尝试宽松 XML 解析
    try {
      var parser2 = new DOMParser();
      var doc2 = parser2.parseFromString(rawText, 'text/xml');
      if (!doc2.querySelector('parsererror')) {
        var texts2 = doc2.querySelectorAll('text');
        var subs2 = [];
        for (var k = 0; k < texts2.length; k++) {
          var el2 = texts2[k];
          var s = parseFloat(el2.getAttribute('start') || '0');
          var d = parseFloat(el2.getAttribute('dur') || '0');
          var txt = (el2.textContent || '').trim();
          if (txt) {
            var ta2 = document.createElement('textarea');
            ta2.innerHTML = txt;
            subs2.push({ start: s, dur: d, text: ta2.value });
          }
        }
        if (subs2.length > 0) return subs2;
      }
    } catch (e2) { /* ignore */ }

    console.warn('YT Translate: Unable to parse timedtext, first 100 chars: ' +
      rawText.substring(0, 100));
    return [];
  };

  // ================================================================
  //  策略 2：Transcript Panel DOM 读取（备用方案）
  // ================================================================

  extractor.extractFromTranscriptPanel = function () {
    var self = this;
    return new Promise(function (resolve) {
      console.log('YT Translate: Fallback — trying transcript panel');

      var clicked = self._clickTranscriptButton();
      if (!clicked) {
        console.log('YT Translate: Transcript button not found');
        resolve(null);
        return;
      }

      var attempts = 0;
      var maxAttempts = 40;

      function poll() {
        attempts++;
        var segments = self._readTranscriptSegments();
        if (segments && segments.length > 0) {
          console.log('YT Translate: Transcript panel: ' + segments.length + ' segments');
          setTimeout(function () { self._closeTranscriptPanel(); }, 1500);
          resolve(segments);
          return;
        }
        if (attempts < maxAttempts) {
          setTimeout(poll, 250);
        } else {
          console.warn('YT Translate: Transcript panel timeout');
          self._closeTranscriptPanel();
          resolve(null);
        }
      }

      setTimeout(poll, 500);
    });
  };

  extractor._clickTranscriptButton = function () {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var label = (buttons[i].getAttribute('aria-label') || '').toLowerCase();
      var text = (buttons[i].textContent || '').toLowerCase();
      if (label.indexOf('transcript') !== -1 || label.indexOf('字幕') !== -1 ||
          text.indexOf('transcript') !== -1 || text.indexOf('字幕') !== -1) {
        buttons[i].click();
        console.log('YT Translate: Clicked transcript button');
        return true;
      }
    }

    // 展开描述区再搜
    var expandBtns = document.querySelectorAll('#expand, #expand-button, .ytd-text-inline-expander button');
    for (var j = 0; j < expandBtns.length; j++) { expandBtns[j].click(); }

    setTimeout(function () {
      var allBtns = document.querySelectorAll('button');
      for (var k = 0; k < allBtns.length; k++) {
        var l = (allBtns[k].getAttribute('aria-label') || '').toLowerCase();
        var t = (allBtns[k].textContent || '').toLowerCase();
        if (l.indexOf('transcript') !== -1 || t.indexOf('transcript') !== -1) {
          allBtns[k].click(); break;
        }
      }
    }, 500);

    return true;
  };

  extractor._closeTranscriptPanel = function () {
    var btns = document.querySelectorAll('button[aria-label*="Close"], button[aria-label*="关闭"]');
    for (var i = 0; i < btns.length; i++) {
      var label = (btns[i].getAttribute('aria-label') || '').toLowerCase();
      if (label.indexOf('transcript') !== -1 || label.indexOf('字幕') !== -1) {
        btns[i].click(); return;
      }
    }
  };

  extractor._readTranscriptSegments = function () {
    var selectors = [
      'ytd-transcript-segment-renderer',
      'ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer',
      '#transcript-panel ytd-transcript-segment-renderer',
      'ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer'
    ];
    var segments = null;
    for (var s = 0; s < selectors.length; s++) {
      segments = document.querySelectorAll(selectors[s]);
      if (segments.length > 0) break;
    }
    if (!segments || segments.length === 0) return [];

    var subtitles = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var tsEl = seg.querySelector('.segment-timestamp, #timestamp, [class*="timestamp"]');
      var startSec = 0, durSec = 2;
      if (tsEl) {
        var parts = (tsEl.textContent || '').trim().split(':');
        if (parts.length === 2) startSec = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        else if (parts.length === 3) startSec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
      }
      if (i < segments.length - 1) {
        var nextTs = segments[i + 1].querySelector('.segment-timestamp, #timestamp, [class*="timestamp"]');
        if (nextTs) {
          var nextParts = (nextTs.textContent || '').trim().split(':');
          var nextSec = 0;
          if (nextParts.length === 2) nextSec = parseInt(nextParts[0], 10) * 60 + parseInt(nextParts[1], 10);
          else if (nextParts.length === 3) nextSec = parseInt(nextParts[0], 10) * 3600 + parseInt(nextParts[1], 10) * 60 + parseInt(nextParts[2], 10);
          durSec = nextSec - startSec;
          if (durSec <= 0) durSec = 2;
        }
      }
      var textEl = seg.querySelector('.segment-text, #segment-text, [class*="segment-text"], yt-formatted-string');
      var text = (textEl ? textEl.textContent : seg.textContent || '').trim();
      if (text) subtitles.push({ start: startSec, dur: durSec, text: text });
    }
    return subtitles;
  };

  // ================================================================
  //  完整提取流程
  // ================================================================

  extractor.extractSubtitles = function () {
    var self = this;
    var videoId = new URLSearchParams(location.search).get('v');

    return new Promise(function (resolve) {
      // 必须等 MAIN world fetcher 脚本加载就绪
      _onFetcherReady(function () {
        self.getPlayerResponse().then(function (playerResponse) {
          var trackInfo = null;

          if (playerResponse) {
            var trackData = self.getCaptionTracks(playerResponse);
            if (trackData && trackData.tracks[trackData.selectedIndex]) {
              var t = trackData.tracks[trackData.selectedIndex];
              trackInfo = {
                languageCode: t.languageCode,
                name: t.name ? (t.name.simpleText || t.languageCode) : t.languageCode,
                isAutoGenerated: t.kind === 'asr'
              };
            }
          }

          // === 策略 1：CC 按钮触发 + MAIN world 拦截 ===
          console.log('YT Translate: Strategy 1 — trigger CC + wait for timedtext intercept');
          return self._triggerAndWaitForCaptions(videoId).then(function (subtitles) {
            if (subtitles && subtitles.length > 0) {
              resolve({ subtitles: subtitles, trackInfo: trackInfo });
              return;
            }

            // === 策略 2：Transcript Panel 备用 ===
            console.log('YT Translate: Strategy 1 failed, trying transcript panel');
            self.extractFromTranscriptPanel().then(function (ts) {
              if (ts && ts.length > 0) {
                resolve({
                  subtitles: ts,
                  trackInfo: trackInfo || {
                    languageCode: 'en', name: 'English', isAutoGenerated: true
                  }
                });
              } else {
                console.warn('YT Translate: All subtitle extraction strategies failed');
                resolve(null);
              }
            });
          });
        }).catch(function (err) {
          console.warn('YT Translate: extractSubtitles error:', err.message);
          resolve(null);
        });
      });
    });
  };

  YTTranslate.extractor = extractor;
})();
