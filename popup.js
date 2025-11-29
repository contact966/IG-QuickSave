// Popup script
console.log('[Popup] ====== POPUP.JS LOADED ======');
let port = null;
let currentShortcode = null;
let extractedData = {
  media: null,
  comments: null
};

// Password protection (using CONFIG)
const passwordScreen = document.getElementById('passwordScreen');
const mainContent = document.getElementById('mainContent');
const passwordInput = document.getElementById('passwordInput');
const unlockBtn = document.getElementById('unlockBtn');
const passwordError = document.getElementById('passwordError');

// DOM elements
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('statusText');
const statsEl = document.getElementById('stats');
const mediaCountEl = document.getElementById('mediaCount');
const commentCountEl = document.getElementById('commentCount');
const extractBtn = document.getElementById('extractBtn');
const downloadOptionsEl = document.getElementById('downloadOptions');
const downloadMediaBtn = document.getElementById('downloadMediaBtn');
const downloadCommentsBtn = document.getElementById('downloadCommentsBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
const downloadScreenshotBtn = document.getElementById('downloadScreenshotBtn');
const askWhereToSaveCheckbox = document.getElementById('askWhereToSave');

// Initialize password hash on first run
async function initializePassword() {
  const result = await chrome.storage.local.get([CONFIG.SECURITY.PASSWORD_STORAGE_KEY]);

  // If no password hash exists, create one from default password 'MM66^^'
  if (!result[CONFIG.SECURITY.PASSWORD_STORAGE_KEY]) {
    const defaultHash = await CONFIG.hashPassword('MM777*+');
    await chrome.storage.local.set({ [CONFIG.SECURITY.PASSWORD_STORAGE_KEY]: defaultHash });
  }
}

// Check authentication on load
async function checkAuthentication() {
  await initializePassword();
  const result = await chrome.storage.local.get([CONFIG.SECURITY.AUTH_STORAGE_KEY]);

  if (result[CONFIG.SECURITY.AUTH_STORAGE_KEY]) {
    unlockExtension();
  }
}

// Verify password
async function verifyPassword() {
  const enteredPassword = passwordInput.value;

  // Get stored password hash
  const result = await chrome.storage.local.get([CONFIG.SECURITY.PASSWORD_STORAGE_KEY]);
  const storedHash = result[CONFIG.SECURITY.PASSWORD_STORAGE_KEY];

  // Verify password
  const isValid = await CONFIG.verifyPassword(enteredPassword, storedHash);

  if (isValid) {
    // Correct password - save authentication state
    await chrome.storage.local.set({ [CONFIG.SECURITY.AUTH_STORAGE_KEY]: true });
    unlockExtension();
  } else {
    // Wrong password
    passwordError.textContent = '❌ Incorrect password';
    passwordError.classList.remove('hidden');
    passwordInput.value = '';
    passwordInput.focus();

    // Shake animation
    passwordInput.style.animation = 'shake 0.4s';
    setTimeout(() => {
      passwordInput.style.animation = '';
    }, 400);
  }
}

// Unlock extension
function unlockExtension() {
  passwordScreen.classList.add('hidden');
  mainContent.classList.add('unlocked');
  init();
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
  }
`;
document.head.appendChild(style);

// Password screen event listeners
unlockBtn.addEventListener('click', verifyPassword);

passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    verifyPassword();
  }
});

passwordInput.addEventListener('input', () => {
  passwordError.classList.add('hidden');
});

// Check authentication on popup load
checkAuthentication();

// Initialize
async function init() {
  // Connect to background script
  port = chrome.runtime.connect({ name: 'popup' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'success') {
      showStatus('success', msg.message);
    } else if (msg.type === 'error') {
      showStatus('error', msg.message);
    } else if (msg.type === 'currentData') {
      handleExtractedData(msg.data);
    } else if (msg.type === 'progress') {
      // Real-time progress updates
      showStatus('info', msg.message);
    } else if (msg.type === 'batchProgress') {
      updateBatchProgress(msg.data);
    } else if (msg.type === 'batchComplete') {
      handleBatchComplete(msg.data);
    } else if (msg.type === 'batchStopped') {
      handleBatchStopped(msg.data);
    } else if (msg.type === 'profileScrapeProgress') {
      console.log('[Popup] Received profileScrapeProgress:', msg.data);
      handleProfileScrapeProgress(msg.data);
    } else if (msg.type === 'profileScrapeComplete') {
      console.log('[Popup] Received profileScrapeComplete:', msg.data);
      handleProfileScrapeComplete(msg.data);
    } else if (msg.type === 'downloadStats') {
      // Update download history count when it changes
      if (typeof msg.data.count === 'number') {
        downloadHistoryCount.textContent = msg.data.count;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Popup] Port disconnected!');
  });

  // Check if we're on a post or reel page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isPost = tab.url.includes('instagram.com/p/');
  const isReel = tab.url.includes('instagram.com/reel/');
  const isReels = tab.url.includes('instagram.com/reels/');

  if (!isPost && !isReel && !isReels) {
    showStatus('warning', '⚠️ Please open an Instagram post or reel to use this extension');
    extractBtn.disabled = true;
    return;
  }

  // Extract shortcode from URL (works for /p/, /reel/, and /reels/)
  const match = tab.url.match(/\/(p|reel|reels)\/([^\/]+)/);
  if (match) {
    currentShortcode = match[2];
    if (match[1] === 'reel' || match[1] === 'reels') {
      showStatus('info', '🔄 Reel detected - Click Extract to convert to post format');
    } else {
      showStatus('info', `✅ Ready to extract data from this post`);
    }
  }

  // Request any previously extracted data from background
  port.postMessage({ action: 'getCurrentData' });
}

// Show status message
function showStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusTextEl.textContent = message;
}

// Handle extracted data
function handleExtractedData(data) {
  extractedData = data;

  // Check for errors
  if (data.media && data.media.error) {
    showStatus('error', `Media Error: ${data.media.error}`);
    return;
  }

  if (data.comments && data.comments.error) {
    showStatus('error', `Comments Error: ${data.comments.error}`);
    return;
  }

  // Update UI with stats
  const mediaCount = data.media?.media?.length || 0;
  const commentCount = data.comments?.total || data.comments?.comments?.length || 0;

  mediaCountEl.textContent = mediaCount;
  commentCountEl.textContent = commentCount;

  if (mediaCount > 0 || commentCount > 0) {
    statsEl.classList.remove('hidden');
    downloadOptionsEl.classList.remove('hidden');
    showStatus('success', '✅ Data extracted successfully!');
  } else {
    showStatus('warning', '⚠️ No data found. Try refreshing the page.');
  }
}

// Set button loading state
function setButtonLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    const originalText = button.textContent;
    button.dataset.originalText = originalText;
    button.innerHTML = '<span class="loading"></span>' + originalText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

// Extract data from page
extractBtn.addEventListener('click', async () => {
  setButtonLoading(extractBtn, true);
  showStatus('info', '⏳ Extracting data from post...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check if we're on a /reel/ or /reels/ URL and redirect to /p/ for better compatibility
    const reelMatch = tab.url.match(/instagram\.com\/(reel|reels)\/([^\/\?]+)/);
    if (reelMatch) {
      const shortcode = reelMatch[2];
      const postUrl = `https://www.instagram.com/p/${shortcode}/`;
      showStatus('info', '🔄 Converting reel URL to post format...');

      // Redirect to /p/ URL
      await chrome.tabs.update(tab.id, { url: postUrl });

      // Wait for page to load and auto-extract
      showStatus('info', '⏳ Waiting for page to load and auto-extracting...');

      // Listen for tab update to complete
      const listener = (tabId, changeInfo, updatedTab) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // Wait a bit more for Instagram to render, then extract
          setTimeout(async () => {
            showStatus('info', '⏳ Extracting data...');
            chrome.tabs.sendMessage(tab.id, { action: 'extractMedia' });
            chrome.tabs.sendMessage(tab.id, { action: 'extractComments' });

            // Wait for data to be collected
            setTimeout(() => {
              port.postMessage({ action: 'getCurrentData' });
              setButtonLoading(extractBtn, false);
            }, 3000);
          }, 2000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
      return;
    }

    // Request data extraction from content script
    chrome.tabs.sendMessage(tab.id, { action: 'extractMedia' });
    chrome.tabs.sendMessage(tab.id, { action: 'extractComments' });

    // Wait for data to be collected (script tag parsing is fast)
    setTimeout(() => {
      port.postMessage({ action: 'getCurrentData' });
      setButtonLoading(extractBtn, false);
    }, 3000);

  } catch (error) {
    showStatus('error', `Error: ${error.message}`);
    setButtonLoading(extractBtn, false);
  }
});

