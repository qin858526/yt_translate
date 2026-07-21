/**
 * Injects translated text into page DOM elements.
 */
(function () {
  var injector = {};
  var translator = new YTTranslate.Translator();

  /**
   * Translate and inject text into a DOM element.
   * Shows bilingual display: original followed by translation.
   */
  injector.inject = function (element) {
    if (element.dataset.ytTranslated === 'true') return;

    // Skip if already contains our injected translation spans.
    // Use querySelector (not classList.contains) because the classes
    // are on child <span> elements, not on the element itself.
    if (element.querySelector('.yt-tl-original') ||
        element.querySelector('.yt-tl-translated')) {
      element.dataset.ytTranslated = 'true';
      return;
    }

    var text = (element.textContent || '').trim();
    if (!text || text.length < 2) return;

    element.dataset.ytTranslated = 'true';

    translator.translate(text).then(function (translated) {
      if (!translated) return;

      if (element.dataset.ytInjectDone === 'true') return;
      element.dataset.ytInjectDone = 'true';

      if (element.querySelector('.yt-tl-original')) return;

      var original = element.textContent.trim();
      element.innerHTML = '';

      var origSpan = document.createElement('span');
      origSpan.className = 'yt-tl-original';
      origSpan.textContent = original;
      origSpan.dataset.ytTranslated = 'true';

      var tlSpan = document.createElement('span');
      tlSpan.className = 'yt-tl-translated';
      tlSpan.textContent = translated;
      tlSpan.dataset.ytTranslated = 'true';

      element.appendChild(origSpan);
      element.appendChild(document.createElement('br'));
      element.appendChild(tlSpan);
    }).catch(function (err) {
      console.warn('YT Translate: injection failed', err);
      element.dataset.ytTranslated = 'false';
    });
  };

  /**
   * Translate a batch of elements.
   */
  injector.injectBatch = function (elements) {
    for (var i = 0; i < elements.length; i++) {
      injector.inject(elements[i]);
    }
  };

  /**
   * Reset translation state on an element.
   */
  injector.reset = function (element) {
    element.dataset.ytTranslated = 'false';
    element.dataset.ytInjectDone = 'false';
    delete element.dataset.ytTranslated;
    delete element.dataset.ytInjectDone;
  };

  YTTranslate.injector = injector;
})();
