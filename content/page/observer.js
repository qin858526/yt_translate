/**
 * MutationObserver for monitoring YouTube DOM changes.
 * Detects new content elements that need translation.
 */
(function () {
  var observer = {};
  var mo = null;
  var isActive = false;
  var settings = {};

  /**
   * Start observing the page for translatable elements.
   * @param {object} opts - Feature toggle settings
   */
  observer.start = function (opts) {
    settings = opts || {};
    if (isActive) return;
    isActive = true;

    // Initial scan
    observer.scanAll();

    // Debounced handler for MutationObserver
    var schedule = YTTranslate.utils.debounce(function () {
      if (!isActive) return;
      observer.scanAll();
    }, 300);

    mo = new MutationObserver(function (mutations) {
      var hasNewNodes = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) schedule();
    });

    mo.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also scan on scroll (for lazy-loaded comments)
    var scrollHandler = YTTranslate.utils.debounce(function () {
      if (!isActive) return;
      observer.scanAll();
    }, 500);
    window.addEventListener('scroll', scrollHandler, { passive: true });
    observer._scrollHandler = scrollHandler;
  };

  /**
   * Stop observing and clean up.
   */
  observer.stop = function () {
    isActive = false;
    if (mo) { mo.disconnect(); mo = null; }
    if (observer._scrollHandler) {
      window.removeEventListener('scroll', observer._scrollHandler);
    }
  };

  /**
   * Scan all translatable categories and inject translations.
   */
  observer.scanAll = function () {
    var categories = ['title', 'description', 'comments', 'liveChat', 'chapters'];
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      // Check if this category is enabled
      if (settings[cat] === false) continue;
      var els = YTTranslate.selectors.getElements(cat);
      YTTranslate.injector.injectBatch(els);
    }
  };

  YTTranslate.observer = observer;
})();
