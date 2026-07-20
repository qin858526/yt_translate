/**
 * Background Service Worker for YT Translate.
 * Proxies DeepSeek API calls from content scripts.
 * Reads API key from chrome.storage.local (set by user in popup).
 */

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';

const SYSTEM_PROMPT = `You are a professional translator. Translate the following text into Simplified Chinese.

Rules:
- Keep translations concise, natural, and fluent
- Preserve the original meaning, tone, and style
- For batch input, lines are separated by "|||". Output translations separated by "|||"
- Match the line count exactly — do not merge or split lines
- Do NOT add explanations, notes, or extra formatting
- If a line is already in Chinese, keep it as-is
- For short UI text or titles, use natural Chinese equivalents`;

// Cache API key in memory to avoid repeated storage reads
let cachedApiKey = null;

/**
 * Get API key from chrome.storage.local, with memory caching.
 */
async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const result = await chrome.storage.local.get(['apiKey']);
  cachedApiKey = result.apiKey || null;
  return cachedApiKey;
}

// Clear cache when storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.apiKey) {
    cachedApiKey = changes.apiKey.newValue || null;
  }
});

/**
 * Call DeepSeek API with retry logic.
 */
async function callDeepSeek(text, retries = 3) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API Key not configured. Please set it in the extension popup.');
  }

  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text }
          ],
          temperature: 0.3,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 401) {
          throw new Error('Invalid API Key. Please check it in the extension popup.');
        }
        throw new Error(`DeepSeek API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const translated = data.choices?.[0]?.message?.content?.trim();

      if (!translated) {
        throw new Error('Empty translation result');
      }

      return translated;

    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error('DeepSeek API timeout after 15s');
      }
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('DeepSeek API call failed');
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE') {
    const text = request.text;
    if (!text || typeof text !== 'string') {
      sendResponse({ error: 'Invalid text input' });
      return false;
    }

    callDeepSeek(text)
      .then(translated => sendResponse({ translated }))
      .catch(err => sendResponse({ error: err.message }));

    return true;
  }

  // Allow popup to check if API key is configured
  if (request.type === 'CHECK_API_KEY') {
    getApiKey().then(key => sendResponse({ configured: !!key }));
    return true;
  }
});

console.log('YT Translate background service worker started');
