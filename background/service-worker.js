/**
 * Background Service Worker for YT Translate.
 * Proxies DeepSeek API calls from content scripts.
 * Uses ES module syntax (import.meta is available in MV3 SW).
 */

const API_KEY = 'sk-fb876a02ed31460a8afbc4493e03cfcb';
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

/**
 * Call DeepSeek API with retry logic.
 */
async function callDeepSeek(text, retries = 3) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
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
      // Don't retry on abort/timeout for last attempt
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
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

    // Return true to indicate async response
    callDeepSeek(text)
      .then(translated => sendResponse({ translated }))
      .catch(err => sendResponse({ error: err.message }));

    return true;
  }
});

console.log('YT Translate background service worker started');
