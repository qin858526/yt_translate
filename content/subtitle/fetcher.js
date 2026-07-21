/**
 * YT Translate — Main World Fetcher
 *
 * 运行在 YouTube 页面的 JavaScript 主世界中（与 YouTube 脚本共享上下文）。
 *
 * 核心功能：
 *   猴子补丁 fetch 和 XMLHttpRequest，拦截 YouTube 发往 timedtext API 的请求。
 *   当 YouTube 播放器加载字幕时，自动捕获响应数据并转发给 isolated world
 *   的 content script。
 *
 * 为什么必须这样做？
 *   YouTube 2025 年起对 timedtext API 要求 PoToken（Proof-of-Origin Token）。
 *   这个 token 由 YouTube 自己的 JS 在运行时动态生成，附加在请求 URL 上。
 *   Content script（isolated world）发起的 fetch 没有 PoToken → 返回空响应。
 *   但 YouTube 自己的请求一定带 PoToken → 我们拦截响应即可获取数据。
 *
 * 通信方式：window.postMessage（DOM 共享，isolated ↔ MAIN 双向可达）
 */
(function () {
  'use strict';

  // ============================================================
  // 存储拦截到的 timedtext 数据
  // _intercepted: {url, text, timestamp}
  // ============================================================
  var _intercepted = null;

  function _notifyContent(data) {
    data.source = 'yt-translate-fetcher';
    window.postMessage(data, '*');
  }

  /**
   * 清除旧拦截数据（SPA 导航时由 content script 调用）
   */
  function _clearIntercepted() {
    _intercepted = null;
  }

  // ============================================================
  // 猴子补丁：window.fetch
  // ============================================================
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    if (typeof input === 'string') url = input;
    else if (input && input.url) url = input.url;
    else if (input && input.href) url = input.href;

    // 先调用原始 fetch，确保不阻塞 YouTube 的请求
    var promise;
    try { promise = _origFetch.call(this, input, init); }
    catch (e) { throw e; }

    // 异步拦截 timedtext 响应（fire-and-forget，不阻塞）
    if (url.indexOf('/api/timedtext') !== -1) {
      promise.then(function (resp) {
        if (!resp || !resp.ok) return;
        try {
          var cloned = resp.clone();
          cloned.text().then(function (text) {
            if (!text || text.length < 50) return;
            // 通过 URL 中的 v 参数提取视频 ID
            var videoId = '';
            try {
              videoId = new URL(url).searchParams.get('v') || '';
            } catch (e) {}
            _intercepted = { url: url, text: text, videoId: videoId, ts: Date.now() };
            _notifyContent({
              type: 'YT_TIMEDTEXT_INTERCEPTED',
              url: url,
              text: text,
              videoId: videoId
            });
          }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
    }

    return promise;
  };

  // ============================================================
  // 猴子补丁：XMLHttpRequest（YouTube 有时用 XHR 而不是 fetch）
  // ============================================================
  var _OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    var xhr = new _OrigXHR();
    var _open = xhr.open;
    var _send = xhr.send;
    var _url = '';

    xhr.open = function (method, url) {
      _url = url || '';
      return _open.apply(this, arguments);
    };

    xhr.send = function () {
      if (_url.indexOf('/api/timedtext') !== -1) {
        xhr.addEventListener('load', function () {
          if (xhr.status !== 200 || !xhr.responseText || xhr.responseText.length < 50) return;
          var videoId = '';
          try { videoId = new URL(_url).searchParams.get('v') || ''; } catch (e) {}
          _intercepted = { url: _url, text: xhr.responseText, videoId: videoId, ts: Date.now() };
          _notifyContent({
            type: 'YT_TIMEDTEXT_INTERCEPTED',
            url: _url,
            text: xhr.responseText,
            videoId: videoId
          });
        });
      }
      return _send.apply(this, arguments);
    };

    return xhr;
  };
  window.XMLHttpRequest.prototype = _OrigXHR.prototype;

  // ============================================================
  // 消息监听：处理来自 isolated world content script 的指令
  // ============================================================
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.target !== 'yt-translate-fetcher') return;

    switch (data.type) {

      // 获取已经拦截到的 timedtext 数据
      case 'YT_GET_INTERCEPTED':
        _notifyContent({
          type: 'YT_INTERCEPTED_RESPONSE',
          text: _intercepted ? _intercepted.text : null,
          url: _intercepted ? _intercepted.url : null,
          videoId: _intercepted ? _intercepted.videoId : null
        });
        break;

      // 清除旧拦截数据（SPA 导航前调用）
      case 'YT_CLEAR_INTERCEPTED':
        _clearIntercepted();
        break;
    }
  });

  // 通知 isolated world 已就绪
  _notifyContent({ type: 'YT_FETCHER_READY' });

})();
