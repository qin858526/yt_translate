/**
 * Popup UI logic for YT Translate.
 * Manages settings toggles, API key, and cache clearing.
 */

document.addEventListener('DOMContentLoaded', function () {
  var toggleSubtitle = document.getElementById('toggle-subtitle');
  var toggleComments = document.getElementById('toggle-comments');
  var toggleTitleDesc = document.getElementById('toggle-title-desc');
  var toggleLiveChat = document.getElementById('toggle-liveChat');
  var apiKeyInput = document.getElementById('api-key');
  var toggleVisibilityBtn = document.getElementById('toggle-visibility');
  var saveBtn = document.getElementById('save-key');
  var clearCacheBtn = document.getElementById('clear-cache');
  var statusText = document.getElementById('status-text');

  // Load saved settings
  chrome.storage.local.get(['settings', 'apiKey'], function (result) {
    var settings = result.settings || {};
    toggleSubtitle.checked = settings.subtitle !== false;
    toggleComments.checked = settings.comments !== false;
    toggleTitleDesc.checked = settings.title !== false && settings.description !== false;
    toggleLiveChat.checked = settings.liveChat !== false;

    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
  });

  // Save settings and notify active tab
  function saveSettings() {
    var settings = {
      subtitle: toggleSubtitle.checked,
      comments: toggleComments.checked,
      title: toggleTitleDesc.checked,
      description: toggleTitleDesc.checked,
      liveChat: toggleLiveChat.checked
    };

    var data = { settings: settings };
    if (apiKeyInput.value.trim()) {
      data.apiKey = apiKeyInput.value.trim();
    }

    chrome.storage.local.set(data, function () {
      setStatus('saved', '已保存');

      // Notify active YouTube tab
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs[0];
        if (tab && tab.url && tab.url.indexOf('youtube.com') !== -1) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: settings
          });
        }
      });
    });
  }

  // Toggle switches: auto-save
  [toggleSubtitle, toggleComments, toggleTitleDesc, toggleLiveChat].forEach(function (el) {
    el.addEventListener('change', saveSettings);
  });

  // Save button for API key
  saveBtn.addEventListener('click', function () {
    var apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ apiKey: apiKey }, function () {
        setStatus('saved', 'API Key 已保存');
      });
    }
  });

  // Toggle API key visibility
  toggleVisibilityBtn.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
    } else {
      apiKeyInput.type = 'password';
    }
  });

  // Clear cache
  clearCacheBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (tab && tab.url && tab.url.indexOf('youtube.com') !== -1) {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_CACHE' }, function () {
          setStatus('saved', '缓存已清除');
        });
      } else {
        setStatus('error', '请先打开 YouTube');
      }
    });
  });

  function setStatus(cls, text) {
    statusText.className = 'status ' + cls;
    statusText.textContent = text;
    setTimeout(function () {
      statusText.textContent = '就绪';
      statusText.className = 'status ready';
    }, 2000);
  }
});
