/**
 * Utility functions for YT Translate.
 * Attaches to global YTTranslate namespace.
 */
(function () {
  var utils = {};

  /** Debounce: delays fn until `delay` ms after last call. */
  utils.debounce = function (fn, delay) {
    delay = delay || 300;
    var timer;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  };

  /** Simple string hash (djb2) for cache keys. */
  utils.hash = function (str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  };

  /** Wait for an element to appear in the DOM. */
  utils.waitForElement = function (selector, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);
      var observer = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); reject(new Error('Timeout')); }, timeout);
    });
  };

  window.YTTranslate = window.YTTranslate || {};
  window.YTTranslate.utils = utils;
})();