// Download media only
downloadMediaBtn.addEventListener('click', async () => {
  if (!extractedData.media || !extractedData.media.media) {
    showStatus('error', 'No media to download');
    return;
  }

  setButtonLoading(downloadMediaBtn, true);
  showStatus('info', '⏳ Downloading media files...');

  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadMedia',
    data: {
      media: extractedData.media.media,
      postInfo: extractedData.media.post_info || {},
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadMediaBtn, false), 2000);
});

// Helper function to build custom folder name: username_POSTTYPE_YYYYMMDD_shortcode
function buildFolderName(postInfo) {
  const username = postInfo.username || 'unknown';
  const postType = (postInfo.post_type || 'post').toUpperCase();
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

  // Format date as YYYYMMDD (no dashes)
  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}${month}${day}`;
  }

  return `${username}_${postType}_${dateStr}_${shortcode}`;
}

// Helper function to build base filename prefix
function buildFilePrefix(postInfo) {
  return buildFolderName(postInfo);
}

// Build custom filename: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode_comments.ext
function buildCommentsFilename(postInfo, extension) {
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  return `Instagram/${folderName}/comments/${filePrefix}_comments.${extension}`;
}

// Download comments only (JSON)
downloadJsonBtn.addEventListener('click', async () => {
  if (!extractedData.comments || !extractedData.comments.comments) {
    showStatus('error', 'No comments to download');
    return;
  }

  setButtonLoading(downloadJsonBtn, true);
  showStatus('info', '⏳ Downloading comments as JSON...');

  const filename = buildCommentsFilename(extractedData.comments.post_info || {}, 'json');
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadComments',
    data: {
      comments: extractedData.comments,
      filename: filename,
      format: 'json',
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadJsonBtn, false), 1500);
});

// Download comments only (CSV)
downloadCsvBtn.addEventListener('click', async () => {
  if (!extractedData.comments || !extractedData.comments.comments) {
    showStatus('error', 'No comments to download');
    return;
  }

  setButtonLoading(downloadCsvBtn, true);
  showStatus('info', '⏳ Downloading comments as CSV...');

  const filename = buildCommentsFilename(extractedData.comments.post_info || {}, 'csv');
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadComments',
    data: {
      comments: extractedData.comments,
      filename: filename,
      format: 'csv',
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadCsvBtn, false), 1500);
});

// Download HTML archive
downloadHtmlBtn.addEventListener('click', async () => {
  if ((!extractedData.media || !extractedData.media.media) && (!extractedData.comments || !extractedData.comments.comments)) {
    showStatus('error', 'No data to download');
    return;
  }

  setButtonLoading(downloadHtmlBtn, true);
  showStatus('info', '⏳ Downloading media and profile pictures for offline HTML...');

  const postInfo = extractedData.comments?.post_info || extractedData.media?.post_info || {};
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  const filename = `Instagram/${folderName}/${filePrefix}_archive.html`;
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadHTML',
    data: {
      filename: filename,
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadHtmlBtn, false), 15000);
});

// Download comments button (shows format options)
downloadCommentsBtn.addEventListener('click', () => {
  const formatDiv = document.getElementById('commentFormat');
  formatDiv.style.display = formatDiv.style.display === 'none' ? 'flex' : 'none';
});

// Download screenshot
downloadScreenshotBtn.addEventListener('click', async () => {
  setButtonLoading(downloadScreenshotBtn, true);
  showStatus('info', '⏳ Capturing screenshot...');

  // Build screenshot filename
  const postInfo = extractedData.comments?.post_info || extractedData.media?.post_info || {};
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  const filename = `Instagram/${folderName}/${filePrefix}_screenshot.png`;
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'captureScreenshot',
    data: {
      filename: filename,
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadScreenshotBtn, false), 1500);
});

// Download everything
downloadAllBtn.addEventListener('click', async () => {
  setButtonLoading(downloadAllBtn, true);
  showStatus('info', '⏳ Downloading everything...');

  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadAll',
    data: {
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadAllBtn, false), 3000);
});

// Batch Download Controls
const toggleBatchBtn = document.getElementById('toggleBatchBtn');
const batchContent = document.getElementById('batchContent');
const batchUrls = document.getElementById('batchUrls');
const urlCount = document.getElementById('urlCount');
const startBatchBtn = document.getElementById('startBatchBtn');
console.log('[Popup] startBatchBtn element:', startBatchBtn);
console.log('[Popup] batchUrls element:', batchUrls);
const stopBatchBtn = document.getElementById('stopBatchBtn');
const batchProgress = document.getElementById('batchProgress');
const batchStatus = document.getElementById('batchStatus');
const batchProgressText = document.getElementById('batchProgressText');
const batchProgressBar = document.getElementById('batchProgressBar');
const batchCurrentUrl = document.getElementById('batchCurrentUrl');
const batchResults = document.getElementById('batchResults');
const successCount = document.getElementById('successCount');
const failedSection = document.getElementById('failedSection');
const failedCount = document.getElementById('failedCount');
const failedUrls = document.getElementById('failedUrls');

// Skip downloaded toggle elements
const skipDownloadedToggle = document.getElementById('skipDownloadedToggle');
const downloadHistoryCount = document.getElementById('downloadHistoryCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Toggle batch section
toggleBatchBtn.addEventListener('click', () => {
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
  } else {
    batchContent.classList.add('hidden');
    toggleBatchBtn.textContent = 'Show';
  }
});

// Load download history count on startup
async function loadDownloadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDownloadStats' });
    if (response && typeof response.count === 'number') {
      downloadHistoryCount.textContent = response.count;
    }
  } catch (error) {
    console.log('[Popup] Error loading download stats:', error);
  }
}

// Load stats when popup opens
loadDownloadStats();

// Clear history button
clearHistoryBtn.addEventListener('click', async () => {
  const confirmed = confirm('Clear all download history? This will allow previously downloaded posts to be downloaded again.');
  if (!confirmed) return;

  try {
    await chrome.runtime.sendMessage({ action: 'clearDownloadHistory' });
    downloadHistoryCount.textContent = '0';
    showStatus('success', '✅ Download history cleared');
  } catch (error) {
    console.log('[Popup] Error clearing history:', error);
    showStatus('error', '❌ Failed to clear history');
  }
});

// Update URL count
batchUrls.addEventListener('input', () => {
  const urls = parseUrls(batchUrls.value);
  urlCount.textContent = `${urls.length} URL${urls.length !== 1 ? 's' : ''}`;

  if (urls.length > 0) {
    urlCount.style.color = '#2e7d32';
  } else {
    urlCount.style.color = '#8e8e8e';
  }
});

// Parse and validate URLs
function parseUrls(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const validUrls = [];
  const seen = new Set();

  for (const line of lines) {
    // Match Instagram post URLs (including /reel/ and /reels/)
    // Supports both formats:
    //   - https://www.instagram.com/p/CODE/
    //   - https://www.instagram.com/username/p/CODE/
    const match = line.match(/instagram\.com\/(?:[^\/]+\/)?(p|reel|reels)\/([^\/\s\?]+)/);
    if (match) {
      const shortcode = match[2];
      // Always convert to /p/ format for reliability
      const normalizedUrl = `https://www.instagram.com/p/${shortcode}/`;

      // Remove duplicates
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        validUrls.push(normalizedUrl);
      }
    }
  }

  return validUrls;
}

