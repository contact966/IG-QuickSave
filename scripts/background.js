// Background service worker
// Import config (service workers use importScripts)
importScripts('../config.js');

let currentData = {
  postData: null,
  comments: null,
  media: null
};

// Track connected popup ports for progress messages
let activePopupPort = null;

// Batch processing state
let batchState = {
  isProcessing: false,
  queue: [],
  currentIndex: 0,
  successCount: 0,
  skippedCount: 0,
  failedUrls: [],
  tabId: null,
  port: null,
  skipDownloaded: true // Default to skipping already downloaded posts
};

// ===== Downloaded Posts Tracking =====

// Get the set of downloaded shortcodes from storage
async function getDownloadedShortcodes() {
  try {
    const result = await chrome.storage.local.get('downloadedShortcodes');
    return new Set(result.downloadedShortcodes || []);
  } catch (error) {
    console.error('[Background] Error getting downloaded shortcodes:', error);
    return new Set();
  }
}

// Save a shortcode as downloaded
async function markAsDownloaded(shortcode) {
  try {
    const downloaded = await getDownloadedShortcodes();
    downloaded.add(shortcode);
    // Convert Set to Array for storage (limit to last 10000 to prevent storage bloat)
    const downloadedArray = Array.from(downloaded).slice(-10000);
    await chrome.storage.local.set({ downloadedShortcodes: downloadedArray });
    console.log('[Background] Marked as downloaded:', shortcode, '(total:', downloadedArray.length, ')');
  } catch (error) {
    console.error('[Background] Error saving downloaded shortcode:', error);
  }
}

// Check if a shortcode has been downloaded
async function isAlreadyDownloaded(shortcode) {
  const downloaded = await getDownloadedShortcodes();
  return downloaded.has(shortcode);
}

// Extract shortcode from Instagram URL
function extractShortcode(url) {
  const match = url.match(/instagram\.com\/(?:[^\/]+\/)?(p|reel|reels)\/([^\/\?\#]+)/);
  return match ? match[2] : null;
}

// Get download history stats
async function getDownloadStats() {
  const downloaded = await getDownloadedShortcodes();
  return {
    totalDownloaded: downloaded.size
  };
}

// Clear download history
async function clearDownloadHistory() {
  try {
    await chrome.storage.local.set({ downloadedShortcodes: [] });
    console.log('[Background] Download history cleared');
    return true;
  } catch (error) {
    console.error('[Background] Error clearing download history:', error);
    return false;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);

  if (message.type === 'POST_DATA_RESPONSE') {
    currentData.postData = message.data;
  } else if (message.type === 'COMMENTS_RESPONSE') {
    currentData.comments = message.data;
  } else if (message.type === 'MEDIA_RESPONSE') {
    currentData.media = message.data;
  } else if (message.type === 'EXTRACTION_PROGRESS') {
    // Forward progress messages to the connected popup
    if (activePopupPort) {
      activePopupPort.postMessage({
        type: 'progress',
        message: message.message
      });
    }
  } else if (message.type === 'profileScrapeProgress') {
    // Forward profile scrape progress to popup
    console.log('[Background] Profile scrape progress received, activePopupPort:', !!activePopupPort);
    if (activePopupPort) {
      activePopupPort.postMessage({
        type: 'profileScrapeProgress',
        data: message.data
      });
    }
  } else if (message.type === 'profileScrapeComplete') {
    // Forward profile scrape complete to popup
    console.log('[Background] Profile scrape COMPLETE received, activePopupPort:', !!activePopupPort, 'posts:', message.data?.count);
    if (activePopupPort) {
      activePopupPort.postMessage({
        type: 'profileScrapeComplete',
        data: message.data
      });
      console.log('[Background] Forwarded profileScrapeComplete to popup');
    } else {
      console.warn('[Background] No activePopupPort to forward profileScrapeComplete!');
    }
  }

  return true;
});

// Offscreen document management
let creatingOffscreen = null;

async function setupOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // If already creating, wait for it
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  // Create the offscreen document
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Process and crop screenshot images using Canvas API'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

// Crop screenshot using offscreen document
async function cropScreenshot(dataUrl, cropLeftPercent = 15, cropBottomPercent = 10) {
  try {
    await setupOffscreenDocument();

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'CROP_SCREENSHOT',
        dataUrl: dataUrl,
        cropLeft: cropLeftPercent,
        cropBottom: cropBottomPercent
      }, (response) => {
        if (response && response.success) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || 'Failed to crop screenshot'));
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error cropping screenshot:', error);
    // Return original if cropping fails
    return dataUrl;
  }
}

