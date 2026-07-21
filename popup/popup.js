/**
 * Popup UI logic for YT Translate.
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
  var refreshBtn = document.getElementById('refresh-translation');
  var statusText = document.getElementById('status-text');
  var apiNotice = document.getElementById('api-notice');

  // Check API key status
  function checkApiKey() {
    chrome.runtime.sendMessage({ type: 'CHECK_API_KEY' }, function (response) {
      if (response && response.configured) {
        apiNotice.className = 'api-notice configured';
        apiNotice.querySelector('.notice-text').textContent = 'API Key 已配置';
        apiNotice.querySelector('.notice-icon').textContent = '\u2713';
      } else {
        apiNotice.className = 'api-notice';
        apiNotice.querySelector('.notice-text').textContent = '请先配置 API Key 才能使用翻译功能';
        apiNotice.querySelector('.notice-icon').textContent = '!';
      }
    });
  }

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
    checkApiKey();
  });

  // Save API key
  function saveApiKey() {
    var apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      setStatus('error', '请输入 API Key');
      return;
    }
    if (!apiKey.startsWith('sk-')) {
      setStatus('error', 'Key 格式错误，应以 sk- 开头');
      return;
    }
    chrome.storage.local.set({ apiKey: apiKey }, function () {
      setStatus('saved', 'API Key 已保存');
      checkApiKey();

      // Notify active YouTube tab to reinitialize
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs[0];
        if (tab && tab.url && tab.url.indexOf('youtube.com') !== -1) {
          chrome.tabs.sendMessage(tab.id, { type: 'REINIT' }, function () {
            setStatus('saved', '已保存并重新加载翻译');
          });
        }
      });
    });
  }

  saveBtn.addEventListener('click', saveApiKey);
  apiKeyInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveApiKey();
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

    chrome.storage.local.set({ settings: settings }, function () {
      setStatus('saved', '已保存');
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

  [toggleSubtitle, toggleComments, toggleTitleDesc, toggleLiveChat].forEach(function (el) {
    el.addEventListener('change', saveSettings);
  });

  // Toggle API key visibility
  toggleVisibilityBtn.addEventListener('click', function () {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Refresh translation (force reinitialize + clear cache)
  refreshBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (tab && tab.url && tab.url.indexOf('youtube.com') !== -1) {
        // Clear cache first
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_CACHE' }, function () {
          // Then force reinit
          chrome.tabs.sendMessage(tab.id, { type: 'REINIT' }, function () {
            setStatus('saved', '翻译已刷新');
          });
        });
      } else {
        setStatus('error', '请先打开 YouTube');
      }
    });
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
