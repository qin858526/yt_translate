/**
 * CSS selectors for YouTube page elements to translate.
 */
(function () {
  var selectors = {
    /** Video title */
    title: [
      'h1.ytd-watch-metadata',
      'h1.style-scope.ytd-watch-metadata'
    ],

    /** Video description */
    description: [
      '#description-inline-expander yt-attributed-string span',
      '#description-inline-expander',
      'ytd-text-inline-expander yt-attributed-string span'
    ],

    /** Comments */
    comments: [
      'ytd-comment-renderer #content-text',
      '#content.ytd-comment-renderer #content-text',
      'ytd-comment-thread-renderer #content-text'
    ],

    /** Live chat messages (live + replay/archive mode) */
    liveChat: [
      // 直播模式（Live）
      'yt-live-chat-text-message-renderer #message',
      'yt-live-chat-paid-message-renderer #message',
      'yt-live-chat-message-renderer #message',
      'yt-live-chat-viewer-engagement-message-renderer #message',
      // 回放模式（Replay / Archive）
      'ytd-live-chat-replay yt-live-chat-text-message-renderer #message',
      'yt-live-chat-replay-item-renderer #message',
      'yt-live-chat-replay-item-renderer #content',
      // 通用兜底（不带特定标签前缀）
      '#message.yt-live-chat-text-message-renderer',
      '#items.yt-live-chat-item-list-renderer #message',
      // 发言用户名
      '#author-name.yt-live-chat-text-message-renderer',
      'yt-live-chat-author-chip #author-name',
      '#author-chip #author-name'
    ],

    /** Video chapter titles */
    chapters: [
      '.ytd-macro-markers-list-item-renderer h4',
      '.ytd-engagement-panel-title-header-renderer yt-formatted-string'
    ]
  };

  /**
   * Get all currently visible elements matching the given category.
   */
  selectors.getElements = function (category) {
    var sels = selectors[category];
    if (!sels) return [];

    var results = [];
    var seen = new WeakSet();

    for (var i = 0; i < sels.length; i++) {
      var els = document.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        if (!seen.has(els[j])) {
          seen.add(els[j]);
          results.push(els[j]);
        }
      }
    }

    return results;
  };

  /**
   * All selectors for MutationObserver matching.
   */
  selectors.allSelectors = function () {
    var all = [];
    for (var key in selectors) {
      if (key === 'getElements' || key === 'allSelectors') continue;
      Array.prototype.push.apply(all, selectors[key]);
    }
    return all;
  };

  YTTranslate.selectors = selectors;
})();