// Helper function to download a file
async function downloadFile(url, filename, saveAs = false) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: saveAs  // If true, prompts user for location
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Helper function to build custom folder name: username_POSTTYPE_YYYYMMDD_shortcode
function buildFolderName(postInfo) {
  const username = postInfo.username || 'unknown';
  const postType = (postInfo.post_type || 'post').toUpperCase();
  const shortcode = postInfo.shortcode || 'post';

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

// Helper function to build base filename prefix: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode
function buildFilePrefix(postInfo) {
  return buildFolderName(postInfo);
}

// Helper function to download data as JSON
function downloadJSON(data, filename, saveAs = false) {
  const jsonString = JSON.stringify(data, null, 2);
  // Use data URL instead of blob URL (Manifest V3 service workers don't have URL.createObjectURL)
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

  return downloadFile(dataUrl, filename, saveAs);
}

// Helper function to convert comments to CSV
function commentsToCSV(commentsData) {
  // Extract post info and comments
  const postInfo = commentsData.post_info || {};
  const comments = commentsData.comments || [];

  // CSV Header with post metadata columns
  const rows = [
    [
      'Post Username',
      'Post URL',
      'Post Caption',
      'Post Like Count',
      'Post Comment Count',
      'Post Date',
      'Comment ID',
      'Comment Username',
      'Comment Text',
      'Comment Created At',
      'Comment Likes',
      'Is Reply'
    ]
  ];

  // Post metadata values (will be duplicated in each row)
  const postMetadata = [
    postInfo.username || 'Unknown',
    postInfo.post_url || '',
    (postInfo.caption || '').replace(/"/g, '""'), // Escape quotes
    postInfo.like_count || 0,
    postInfo.comment_count || 0,
    postInfo.posted_at || ''
  ];

  function addComment(comment, isReply = false) {
    rows.push([
      ...postMetadata,
      comment.id,
      comment.owner?.username || 'Unknown',
      (comment.text || '').replace(/"/g, '""'), // Escape quotes
      new Date(comment.created_at * 1000).toISOString(),
      comment.like_count,
      isReply ? 'Yes' : 'No'
    ]);

    // Add replies
    if (comment.replies && comment.replies.length > 0) {
      comment.replies.forEach(reply => addComment(reply, true));
    }
  }

  comments.forEach(comment => addComment(comment));

  return rows.map(row =>
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');
}

// Helper function to download CSV
function downloadCSV(csvContent, filename, saveAs = false) {
  // Use data URL instead of blob URL (Manifest V3 service workers don't have URL.createObjectURL)
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

  return downloadFile(dataUrl, filename, saveAs);
}

// Helper function to escape HTML
function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to get file extension from URL
function getFileExtension(url, isVideo = false) {
  if (isVideo) return 'mp4';

  // Try to extract extension from URL
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-z0-9]+)(?:\?|$)/i);
    if (match && match[1]) {
      const ext = match[1].toLowerCase();
      // Common image extensions
      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return ext;
      }
    }
  } catch (e) {
    // Fallback
  }

  // Default fallback
  return 'jpg';
}

// Helper function to fetch avatars via content script
async function fetchAvatarsViaContentScript(urls) {
  if (!urls || urls.length === 0) {
    console.log('[Background] No avatar URLs to fetch');
    return {};
  }

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error('[Background] No active tab found');
      return {};
    }

    console.log('[Background] Active tab:', tab.id, tab.url);
    console.log('[Background] Requesting', urls.length, 'avatars from content script...');
    console.log('[Background] URLs to fetch:', urls);

    // Send message to content script to fetch avatars
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'fetchAvatars',
        urls: urls
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error fetching avatars:', chrome.runtime.lastError.message);
          resolve({});
        } else if (response && response.success) {
          console.log('[Background] SUCCESS! Received', Object.keys(response.avatarCache).length, 'avatars');
          console.log('[Background] Avatar cache sample:', Object.keys(response.avatarCache).slice(0, 2));
          resolve(response.avatarCache);
        } else {
          console.error('[Background] Failed to fetch avatars. Response:', response);
          resolve({});
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error in fetchAvatarsViaContentScript:', error);
    return {};
  }
}

// Helper function to fetch media via content script
async function fetchMediaViaContentScript(mediaItems) {
  if (!mediaItems || mediaItems.length === 0) {
    console.log('[Background] No media items to fetch');
    return {};
  }

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error('[Background] No active tab found');
      return {};
    }

    console.log('[Background] Active tab:', tab.id, tab.url);
    console.log('[Background] Requesting', mediaItems.length, 'media items from content script...');

    // Send message to content script to fetch media
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'fetchMedia',
        mediaItems: mediaItems
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error fetching media:', chrome.runtime.lastError.message);
          resolve({});
        } else if (response && response.success) {
          console.log('[Background] SUCCESS! Received', Object.keys(response.mediaCache).length, 'media items');
          resolve(response.mediaCache);
        } else {
          console.error('[Background] Failed to fetch media. Response:', response);
          resolve({});
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error in fetchMediaViaContentScript:', error);
    return {};
  }
}

