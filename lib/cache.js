
(function () {
  function LRUCache(maxSize) {
    this.maxSize = maxSize || 2000;
    this.map = new Map();
  }

  LRUCache.prototype.get = function (key) {
    if (!this.map.has(key)) return undefined;
    var value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  };

  LRUCache.prototype.set = function (key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      var firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  };

  LRUCache.prototype.has = function (key) { return this.map.has(key); };
  LRUCache.prototype.clear = function () { this.map.clear(); };

  Object.defineProperty(LRUCache.prototype, 'size', {
    get: function () { return this.map.size; }
  });

  window.YTTranslate = window.YTTranslate || {};
  window.YTTranslate.LRUCache = LRUCache;
})();