// Start batch processing
console.log('[Popup] About to attach startBatchBtn click listener...');
if (startBatchBtn) {
  startBatchBtn.addEventListener('click', () => {
    console.log('[Popup] Start batch clicked');
    console.log('[Popup] Raw textarea value:', batchUrls.value);
    console.log('[Popup] Textarea value length:', batchUrls.value.length);

    const urls = parseUrls(batchUrls.value);
    console.log('[Popup] Parsed URLs:', urls);

    if (urls.length === 0) {
      showStatus('error', '❌ No valid Instagram URLs found');
      return;
    }

  // Confirm before starting
  const confirmed = confirm(`Start batch download for ${urls.length} post${urls.length !== 1 ? 's' : ''}?\n\nThis will take approximately ${Math.ceil(urls.length * 10 / 60)} minutes.`);

  if (!confirmed) {
    return;
  }

  // Reset UI
  batchProgress.classList.remove('hidden');
  batchResults.classList.add('hidden');
  failedSection.classList.add('hidden');
  successCount.textContent = '0';
  failedCount.textContent = '0';
  failedUrls.innerHTML = '';

  // Disable controls
  startBatchBtn.disabled = true;
  stopBatchBtn.disabled = false;
  batchUrls.disabled = true;

  // Start batch with skip option
  const skipDownloaded = skipDownloadedToggle?.checked ?? true;
  port.postMessage({
    action: 'startBatch',
    data: { urls, skipDownloaded }
  });

  showStatus('info', `🚀 Starting batch download of ${urls.length} posts...`);
  });
  console.log('[Popup] startBatchBtn click listener attached!');
} else {
  console.error('[Popup] startBatchBtn not found!');
}