// Helper function to generate HTML archive
async function generatePostHTML(postData, mediaFilePrefix = null) {
  const media = postData.media?.media || [];
  const comments = postData.comments?.comments || [];
  const post_info = postData.media?.post_info || postData.comments?.post_info || {};

  // Extract post info
  const username = post_info.username || 'unknown';
  const fullName = post_info.full_name || username;
  const profilePicUrl = post_info.profile_pic_url || '';
  const caption = post_info.caption || '';
  const likeCount = post_info.like_count || 0;
  const commentCount = post_info.comment_count || 0;
  const postedAt = post_info.posted_at || '';
  const postUrl = post_info.post_url || '';

  // Collect all unique profile picture URLs
  const profilePicUrls = new Set();
  if (profilePicUrl) profilePicUrls.add(profilePicUrl);

  // Add comment author avatars
  function collectAvatars(commentList) {
    for (const comment of commentList) {
      if (comment.owner?.profile_pic_url) {
        profilePicUrls.add(comment.owner.profile_pic_url);
      }
      if (comment.replies && comment.replies.length > 0) {
        collectAvatars(comment.replies);
      }
    }
  }
  collectAvatars(comments);

  // Fetch all profile pictures via content script (keep avatars as base64 since they're small)
  console.log('[Background] About to fetch avatars, URLs:', Array.from(profilePicUrls));
  const avatarCache = await fetchAvatarsViaContentScript(Array.from(profilePicUrls));
  console.log('[Background] Avatar cache keys:', Object.keys(avatarCache));
  console.log('[Background] Avatar cache has', Object.keys(avatarCache).length, 'entries');

  // Helper to get base64 avatar
  const getAvatar = (url) => {
    const avatar = avatarCache[url] || '';
    if (!avatar) {
      console.warn('[Background] No avatar found for URL:', url);
    }
    return avatar;
  };

  // Helper to get media path (use relative paths instead of base64)
  const getMedia = (item, index) => {
    if (mediaFilePrefix) {
      // Use relative file path with correct extension
      const url = item.video_url || item.image_url;
      const extension = getFileExtension(url, !!item.video_url);
      return `./media/${mediaFilePrefix}_media_${index + 1}.${extension}`;
    } else {
      // Fallback to original URL
      return item.video_url || item.image_url;
    }
  };

  // Format date
  let formattedDate = 'Unknown date';
  if (postedAt) {
    const date = new Date(postedAt);
    formattedDate = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Generate media HTML
  let mediaHTML = '';
  if (media.length > 0) {
    if (media.length === 1) {
      const item = media[0];
      if (item.video_url) {
        const videoSrc = getMedia(item, 0);
        mediaHTML = `<video controls class="post-media"><source src="${videoSrc}" type="video/mp4"></video>`;
      } else if (item.image_url) {
        const imageSrc = getMedia(item, 0);
        mediaHTML = `<img src="${imageSrc}" alt="Post media" class="post-media">`;
      }
    } else {
      const carouselItems = media.map((item, index) => {
        const content = item.video_url
          ? `<video controls class="post-media"><source src="${getMedia(item, index)}" type="video/mp4"></video>`
          : `<img src="${getMedia(item, index)}" alt="Post media ${index + 1}" class="post-media">`;
        return `<div class="carousel-item ${index === 0 ? 'active' : ''}">${content}</div>`;
      }).join('');

      const dots = media.map((_, index) =>
        `<span class="dot ${index === 0 ? 'active' : ''}" onclick="currentSlide(${index + 1})"></span>`
      ).join('');

      mediaHTML = `
        <div class="carousel">
          <div class="carousel-container">${carouselItems}</div>
          <button class="carousel-btn prev" onclick="moveCarousel(-1)">❮</button>
          <button class="carousel-btn next" onclick="moveCarousel(1)">❯</button>
          <div class="carousel-dots">${dots}</div>
        </div>`;
    }
  }

  // Generate comments HTML
  function renderComment(comment, isReply = false) {
    const commentDate = new Date(comment.created_at * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const commentUsername = escapeHTML(comment.owner?.username || 'Unknown');
    const commentAvatarUrl = comment.owner?.profile_pic_url || '';
    const commentAvatar = getAvatar(commentAvatarUrl);

    const replies = comment.replies && comment.replies.length > 0
      ? `<div class="replies">${comment.replies.map(r => renderComment(r, true)).join('')}</div>`
      : '';

    return `
      <div class="comment ${isReply ? 'reply' : ''}">
        <div class="comment-content">
          ${commentAvatar ? `<img src="${commentAvatar}" alt="${commentUsername}" class="comment-avatar">` : '<div class="comment-avatar-placeholder"></div>'}
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-username">${commentUsername}</span>
              <span class="comment-date">${commentDate}</span>
            </div>
            <div class="comment-text">${escapeHTML(comment.text || '')}</div>
            <div class="comment-footer">
              <span class="comment-likes">${comment.like_count || 0} likes</span>
            </div>
          </div>
        </div>
        ${replies}
      </div>`;
  }

  const commentsHTML = comments.length > 0
    ? comments.map(c => renderComment(c)).join('')
    : '<p class="no-comments">No comments</p>';

  const archiveDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(username)} - Instagram Post Archive</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#fafafa;color:#262626;padding:20px;display:flex;justify-content:center;align-items:flex-start}.container{max-width:470px;width:100%;margin:0 auto;background:white;border:1px solid #dbdbdb;border-radius:8px;overflow:hidden}.post-header{padding:16px;border-bottom:1px solid #efefef;display:flex;align-items:center;justify-content:space-between}.user-info{display:flex;align-items:center;gap:12px}.profile-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.profile-avatar-placeholder{width:40px;height:40px;border-radius:50%;background:#dbdbdb}.username{font-weight:600;font-size:14px}.full-name{color:#8e8e8e;font-size:12px}.post-date{color:#8e8e8e;font-size:12px}.media-container{background:#000;position:relative;display:flex;align-items:center;justify-content:center;min-height:600px;overflow:hidden;width:100%}img.post-media{max-width:100%;max-height:80vh;width:auto;height:auto;object-fit:contain}video.post-media{height:80vh;width:100%;max-width:100%;display:block;object-fit:cover}.carousel{position:relative;min-height:600px;width:100%}.carousel-container{position:relative;min-height:600px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;width:100%}.carousel-item{display:none;width:100%;height:100%;align-items:center;justify-content:center}.carousel-item.active{display:flex}.carousel-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:white;border:none;padding:10px 15px;cursor:pointer;font-size:18px;border-radius:4px;z-index:10}.carousel-btn:hover{background:rgba(0,0,0,0.8)}.carousel-btn.prev{left:10px}.carousel-btn.next{right:10px}.carousel-dots{text-align:center;padding:10px;background:#000}.dot{height:8px;width:8px;margin:0 4px;background-color:#bbb;border-radius:50%;display:inline-block;cursor:pointer}.dot.active{background-color:#0095f6}.post-stats{padding:16px;border-bottom:1px solid #efefef}.stats-row{display:flex;gap:16px;margin-bottom:8px}.stat{font-weight:600;font-size:14px}.caption{padding:16px;border-bottom:1px solid #efefef}.caption-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.caption-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.caption-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb}.caption-username{font-weight:600}.caption-text{white-space:pre-wrap;word-wrap:break-word;display:block}.comments-section{max-height:500px;overflow-y:auto;padding:16px}.comments-header{font-weight:600;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #efefef}.comment{margin-bottom:16px}.comment.reply{margin-left:32px;padding-left:16px;border-left:2px solid #efefef}.comment-content{display:flex;gap:12px;align-items:flex-start}.comment-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb;flex-shrink:0}.comment-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb;flex-shrink:0}.comment-body{flex:1}.comment-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.comment-username{font-weight:600;font-size:14px}.comment-date{color:#8e8e8e;font-size:12px}.comment-text{font-size:14px;margin-bottom:4px;white-space:pre-wrap;word-wrap:break-word}.comment-footer{display:flex;gap:12px;color:#8e8e8e;font-size:12px}.comment-likes{font-weight:600}.replies{margin-top:12px}.no-comments{text-align:center;color:#8e8e8e;padding:40px}.footer{padding:16px;background:#fafafa;border-top:1px solid #efefef;text-align:center;font-size:12px;color:#8e8e8e}.footer a{color:#0095f6;text-decoration:none}.footer a:hover{text-decoration:underline}</style>
</head>
<body>
<div class="container">
<div class="post-header">
<div class="user-info">
${getAvatar(profilePicUrl) ? `<img src="${getAvatar(profilePicUrl)}" alt="${escapeHTML(username)}" class="profile-avatar">` : '<div class="profile-avatar-placeholder"></div>'}
<div>
<div class="username">${escapeHTML(username)}</div>
${fullName !== username ? `<div class="full-name">${escapeHTML(fullName)}</div>` : ''}
</div>
</div>
<div class="post-date">${formattedDate}</div>
</div>
<div class="media-container">${mediaHTML}</div>
<div class="post-stats">
<div class="stats-row">
<span class="stat">${likeCount.toLocaleString()} likes</span>
<span class="stat">${commentCount.toLocaleString()} comments</span>
</div>
</div>
${caption ? `<div class="caption"><div class="caption-header">${getAvatar(profilePicUrl) ? `<img src="${getAvatar(profilePicUrl)}" alt="${escapeHTML(username)}" class="caption-avatar">` : '<div class="caption-avatar-placeholder"></div>'}<span class="caption-username">${escapeHTML(username)}</span></div><span class="caption-text">${escapeHTML(caption)}</span></div>` : ''}
<div class="comments-section">
<div class="comments-header">Comments</div>
${commentsHTML}
</div>
<div class="footer">Archived from <a href="${postUrl}" target="_blank">Instagram</a> on ${archiveDate}</div>
</div>
<script>let currentSlideIndex=1;showSlide(currentSlideIndex);function moveCarousel(n){showSlide(currentSlideIndex+=n)}function currentSlide(n){showSlide(currentSlideIndex=n)}function showSlide(n){const slides=document.getElementsByClassName("carousel-item");const dots=document.getElementsByClassName("dot");if(slides.length===0)return;if(n>slides.length){currentSlideIndex=1}if(n<1){currentSlideIndex=slides.length}for(let i=0;i<slides.length;i++){slides[i].classList.remove('active')}for(let i=0;i<dots.length;i++){dots[i].classList.remove('active')}slides[currentSlideIndex-1].classList.add('active');if(dots.length>0){dots[currentSlideIndex-1].classList.add('active')}}</script>
</body>
</html>`;
}

// Helper function to download HTML
function downloadHTML(htmlContent, filename, saveAs = false) {
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  return downloadFile(dataUrl, filename, saveAs);
}

// Expose API for popup
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    // Store the active popup port for progress messages
    activePopupPort = port;
    console.log('[Background] Popup connected, progress messages enabled');

    // Clear the port reference when popup disconnects
    port.onDisconnect.addListener(() => {
      activePopupPort = null;
      console.log('[Background] Popup disconnected, progress messages disabled');
    });

    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.action === 'getCurrentData') {
          port.postMessage({
            type: 'currentData',
            data: currentData
          });
        } else if (msg.action === 'downloadMedia') {
          const { media, postInfo, saveAs } = msg.data;

          // Build custom folder name
          const folderName = buildFolderName(postInfo);
          const folderPrefix = `Instagram/${folderName}/media`;

          // Build base filename prefix
          const filePrefix = buildFilePrefix(postInfo);

          // Send progress message
          if (activePopupPort) {
            activePopupPort.postMessage({
              type: 'progress',
              message: `⬇️ Downloading ${media.length} media files...`
            });
          }

          for (let i = 0; i < media.length; i++) {
            const item = media[i];
            const url = item.video_url || item.image_url;
            const extension = getFileExtension(url, !!item.video_url);

            // Custom filename: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode_media_1.ext
            const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;

            // Send progress for each file
            if (activePopupPort) {
              activePopupPort.postMessage({
                type: 'progress',
                message: `⬇️ Downloading media ${i + 1}/${media.length}...`
              });
            }

            try {
              // Only prompt saveAs for the first file
              await downloadFile(url, filename, saveAs && i === 0);
            } catch (error) {
              console.error(`Failed to download media ${i + 1}:`, error);
              port.postMessage({
                type: 'error',
                message: `Failed to download media ${i + 1}: ${error.message}`
              });
            }
          }

          port.postMessage({
            type: 'success',
            message: `Downloaded ${media.length} media files`
          });
        } else if (msg.action === 'downloadComments') {
          const { comments, filename, saveAs } = msg.data;

          if (msg.data.format === 'json') {
            await downloadJSON(comments, filename, saveAs);
          } else if (msg.data.format === 'csv') {
            const csv = commentsToCSV(comments);
            await downloadCSV(csv, filename, saveAs);
          }

          port.postMessage({
            type: 'success',
            message: `Downloaded comments as ${msg.data.format.toUpperCase()}`
          });
        } else if (msg.action === 'downloadHTML') {
          // Download HTML archive
          const { filename, saveAs } = msg.data;

          // Build file prefix for relative media paths
          const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
          const mediaFilePrefix = buildFilePrefix(postInfo);

          const htmlContent = await generatePostHTML(currentData, mediaFilePrefix);
          await downloadHTML(htmlContent, filename, saveAs);

          port.postMessage({
            type: 'success',
            message: 'Downloaded HTML archive'
          });
        } else if (msg.action === 'captureScreenshot') {
          // Capture screenshot of the current tab
          const { filename, saveAs } = msg.data;

          chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
              try {
                const tabId = tabs[0].id;

                // Step 1: Hide avatar before screenshot
                console.log('[Background] Hiding avatar for screenshot...');
                await chrome.tabs.sendMessage(tabId, { action: 'hideAvatar' });

                // Step 2: Wait for CSS to apply
                await new Promise(resolve => setTimeout(resolve, 100));

                // Step 3: Capture screenshot
                console.log('[Background] Capturing screenshot...');
                const dataUrl = await chrome.tabs.captureVisibleTab(null, {
                  format: 'png',
                  quality: 100
                });

                // Step 4: Restore avatar immediately
                console.log('[Background] Restoring avatar...');
                chrome.tabs.sendMessage(tabId, { action: 'restoreAvatar' });

                // Step 5: Crop the screenshot (remove 15% from left, 10% from bottom)
                const croppedDataUrl = await cropScreenshot(dataUrl, 15, 10);

                // Step 6: Download
                await downloadFile(croppedDataUrl, filename, saveAs);

                port.postMessage({
                  type: 'success',
                  message: 'Screenshot captured successfully!'
                });
              } catch (error) {
                console.error('[Background] Screenshot error:', error);

                // Try to restore avatar even if screenshot failed
                try {
                  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                      chrome.tabs.sendMessage(tabs[0].id, { action: 'restoreAvatar' });
                    }
                  });
                } catch (e) {
                  console.error('[Background] Failed to restore avatar:', e);
                }

                port.postMessage({
                  type: 'error',
                  message: 'Failed to capture screenshot: ' + error.message
                });
              }
            }
          });
        } else if (msg.action === 'downloadAll') {
          const { saveAs } = msg.data;

          // Get post info from either media or comments data
          const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
          const folderName = buildFolderName(postInfo);
          const filePrefix = buildFilePrefix(postInfo);

          // Send initial progress
          if (activePopupPort) {
            activePopupPort.postMessage({
              type: 'progress',
              message: '📦 Starting complete download...'
            });
          }

          // Download media
          if (currentData.media && currentData.media.media) {
            const folderPrefix = `Instagram/${folderName}/media`;
            const mediaCount = currentData.media.media.length;

            if (activePopupPort) {
              activePopupPort.postMessage({
                type: 'progress',
                message: `⬇️ Downloading ${mediaCount} media files...`
              });
            }

            for (let i = 0; i < mediaCount; i++) {
              const item = currentData.media.media[i];
              const url = item.video_url || item.image_url;
              const extension = getFileExtension(url, !!item.video_url);
              const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;

              if (activePopupPort) {
                activePopupPort.postMessage({
                  type: 'progress',
                  message: `⬇️ Downloading media ${i + 1}/${mediaCount}...`
                });
              }

              // Only prompt saveAs for the first file
              await downloadFile(url, filename, saveAs && i === 0);
            }
          }

          // Download comments as JSON and CSV
          if (currentData.comments && currentData.comments.comments) {
            if (activePopupPort) {
              activePopupPort.postMessage({
                type: 'progress',
                message: '💾 Saving comments as JSON and CSV...'
              });
            }

            const jsonFilename = `Instagram/${folderName}/comments/${filePrefix}_comments.json`;
            await downloadJSON(currentData.comments, jsonFilename, false);

            // Pass full currentData.comments object (includes post_info and comments)
            const csv = commentsToCSV(currentData.comments);
            const csvFilename = `Instagram/${folderName}/comments/${filePrefix}_comments.csv`;
            await downloadCSV(csv, csvFilename, false);
          }

          // Download post metadata
          if (activePopupPort) {
            activePopupPort.postMessage({
              type: 'progress',
              message: '📝 Saving post metadata...'
            });
          }

          const metadata = {
            ...postInfo,
            downloaded_at: new Date().toISOString(),
            media_count: currentData.media?.media?.length || 0,
            comment_count: currentData.comments?.total || 0
          };
          const metadataFilename = `Instagram/${folderName}/${filePrefix}_metadata.json`;
          await downloadJSON(metadata, metadataFilename, false);

          // Download HTML archive
          if (activePopupPort) {
            activePopupPort.postMessage({
              type: 'progress',
              message: '🌐 Generating HTML archive...'
            });
          }

          const htmlContent = await generatePostHTML(currentData, filePrefix);
          const htmlFilename = `Instagram/${folderName}/${filePrefix}_archive.html`;
          await downloadHTML(htmlContent, htmlFilename, false);

          // Capture screenshot
          chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
              try {
                const tabId = tabs[0].id;

                if (activePopupPort) {
                  activePopupPort.postMessage({
                    type: 'progress',
                    message: '📸 Capturing screenshot...'
                  });
                }

                // Hide avatar before screenshot
                console.log('[Background] Hiding avatar for screenshot...');
                await chrome.tabs.sendMessage(tabId, { action: 'hideAvatar' });

                // Wait for CSS to apply
                await new Promise(resolve => setTimeout(resolve, 100));

                // Capture screenshot
                const dataUrl = await chrome.tabs.captureVisibleTab(null, {
                  format: 'png',
                  quality: 100
                });

                // Restore avatar immediately
                console.log('[Background] Restoring avatar...');
                chrome.tabs.sendMessage(tabId, { action: 'restoreAvatar' });

                // Crop the screenshot (remove 15% from left, 10% from bottom)
                const croppedDataUrl = await cropScreenshot(dataUrl, 15, 10);

                const screenshotFilename = `Instagram/${folderName}/${filePrefix}_screenshot.png`;
                await downloadFile(croppedDataUrl, screenshotFilename, false);

                // Mark as downloaded
                const shortcode = postInfo.shortcode;
                if (shortcode) {
                  await markAsDownloaded(shortcode);
                }

                port.postMessage({
                  type: 'success',
                  message: 'Downloaded all content successfully!'
                });
              } catch (error) {
                console.error('[Background] Screenshot error:', error);

                // Try to restore avatar even if screenshot failed
                try {
                  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                      chrome.tabs.sendMessage(tabs[0].id, { action: 'restoreAvatar' });
                    }
                  });
                } catch (e) {
                  console.error('[Background] Failed to restore avatar:', e);
                }

                // Still mark as downloaded even if screenshot failed
                const shortcode = postInfo.shortcode;
                if (shortcode) {
                  await markAsDownloaded(shortcode);
                }

                port.postMessage({
                  type: 'success',
                  message: 'Downloaded all content (screenshot failed)'
                });
              }
            } else {
              // Mark as downloaded
              const shortcode = postInfo.shortcode;
              if (shortcode) {
                await markAsDownloaded(shortcode);
              }

              port.postMessage({
                type: 'success',
                message: 'Downloaded all content successfully!'
              });
            }
          });
        } else if (msg.action === 'startBatch') {
          // Start batch processing
          const { urls, skipDownloaded } = msg.data;
          batchState.queue = urls;
          batchState.currentIndex = 0;
          batchState.successCount = 0;
          batchState.skippedCount = 0;
          batchState.failedUrls = [];
          batchState.isProcessing = true;
          batchState.port = port;
          batchState.skipDownloaded = skipDownloaded !== false; // Default to true

          // Get current tab
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          batchState.tabId = tab.id;

          console.log('[Background] Starting batch processing:', urls.length, 'URLs, skipDownloaded:', batchState.skipDownloaded);
          processNextBatchUrl();

        } else if (msg.action === 'getDownloadStats') {
          // Get download history statistics
          const stats = await getDownloadStats();
          port.postMessage({
            type: 'downloadStats',
            data: stats
          });

        } else if (msg.action === 'clearDownloadHistory') {
          // Clear download history
          const success = await clearDownloadHistory();
          port.postMessage({
            type: 'downloadHistoryCleared',
            data: { success }
          });

        } else if (msg.action === 'checkIfDownloaded') {
          // Check if specific URLs are already downloaded
          const { urls } = msg.data;
          const results = {};
          for (const url of urls) {
            const shortcode = extractShortcode(url);
            results[url] = shortcode ? await isAlreadyDownloaded(shortcode) : false;
          }
          port.postMessage({
            type: 'downloadedCheckResult',
            data: results
          });

        } else if (msg.action === 'stopBatch') {
          // Stop batch processing
          console.log('[Background] Stopping batch processing');
          batchState.isProcessing = false;
          port.postMessage({
            type: 'batchStopped',
            data: {
              successCount: batchState.successCount,
              failedUrls: batchState.failedUrls
            }
          });
        }
      } catch (error) {
        console.error('[Background] Error:', error);
        port.postMessage({
          type: 'error',
          message: error.message
        });
      }
    });

    // Store port reference for batch processing
    port.onDisconnect.addListener(() => {
      if (batchState.port === port) {
        batchState.port = null;
      }
    });
  }
});

// Batch processing functions
async function processNextBatchUrl() {
  if (!batchState.isProcessing) {
    console.log('[Background] Batch processing stopped');
    return;
  }

  if (batchState.currentIndex >= batchState.queue.length) {
    // Batch complete
    console.log('[Background] Batch processing complete');
    batchState.isProcessing = false;

    if (batchState.port) {
      batchState.port.postMessage({
        type: 'batchComplete',
        data: {
          successCount: batchState.successCount,
          skippedCount: batchState.skippedCount,
          failedUrls: batchState.failedUrls,
          total: batchState.queue.length
        }
      });
    }
    return;
  }

  const url = batchState.queue[batchState.currentIndex];
  const shortcode = extractShortcode(url);
  console.log('[Background] Processing URL', batchState.currentIndex + 1, '/', batchState.queue.length, ':', url, 'shortcode:', shortcode);

  // Check if already downloaded (if skip option is enabled)
  if (batchState.skipDownloaded && shortcode) {
    const alreadyDownloaded = await isAlreadyDownloaded(shortcode);
    if (alreadyDownloaded) {
      console.log('[Background] ⏭️ Skipping already downloaded:', shortcode);
      batchState.skippedCount++;
      batchState.currentIndex++;

      // Send progress update
      if (batchState.port) {
        batchState.port.postMessage({
          type: 'batchProgress',
          data: {
            current: batchState.currentIndex,
            total: batchState.queue.length,
            url: url,
            successCount: batchState.successCount,
            skippedCount: batchState.skippedCount,
            failedUrls: batchState.failedUrls,
            skipped: true
          }
        });
      }

      // Small delay before processing next
      setTimeout(() => processNextBatchUrl(), 100);
      return;
    }
  }

  // Send progress update to popup
  if (batchState.port) {
    batchState.port.postMessage({
      type: 'batchProgress',
      data: {
        current: batchState.currentIndex + 1,
        total: batchState.queue.length,
        url: url,
        successCount: batchState.successCount,
        skippedCount: batchState.skippedCount,
        failedUrls: batchState.failedUrls,
        skipped: false
      }
    });
  }

  try {
    // Navigate to the URL
    await chrome.tabs.update(batchState.tabId, { url: url });
    // Wait for page load and extraction - handled by tab update listener
  } catch (error) {
    console.error('[Background] Failed to navigate to URL:', url, error);
    batchState.failedUrls.push({ url, error: error.message });
    batchState.currentIndex++;

    // Add delay before next URL using CONFIG
    const delay = CONFIG.TIMING.BATCH_DELAY_MIN + Math.random() * (CONFIG.TIMING.BATCH_DELAY_MAX - CONFIG.TIMING.BATCH_DELAY_MIN);
    setTimeout(() => processNextBatchUrl(), delay);
  }
}

// Listen for tab updates to detect page loads during batch processing
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!batchState.isProcessing || tabId !== batchState.tabId) {
    return;
  }

  // Check if page is fully loaded
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('[Background] 🔄 Tab update detected:', tab.url);

    if (tab.url.includes('instagram.com/p/') || tab.url.includes('instagram.com/reel/')) {
      console.log('[Background] ✅ Valid Instagram post/reel detected, starting auto-extraction');

      // Reset current data
      currentData = {
        postData: null,
        comments: null,
        media: null
      };

      // Wait a bit for page to fully render
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        // Trigger extraction via content script
        console.log('[Background] 📤 Sending extraction requests to content script...');
        await chrome.tabs.sendMessage(tabId, { action: 'extractMedia' });
        await chrome.tabs.sendMessage(tabId, { action: 'extractComments' });

      // Wait for extractions to complete with exponential backoff polling
      console.log('[Background] Waiting for extraction to complete...');
      const maxWaitTime = CONFIG.TIMING.POLL_MAX_WAIT;
      let pollInterval = CONFIG.TIMING.POLL_INTERVAL_START; // Start at 500ms
      let waited = 0;

      while (waited < maxWaitTime) {
        // Check if both media and comments data are ready (comments can be empty array)
        const mediaReady = currentData.media && currentData.media.media;
        const commentsReady = currentData.comments && Array.isArray(currentData.comments.comments);

        if (mediaReady && commentsReady) {
          const commentCount = currentData.comments.comments.length;
          console.log('[Background] ✅ Extraction complete! Found', commentCount, 'comments in', waited/1000, 's');
          break;
        }

        if (mediaReady && !commentsReady) {
          console.log('[Background] Waiting for comments... (', waited/1000, 's elapsed, next check in', pollInterval, 'ms)');
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;

        // Exponential backoff: increase interval up to max
        pollInterval = Math.min(
          pollInterval * CONFIG.TIMING.POLL_BACKOFF_MULTIPLIER,
          CONFIG.TIMING.POLL_INTERVAL_MAX
        );
      }

      if (waited >= maxWaitTime) {
        console.warn('[Background] ⚠️ Timeout waiting for extraction. Proceeding with available data...');
      }

      // Trigger download all
      if (currentData.media || currentData.comments) {
        const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
        const folderName = buildFolderName(postInfo);
        const filePrefix = buildFilePrefix(postInfo);

        // Download media
        if (currentData.media && currentData.media.media) {
          const folderPrefix = `Instagram/${folderName}/media`;
          for (let i = 0; i < currentData.media.media.length; i++) {
            const item = currentData.media.media[i];
            const url = item.video_url || item.image_url;
            const extension = getFileExtension(url, !!item.video_url);
            const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;
            await downloadFile(url, filename, false);
          }
        }

        // Download comments as JSON and CSV
        if (currentData.comments && currentData.comments.comments) {
          const jsonFilename = `Instagram/${folderName}/comments/${filePrefix}_comments.json`;
          await downloadJSON(currentData.comments, jsonFilename, false);

          // Pass full currentData.comments object (includes post_info and comments)
          const csv = commentsToCSV(currentData.comments);
          const csvFilename = `Instagram/${folderName}/comments/${filePrefix}_comments.csv`;
          await downloadCSV(csv, csvFilename, false);
        }

        // Download metadata
        const metadata = {
          ...postInfo,
          downloaded_at: new Date().toISOString(),
          media_count: currentData.media?.media?.length || 0,
          comment_count: currentData.comments?.total || 0
        };
        const metadataFilename = `Instagram/${folderName}/${filePrefix}_metadata.json`;
        await downloadJSON(metadata, metadataFilename, false);

        // Download HTML archive (wait a bit to ensure content script is ready for avatar fetching)
        await new Promise(resolve => setTimeout(resolve, 1000));
        const htmlContent = await generatePostHTML(currentData, filePrefix);
        const htmlFilename = `Instagram/${folderName}/${filePrefix}_archive.html`;
        await downloadHTML(htmlContent, htmlFilename, false);

        // Capture screenshot
        try {
          // Hide avatar before screenshot
          console.log('[Background] Hiding avatar for batch screenshot...');
          await chrome.tabs.sendMessage(tab.id, { action: 'hideAvatar' });

          // Wait for CSS to apply
          await new Promise(resolve => setTimeout(resolve, 100));

          const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: 'png',
            quality: 100
          });

          // Restore avatar after capture
          console.log('[Background] Restoring avatar after batch screenshot...');
          chrome.tabs.sendMessage(tab.id, { action: 'restoreAvatar' });

          const croppedDataUrl = await cropScreenshot(dataUrl, 15, 10);
          const screenshotFilename = `Instagram/${folderName}/${filePrefix}_screenshot.png`;
          await downloadFile(croppedDataUrl, screenshotFilename, false);
        } catch (error) {
          console.error('[Background] Screenshot failed:', error);
          // Try to restore avatar even if screenshot failed
          try {
            chrome.tabs.sendMessage(tab.id, { action: 'restoreAvatar' });
          } catch (e) {
            console.error('[Background] Failed to restore avatar:', e);
          }
        }

        console.log('[Background] Successfully downloaded:', tab.url);
        batchState.successCount++;

        // Mark this post as downloaded
        const downloadedShortcode = extractShortcode(tab.url);
        if (downloadedShortcode) {
          await markAsDownloaded(downloadedShortcode);
        }
      } else {
        throw new Error('Failed to extract data');
      }
    } catch (error) {
      console.error('[Background] Failed to process URL:', tab.url, error);
      batchState.failedUrls.push({ url: tab.url, error: error.message });
    }

      // Move to next URL with delay using CONFIG
      batchState.currentIndex++;
      const delay = CONFIG.TIMING.BATCH_DELAY_MIN + Math.random() * (CONFIG.TIMING.BATCH_DELAY_MAX - CONFIG.TIMING.BATCH_DELAY_MIN);
      setTimeout(() => processNextBatchUrl(), delay);
    } else {
      console.log('[Background] ⚠️ Not an Instagram post/reel URL, skipping');
    }
  }
});

console.log('[Instagram Downloader V2] 🚀 Background script loaded - Optimized version');
