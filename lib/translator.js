/**
 * DeepSeek API translator client.
 * Delegates API calls to the background service worker via chrome.runtime.sendMessage.
 */
(function () {
  var cache = new YTTranslate.LRUCache();

  function Translator() {}

  /**
   * Translate a batch of texts. Uses a separator-based batching for efficiency.
   * @param {string[]} texts
   * @returns {Promise<string[]>}
   */
  Translator.prototype.translateBatch = function (texts) {
    // Filter out empty and cache hits
    var toTranslate = [];
    var results = [];
    var cacheIndexes = {};

    for (var i = 0; i < texts.length; i++) {
      var t = texts[i].trim();
      if (!t) { results[i] = ''; continue; }
      var key = YTTranslate.utils.hash(t);
      var cached = cache.get(key);
      if (cached !== undefined) {
        results[i] = cached;
        cacheIndexes[i] = true;
      } else {
        toTranslate.push(t);
        cacheIndexes[i] = false;
      }
    }

    if (toTranslate.length === 0) {
      return Promise.resolve(results);
    }

    var input = toTranslate.join('|||');
    return this._sendToBackground(input).then(function (output) {
      var parts = output.split('|||');
      var j = 0;
      for (var i = 0; i < texts.length; i++) {
        if (cacheIndexes[i] === false) {
          var translated = (parts[j] || '').trim();
          results[i] = translated;
          cache.set(YTTranslate.utils.hash(texts[i].trim()), translated);
          j++;
        }
      }
      return results;
    });
  };

  /**
   * Translate a single text.
   */
  Translator.prototype.translate = function (text) {
    return this.translateBatch([text]).then(function (r) { return r[0]; });
  };

  /**
   * Send translation request to background service worker.
   */
  Translator.prototype._sendToBackground = function (text) {
    var self = this;
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', text: text },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else if (response && response.translated) {
            resolve(response.translated);
          } else {
            reject(new Error('Unexpected response from background'));
          }
        }
      );
    });
  };

  /** Clear the translation cache. */
  Translator.prototype.clearCache = function () {
    cache.clear();
  };

  YTTranslate.Translator = Translator;
})();