// Stop batch processing
stopBatchBtn.addEventListener('click', () => {
  port.postMessage({
    action: 'stopBatch'
  });

  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  showStatus('warning', '⏹️ Batch processing stopped');
});

// Update batch progress
function updateBatchProgress(data) {
  const { current, total, url, successCount: success, failedUrls: failed, skippedCount: skipped } = data;

  batchProgressText.textContent = `${current}/${total}`;
  batchProgressBar.style.width = `${(current / total) * 100}%`;
  batchCurrentUrl.textContent = url;

  // Show skipped count if any posts were skipped
  if (skipped > 0) {
    batchStatus.textContent = `Processing post ${current} of ${total}... (${skipped} skipped)`;
  } else {
    batchStatus.textContent = `Processing post ${current} of ${total}...`;
  }

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');
  }

  batchResults.classList.remove('hidden');
}

// Handle batch complete
function handleBatchComplete(data) {
  const { successCount: success, failedUrls: failed, total, skippedCount: skipped } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');

    const skippedMsg = skipped > 0 ? `, ${skipped} skipped` : '';
    showStatus('warning', `✅ Batch complete! ${success}/${total} succeeded, ${failed.length} failed${skippedMsg}`);
  } else {
    const skippedMsg = skipped > 0 ? ` (${skipped} already downloaded)` : '';
    showStatus('success', `🎉 Batch complete! All ${success} posts downloaded successfully!${skippedMsg}`);
  }

  batchResults.classList.remove('hidden');

  // Refresh download history count
  loadDownloadStats();
}

