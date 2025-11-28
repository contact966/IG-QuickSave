// Content script V2 - bridges between the page and the extension
(function() {
  'use strict';

  console.log('[Instagram Downloader V2] Content script loaded');

  let isInjected = false;
  let isProfileScraperInjected = false;

  // Inject the page scripts (config first, then inject script)
  function injectScript() {
    if (isInjected) return;

    // First inject config.js
    const configScript = document.createElement('script');
    configScript.src = chrome.runtime.getURL('config.js');
    configScript.onload = function() {
      console.log('[Instagram Downloader] Config loaded');

      // Then inject the main script
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('scripts/inject-v7-final.js');
      script.onload = function() {
        this.remove();
        console.log('[Instagram Downloader] Inject script loaded successfully');
      };
      (document.head || document.documentElement).appendChild(script);
      configScript.remove();
    };
    (document.head || document.documentElement).appendChild(configScript);
    isInjected = true;
  }

  // Inject the profile scraper script
  function injectProfileScraper() {
    if (isProfileScraperInjected) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/profile-scraper.js');
    script.onload = function() {
      this.remove();
      console.log('[Instagram Downloader] Profile scraper loaded successfully');
    };
    (document.head || document.documentElement).appendChild(script);
    isProfileScraperInjected = true;
  }

  // Inject as soon as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectScript();
      injectProfileScraper();
    });
  } else {
    injectScript();
    injectProfileScraper();
  }

  // Listen for messages from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // Forward responses to background script
    if (event.data.type === 'POST_DATA_RESPONSE' ||
        event.data.type === 'COMMENTS_RESPONSE' ||
        event.data.type === 'MEDIA_RESPONSE' ||
        event.data.type === 'INJECT_READY' ||
        event.data.type === 'EXTRACTION_PROGRESS') {
      console.log('[Content] 📤 Forwarding', event.data.type, 'to background script');
      chrome.runtime.sendMessage(event.data);
    }

    // Profile scraper messages
    if (event.data.type === 'PROFILE_SCRAPE_PROGRESS') {
      console.log('[Content] 📤 Profile scrape progress:', event.data.count);
      chrome.runtime.sendMessage({
        type: 'profileScrapeProgress',
        data: {
          count: event.data.count,
          targetCount: event.data.targetCount
        }
      });
    }

    if (event.data.type === 'PROFILE_SCRAPE_COMPLETE') {
      console.log('[Content] 📤 Profile scrape complete:', event.data.count, 'posts');
      chrome.runtime.sendMessage({
        type: 'profileScrapeComplete',
        data: {
          posts: event.data.posts,
          postUrls: event.data.postUrls,
          count: event.data.count,
          username: event.data.username
        }
      });
    }

    if (event.data.type === 'PROFILE_STATUS_RESPONSE') {
      // Store for later retrieval
      window.__profileStatus = event.data;
    }

    if (event.data.type === 'PROFILE_SCRAPER_READY') {
      console.log('[Content] ✅ Profile scraper ready for:', event.data.username);
    }
  });

  // Helper function to fetch image/video and convert to base64
  async function urlToBase64(url, type = 'image') {
    if (!url) return '';

    try {
      // Media is publicly accessible, no credentials needed
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`[Content] Failed to fetch ${type}:`, url, response.status);
        return '';
      }

      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error(`[Content] Error converting ${type} to base64:`, error);
      return '';
    }
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractPostData') {
      console.log('[Content] 📩 Received extractPostData request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_POST_DATA' }, '*');
      return false; // No async response needed
    } else if (request.action === 'extractComments') {
      console.log('[Content] 📩 Received extractComments request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_COMMENTS' }, '*');
      return false; // No async response needed
    } else if (request.action === 'extractMedia') {
      console.log('[Content] 📩 Received extractMedia request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_MEDIA' }, '*');
      return false; // No async response needed
    } else if (request.action === 'getPageInfo') {
      // Return basic page information
      sendResponse({
        url: window.location.href,
        isPostPage: /\/(p|reel)\/[^\/]+/.test(window.location.href)
      });
      return false; // Sync response
    } else if (request.action === 'fetchAvatars') {
      // Fetch multiple avatar URLs and convert to base64
      const urls = request.urls || [];

      console.log('[Content] Received fetchAvatars request');
      console.log('[Content] URLs to fetch:', urls);
      console.log('[Content] Fetching', urls.length, 'avatars...');

      Promise.allSettled(urls.map((url, index) => {
        console.log(`[Content] Fetching avatar ${index + 1}/${urls.length}:`, url);
        return urlToBase64(url, 'avatar');
      }))
        .then(results => {
          const avatarCache = {};
          let successCount = 0;
          let failCount = 0;

          urls.forEach((url, index) => {
            const result = results[index];
            if (result.status === 'fulfilled' && result.value) {
              avatarCache[url] = result.value;
              successCount++;
              console.log(`[Content] ✓ Avatar ${index + 1} converted (${result.value.substring(0, 50)}...)`);
            } else {
              failCount++;
              console.warn(`[Content] ✗ Avatar ${index + 1} failed:`, url, result.reason || 'empty result');
            }
          });

          console.log(`[Content] Converted ${successCount}/${urls.length} avatars (${failCount} failed)`);
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, avatarCache, successCount, failCount });
        })
        .catch(error => {
          console.error('[Content] Error in avatar processing:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'fetchMedia') {
      // Fetch media (images and videos) and convert to base64
      const mediaItems = request.mediaItems || [];

      console.log('[Content] Received fetchMedia request');
      console.log('[Content] Media items to fetch:', mediaItems.length);

      Promise.allSettled(mediaItems.map(async (item, index) => {
        const url = item.video_url || item.image_url;
        const type = item.video_url ? 'video' : 'image';

        if (!url) {
          console.warn(`[Content] ✗ Media ${index + 1} has no URL`);
          return null;
        }

        console.log(`[Content] Fetching ${type} ${index + 1}/${mediaItems.length}:`, url.substring(0, 100) + '...');
        const base64 = await urlToBase64(url, type);

        if (base64) {
          const sizeKB = Math.round(base64.length / 1024);
          console.log(`[Content] ✓ ${type} ${index + 1} converted (${sizeKB} KB)`);
        } else {
          console.warn(`[Content] ✗ ${type} ${index + 1} failed`);
        }

        return base64;
      }))
        .then(results => {
          const mediaCache = {};
          let successCount = 0;
          let failCount = 0;

          mediaItems.forEach((item, index) => {
            const url = item.video_url || item.image_url;
            const result = results[index];

            if (url && result.status === 'fulfilled' && result.value) {
              mediaCache[url] = result.value;
              successCount++;
            } else {
              failCount++;
            }
          });

          const totalSizeKB = Object.values(mediaCache).reduce((sum, b64) => sum + b64.length, 0) / 1024;
          console.log(`[Content] Converted ${successCount}/${mediaItems.length} media items (${failCount} failed)`);
          console.log('[Content] Total size:', Math.round(totalSizeKB), 'KB');
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, mediaCache });
        })
        .catch(error => {
          console.error('[Content] Error fetching media:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'hideAvatar') {
      // Hide user's avatar in "Add a comment" section for screenshot
      console.log('[Content] Hiding avatar for screenshot...');

      // Create and inject style element
      const styleId = 'instagram-dl-hide-avatar';
      let styleElement = document.getElementById(styleId);

      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.textContent = `
          /* Hide profile picture in comment input area */
          img[src*="t51.2885-19"][alt=""][draggable="false"] {
            display: none !important;
          }
        `;
        document.head.appendChild(styleElement);
      }

      sendResponse({ success: true });
      return false; // Sync response
    } else if (request.action === 'restoreAvatar') {
      // Restore user's avatar after screenshot
      console.log('[Content] Restoring avatar...');

      const styleId = 'instagram-dl-hide-avatar';
      const styleElement = document.getElementById(styleId);

      if (styleElement) {
        styleElement.remove();
      }

      sendResponse({ success: true });
      return false; // Sync response
    } else if (request.action === 'startProfileScrape') {
      // Start profile scraping
      console.log('[Content] 📩 Starting profile scrape, count:', request.count);
      injectProfileScraper(); // Ensure it's injected
      window.postMessage({
        type: 'START_PROFILE_SCRAPE',
        count: request.count || 0
      }, '*');
      sendResponse({ success: true });
      return false;
    } else if (request.action === 'stopProfileScrape') {
      // Stop profile scraping
      console.log('[Content] 📩 Stopping profile scrape');
      window.postMessage({ type: 'STOP_PROFILE_SCRAPE' }, '*');
      sendResponse({ success: true });
      return false;
    } else if (request.action === 'getProfileStatus') {
      // Get profile status
      console.log('[Content] 📩 Getting profile status');

      // Check if we're on a profile page by URL
      const path = window.location.pathname;
      const excludedPaths = ['/p/', '/reel/', '/reels/', '/explore/', '/direct/', '/accounts/', '/stories/'];
      const isProfile = !excludedPaths.some(p => path.includes(p));

      // Try to get username from page or URL
      let username = null;
      const headerUsername = document.querySelector('header h2 span');
      if (headerUsername) {
        username = headerUsername.innerText.trim();
      } else {
        const urlMatch = path.match(/^\/([^\/]+)\/?$/);
        if (urlMatch && !['explore', 'direct', 'accounts', 'stories', 'reels'].includes(urlMatch[1])) {
          username = urlMatch[1];
        }
      }

      sendResponse({
        isProfilePage: isProfile && username,
        username: username
      });
      return false;
    }
  });

})();
