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
    for (var i = 0; i < Math.min(state.subtitles.length, translations.length); i++) {
      state.subtitles[i].translated = translations[i];
    }
  };

  /**
   * Mount the overlay on the video element.
   */
  overlay.mount = function () {
    // Find video element
    var video = document.querySelector('video.video-stream.html5-main-video');
    if (!video) {
      // Retry after a short delay
      setTimeout(function () { overlay.mount(); }, 500);
      return;
    }

    state.videoEl = video;

    // Find container
    var container = video.closest('.html5-video-container');
    if (!container) {
      container = video.parentElement;
    }
    state.containerEl = container;

    // Remove existing overlay if any
    var existing = container.querySelector('.yt-translate-overlay');
    if (existing) existing.remove();

    // Create overlay
    var el = document.createElement('div');
    el.className = 'yt-translate-overlay';
    container.appendChild(el);
    state.overlayEl = el;

    // Set up sync loop
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
    }
    html += '</div>';

    state.overlayEl.innerHTML = html;
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
    function loop() {
      if (!state.isActive || !state.videoEl) return;
      state.rafId = requestAnimationFrame(loop);

      var currentTime = state.videoEl.currentTime;
      if (isNaN(currentTime)) return;

      var index = overlay._findSubtitle(currentTime);
      overlay._render(index);
    }
    state.rafId = requestAnimationFrame(loop);
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
      // The overlay uses percentage-based positioning, so CSS handles most cases.
      // We just need to update fullscreen class if needed.
      if (state.overlayEl) {
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