// Handle batch stopped
function handleBatchStopped(data) {
  const { successCount: success, failedUrls: failed } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');
  }

  batchResults.classList.remove('hidden');
  showStatus('warning', `⏹️ Batch stopped. ${success} posts completed.`);
}

// Profile Scraper Controls
const toggleProfileBtn = document.getElementById('toggleProfileBtn');
const profileContent = document.getElementById('profileContent');
const profileNotOnProfile = document.getElementById('profileNotOnProfile');
const profileOnProfile = document.getElementById('profileOnProfile');
const profileUsername = document.getElementById('profileUsername');
const profilePostCount = document.getElementById('profilePostCount');
const startProfileScrapeBtn = document.getElementById('startProfileScrapeBtn');
const stopProfileScrapeBtn = document.getElementById('stopProfileScrapeBtn');
const profileScrapeProgress = document.getElementById('profileScrapeProgress');
const profileScrapeStatus = document.getElementById('profileScrapeStatus');
const profileScrapeCount = document.getElementById('profileScrapeCount');
const profileScrapeBar = document.getElementById('profileScrapeBar');
const profileScrapeComplete = document.getElementById('profileScrapeComplete');
const profileCollectedCount = document.getElementById('profileCollectedCount');
const profileCollectedUser = document.getElementById('profileCollectedUser');
const downloadProfilePostsBtn = document.getElementById('downloadProfilePostsBtn');

let collectedProfilePosts = [];

// Handle profile scrape progress (called from init via port.onMessage)
function handleProfileScrapeProgress(data) {
  const { count, targetCount } = data;
  profileScrapeCount.textContent = count;

  if (targetCount > 0) {
    const percentage = Math.min((count / targetCount) * 100, 100);
    profileScrapeBar.style.width = percentage + '%';
    profileScrapeStatus.textContent = `Collecting: ${count}/${targetCount} posts...`;
  } else {
    profileScrapeStatus.textContent = `Collecting: ${count} posts found...`;
    // Indeterminate progress for "all posts"
    profileScrapeBar.style.width = '50%';
  }
}

// Handle profile scrape complete (called from init via port.onMessage)
function handleProfileScrapeComplete(data) {
  const { posts, count, username } = data;

  // Update the global variable
  collectedProfilePosts = posts || [];

  console.log('[Popup] Profile scrape complete, stored', collectedProfilePosts.length, 'posts');

  // Update UI
  profileScrapeProgress.classList.add('hidden');
  profileScrapeComplete.classList.remove('hidden');
  profileCollectedCount.textContent = count;
  profileCollectedUser.textContent = username || 'user';

  // Re-enable buttons
  startProfileScrapeBtn.disabled = false;
  stopProfileScrapeBtn.disabled = true;
  profilePostCount.disabled = false;

  showStatus('success', `✅ Collected ${count} posts from @${username}`);
}

