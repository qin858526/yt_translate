/**
 * Subtitle overlay renderer.
 * Mounts a transparent overlay on the YouTube video and renders bilingual subtitles.
 * Synchronizes with video.currentTime via requestAnimationFrame.
 */
(function () {
  var overlay = {};

  var state = {
    subtitles: [],         // {start, dur, text, translated}[]
    overlayEl: null,
    videoEl: null,
    containerEl: null,
    rafId: null,
    resizeObserver: null,
    isActive: false,
    lastIndex: -1
  };

  /**
   * Initialize the subtitle overlay system.
   * @param {Array} subtitles - Array of {start, dur, text} from extractor
   * @param {string} videoId - YouTube video ID for caching
   */
  overlay.init = function (subtitles, videoId) {
    state.subtitles = subtitles;
    state.lastIndex = -1;
    this.mount();
  };

  /**
   * Update subtitles with translated text.
   * @param {string[]} translations - Array of translated strings, index-matched to subtitles
   */
  overlay.setTranslations = function (translations) {
    var count = 0;
    for (var i = 0; i < Math.min(state.subtitles.length, translations.length); i++) {
      state.subtitles[i].translated = translations[i];
      if (translations[i]) count++;
    }
    // 强制下次 rAF 重新渲染当前字幕（即使 index 没变，翻译内容已更新）
    state.lastIndex = -1;
    console.log('YT Translate: setTranslations — ' + count + '/' + state.subtitles.length +
      ' subtitles have translations');
  };

  /**
   * Mount the overlay on the video element.
   */
  overlay.mount = function () {
    var video = document.querySelector('video.video-stream.html5-main-video');
    if (!video) {
      console.log('YT Translate: overlay.mount — video not found, retrying...');
      setTimeout(function () { overlay.mount(); }, 500);
      return;
    }

    state.videoEl = video;

    // 挂在 .html5-video-container（视频区域，不受进度条上下移动影响）
    // 回退到 #movie_player
    var container = video.closest('.html5-video-container') || video.closest('#movie_player');
    if (!container) {
      container = video.parentElement;
    }
    // 强制容器有定位基准，否则 position: absolute 可能定位到错误祖先
    var containerPos = getComputedStyle(container).position;
    if (containerPos === 'static') {
      container.style.position = 'relative';
    }
    state.containerEl = container;

    // 移除已有覆盖层
    var existing = container.querySelector('.yt-translate-overlay');
    if (existing) existing.remove();

    // 隐藏 YouTube 原生字幕窗口（避免和我们的覆盖层重叠）
    var nativeCaption = document.querySelector('.ytp-caption-window-container');
    if (nativeCaption) {
      nativeCaption.style.display = 'none';
    }

    // 创建覆盖层，高度设为视频元素的实际高度
    // （.html5-video-container 可能没有显式高度，不能依赖 CSS height:100%）
    var el = document.createElement('div');
    el.className = 'yt-translate-overlay';
    var videoRect = video.getBoundingClientRect();
    el.style.height = videoRect.height + 'px';
    el.style.width = videoRect.width + 'px';
    container.appendChild(el);
    state.overlayEl = el;

    console.log('YT Translate: Overlay mounted on', container.className || container.tagName);
    // 诊断：输出覆盖层和容器的尺寸，确认定位正确
    var overlayRect = el.getBoundingClientRect();
    var containerRect = container.getBoundingClientRect();
    console.log('YT Translate: Overlay rect:', JSON.stringify(overlayRect));
    console.log('YT Translate: Container rect:', JSON.stringify(containerRect));

    state.isActive = true;
    overlay._startSync();
    overlay._bindEvents();
    overlay._startResizeObserver();
  };

  /**
   * Destroy overlay and clean up.
   */
  overlay.destroy = function () {
    state.isActive = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    if (state.resizeObserver) state.resizeObserver.disconnect();
    overlay._unbindEvents();
    if (state.overlayEl) {
      state.overlayEl.remove();
      state.overlayEl = null;
    }
    // 恢复 YouTube 原生字幕窗口
    var nativeCaption = document.querySelector('.ytp-caption-window-container');
    if (nativeCaption) {
      nativeCaption.style.display = '';
    }
    state.subtitles = [];
    state.lastIndex = -1;
  };

  /**
   * Binary search for the subtitle at currentTime.
   */
  overlay._findSubtitle = function (currentTime) {
    var subs = state.subtitles;
    var lo = 0;
    var hi = subs.length - 1;
    var best = -1;

    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (subs[mid].start <= currentTime) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (best >= 0 && currentTime < subs[best].start + subs[best].dur) {
      return best;
    }
    return -1;
  };

  /**
   * Render subtitle block at given index.
   * 实时翻译策略：字幕第一次出现时立即翻译当前这一条 + 预取后续 5 条。
   * 用 LRU 缓存避免重复翻译。用户快进快退时也能秒出翻译。
   */
  overlay._render = function (index) {
    if (index === state.lastIndex) return;
    state.lastIndex = index;

    if (!state.overlayEl) return;

    if (index < 0) {
      state.overlayEl.innerHTML = '';
      return;
    }

    var sub = state.subtitles[index];
    var translated = sub.translated || '';

    var html = '<div class="yt-translate-subtitle-block">';
    html += '<span class="yt-translate-subtitle-original">' + escapeHtml(sub.text) + '</span>';
    if (translated) {
      html += '<span class="yt-translate-subtitle-translated">' + escapeHtml(translated) + '</span>';
    } else {
      html += '<span class="yt-translate-subtitle-translated" style="opacity:0.6;">翻译中...</span>';
      // 实时翻译：当前字幕 + 预取后续 5 条
      overlay._requestTranslation(index);
    }
    html += '</div>';

    state.overlayEl.innerHTML = html;
  };

  /**
   * 实时翻译一条字幕 + 预取后续 N 条。
   * 每条字幕独立翻译，1-2 秒内返回。已翻译/翻译中的跳过。
   */
  var _translator = null;
  function _getTranslator() {
    if (!_translator) _translator = new YTTranslate.Translator();
    return _translator;
  }

  overlay._requestTranslation = function (index) {
    var sub = state.subtitles[index];
    if (!sub || !sub.text || sub._tlPending) return;

    sub._tlPending = true;
    var tl = _getTranslator();
    tl.translate(sub.text).then(function (result) {
      sub.translated = result || '';
      sub._tlPending = false;
      // 如果当前仍在显示这条字幕，强制下一帧重渲染
      if (state.lastIndex === index) state.lastIndex = -1;
    }).catch(function () {
      sub._tlPending = false;
    });

    // 预翻译接下来的 5 条字幕
    var preFetch = 5;
    for (var i = 1; i <= preFetch; i++) {
      var nextIdx = index + i;
      if (nextIdx >= state.subtitles.length) break;
      var nextSub = state.subtitles[nextIdx];
      if (nextSub.translated || nextSub._tlPending) continue;
      nextSub._tlPending = true;
      (function (idx) {
        tl.translate(state.subtitles[idx].text).then(function (result) {
          state.subtitles[idx].translated = result || '';
          state.subtitles[idx]._tlPending = false;
          if (state.lastIndex === idx) state.lastIndex = -1;
        }).catch(function () {
          state.subtitles[idx]._tlPending = false;
        });
      })(nextIdx);
    }
  };

  /**
   * Show "no captions available" message.
   */
  overlay.showNoCaptions = function () {
    if (state.overlayEl) {
      state.overlayEl.innerHTML =
        '<div class="yt-translate-subtitle-no-captions">' +
        '\u6682\u65e0\u53ef\u7528\u5b57\u5e55 (No captions available)' +
        '</div>';
    }
  };

  /**
   * Start the requestAnimationFrame sync loop.
   */
  overlay._startSync = function () {
    var frameCount = 0;
    function loop() {
      if (!state.isActive || !state.videoEl) return;
      state.rafId = requestAnimationFrame(loop);

      var currentTime = state.videoEl.currentTime;
      if (isNaN(currentTime)) return;

      var index = overlay._findSubtitle(currentTime);

      // 每 60 帧输出一次诊断
      frameCount++;
      if (frameCount % 60 === 0) {
        console.log('YT Translate: rAF sync — time=' + currentTime.toFixed(1) +
          's, sub=' + index + '/' + state.subtitles.length +
          ', hasTranslations=' + (state.subtitles.length > 0 && state.subtitles[0].translated !== undefined));
      }

      overlay._render(index);
    }
    state.rafId = requestAnimationFrame(loop);
    console.log('YT Translate: rAF sync loop started, ' + state.subtitles.length + ' subtitles loaded');
  };

  /**
   * Bind video player events.
   */
  overlay._bindEvents = function () {
    if (!state.videoEl) return;
    state._onSeeked = function () { state.lastIndex = -1; };
    state._onRateChange = function () { state.lastIndex = -1; };
    state.videoEl.addEventListener('seeked', state._onSeeked);
    state.videoEl.addEventListener('ratechange', state._onRateChange);
  };

  /**
   * Unbind video player events.
   */
  overlay._unbindEvents = function () {
    if (state.videoEl && state._onSeeked) {
      state.videoEl.removeEventListener('seeked', state._onSeeked);
      state.videoEl.removeEventListener('ratechange', state._onRateChange);
    }
  };

  /**
   * Observe container resizes (fullscreen, theater mode, window resize).
   */
  overlay._startResizeObserver = function () {
    if (!state.containerEl) return;
    var target = state.containerEl.closest('#movie_player') || state.containerEl;
    state.resizeObserver = new ResizeObserver(function () {
      if (state.overlayEl && state.videoEl) {
        // 视频尺寸变化时（全屏/窗口调整），同步更新覆盖层尺寸
        var vr = state.videoEl.getBoundingClientRect();
        state.overlayEl.style.height = vr.height + 'px';
        state.overlayEl.style.width = vr.width + 'px';
        var isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        state.overlayEl.classList.toggle('fullscreen', isFullscreen);
      }
    });
    state.resizeObserver.observe(target);
  };

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  YTTranslate.overlay = overlay;
})();