// Toggle profile section
toggleProfileBtn.addEventListener('click', () => {
  if (profileContent.classList.contains('hidden')) {
    profileContent.classList.remove('hidden');
    toggleProfileBtn.textContent = 'Hide';
    // Check profile status when section is opened
    checkProfileStatus();
  } else {
    profileContent.classList.add('hidden');
    toggleProfileBtn.textContent = 'Show';
  }
});

// Check if we're on a profile page
async function checkProfileStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check URL pattern for profile page
    const url = tab.url || '';
    const isProfilePage = url.includes('instagram.com/') &&
                         !url.includes('/p/') &&
                         !url.includes('/reel/') &&
                         !url.includes('/reels/') &&
                         !url.includes('/explore/') &&
                         !url.includes('/direct/') &&
                         !url.includes('/accounts/') &&
                         !url.includes('/stories/');

    // Try to get username from URL
    const match = url.match(/instagram\.com\/([^\/\?\#]+)/);
    const username = match ? match[1] : null;

    if (isProfilePage && username && !['explore', 'direct', 'accounts', 'stories', 'reels'].includes(username)) {
      profileNotOnProfile.classList.add('hidden');
      profileOnProfile.classList.remove('hidden');
      profileUsername.textContent = '@' + username;

      // Also ask the content script for confirmation
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileStatus' }, (response) => {
        if (response && response.username) {
          profileUsername.textContent = '@' + response.username;
        }
      });
    } else {
      profileNotOnProfile.classList.remove('hidden');
      profileOnProfile.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error checking profile status:', error);
    profileNotOnProfile.classList.remove('hidden');
    profileOnProfile.classList.add('hidden');
  }
}

// Start profile scraping
startProfileScrapeBtn.addEventListener('click', async () => {
  const count = parseInt(profilePostCount.value) || 0;

  // Reset UI
  collectedProfilePosts = [];
  profileScrapeProgress.classList.remove('hidden');
  profileScrapeComplete.classList.add('hidden');
  profileScrapeCount.textContent = '0';
  profileScrapeBar.style.width = '0%';
  profileScrapeStatus.textContent = 'Collecting posts...';

  // Disable/enable buttons
  startProfileScrapeBtn.disabled = true;
  stopProfileScrapeBtn.disabled = false;
  profilePostCount.disabled = true;

  // Send command to content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    action: 'startProfileScrape',
    count: count
  });

  showStatus('info', `🔍 Collecting posts from profile...`);
});

// Stop profile scraping
stopProfileScrapeBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'stopProfileScrape' });

  stopProfileScrapeBtn.disabled = true;
  profileScrapeStatus.textContent = 'Stopping...';
});

// Download all collected profile posts
downloadProfilePostsBtn.addEventListener('click', () => {
  console.log('[Popup] Download button clicked, collectedProfilePosts:', collectedProfilePosts.length);

  if (collectedProfilePosts.length === 0) {
    showStatus('error', 'No posts collected yet');
    return;
  }

  // Convert to URLs and start batch download
  const urls = collectedProfilePosts.map(p => {
    const url = p.postUrl || `https://www.instagram.com/p/${p.code}/`;
    console.log('[Popup] Post URL:', url);
    return url;
  });

  console.log('[Popup] Total URLs to add:', urls.length);

  // Fill in batch URLs textarea and trigger batch download
  batchUrls.value = urls.join('\n');
  urlCount.textContent = `${urls.length} URLs`;
  urlCount.style.color = '#2e7d32';

  // Show batch section if hidden
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
  }

  showStatus('success', `✅ Added ${urls.length} posts to batch download. Click "Start Batch" to begin.`);
});

// Open Archive Viewer button
const openViewerBtn = document.getElementById('openViewerBtn');
if (openViewerBtn) {
  openViewerBtn.addEventListener('click', () => {
    // Get the viewer URL from the extension
    const viewerUrl = chrome.runtime.getURL('viewer/instagram-viewer.html');
    chrome.tabs.create({ url: viewerUrl });
  });
}

// Note: init() is called from unlockExtension() after password verification
