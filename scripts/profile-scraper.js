// profile-scraper.js - Intercepts Instagram's GraphQL requests to extract post URLs from profiles
(function() {
  'use strict';

  console.log('[IG Profile Scraper] 🚀 Profile scraper loaded');

  // State management
  let collectedPosts = [];
  let isCollecting = false;
  let targetPostCount = 0;
  let stopRequested = false;
  let currentUsername = null;
  let scrollAttempts = 0;
  let lastPostCount = 0;
  let noNewPostsCount = 0;

  // Get username from page
  function getUsername() {
    if (currentUsername) return currentUsername;

    // Try to get from header - multiple selectors for different Instagram layouts
    const headerSelectors = [
      'header h2 span',
      'header section h2',
      'header a[href*="/"] span',
      '[role="main"] header h2'
    ];

    for (const selector of headerSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText) {
        currentUsername = el.innerText.trim();
        if (currentUsername && currentUsername.length > 0) {
          return currentUsername;
        }
      }
    }

    // Try from URL - handle both /username/ and /username formats
    const urlMatch = window.location.pathname.match(/^\/([^\/\?]+)\/?$/);
    if (urlMatch && !['p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories'].includes(urlMatch[1])) {
      currentUsername = urlMatch[1];
      return currentUsername;
    }

    return null;
  }

  // Check if we're on a profile page
  function isProfilePage() {
    const path = window.location.pathname;
    const excludedPaths = ['/p/', '/reel/', '/reels/', '/explore/', '/direct/', '/accounts/', '/stories/'];
    if (excludedPaths.some(p => path.includes(p))) return false;

    // Check if it looks like a profile (has tablist or post grid)
    const tablist = document.querySelector('[role="tablist"]');
    const postGrid = document.querySelector('article a[href*="/p/"]');
    return tablist !== null || postGrid !== null;
  }

  // Parse post data from GraphQL response node
  function parsePostData(node) {
    const takenAt = node?.taken_at;
    const timestamp = takenAt ? takenAt * 1000 : null;
    const code = node?.code || '';

    return {
      code: code,
      postId: node?.pk || null,
      mediaType: node?.media_type || null,
      likesCount: node?.like_count || 0,
      commentsCount: node?.comment_count || 0,
      viewCount: node?.view_count || node?.play_count || 0,
      caption: node?.caption?.text || '',
      createDate: timestamp ? new Date(timestamp).toISOString() : '',
      userName: node?.user?.username || getUsername() || '',
      postUrl: code ? `https://www.instagram.com/p/${code}/` : ''
    };
  }

  // Parse posts from DOM (for initially loaded posts)
  function parsePostsFromDOM() {
    const posts = [];
    const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');

    console.log('[IG Profile Scraper] 🔍 Found', postLinks.length, 'post links in DOM');

    postLinks.forEach(link => {
      const href = link.getAttribute('href');
      const match = href.match(/\/(p|reel)\/([^\/]+)/);
      if (match) {
        const code = match[2];
        // Check if not already collected
        if (!posts.some(p => p.code === code) && !collectedPosts.some(p => p.code === code)) {
          posts.push({
            code: code,
            postId: null,
            mediaType: match[1] === 'reel' ? 2 : 1,
            likesCount: 0,
            commentsCount: 0,
            viewCount: 0,
            caption: '',
            createDate: '',
            userName: getUsername() || '',
            postUrl: `https://www.instagram.com${href.startsWith('/') ? '' : '/'}${href}`
          });
        }
      }
    });

    return posts;
  }

  // Add posts to collection
  function addPosts(posts) {
    if (!isCollecting) return;

    let addedCount = 0;
    for (const post of posts) {
      if (post.code && !collectedPosts.some(p => p.code === post.code)) {
        collectedPosts.push(post);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      console.log(`[IG Profile Scraper] ➕ Added ${addedCount} new posts. Total: ${collectedPosts.length}/${targetPostCount || '∞'}`);

      // Notify about progress
      window.postMessage({
        type: 'PROFILE_SCRAPE_PROGRESS',
        count: collectedPosts.length,
        targetCount: targetPostCount
      }, '*');
    }

    // Check if we've reached target
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      console.log('[IG Profile Scraper] ✅ Reached target post count');
      finishCollection();
    }
  }

  // Scroll to trigger more posts loading
  async function scrollToLoadMore() {
    if (!isCollecting || stopRequested) {
      if (stopRequested) finishCollection();
      return;
    }

    scrollAttempts++;
    console.log(`[IG Profile Scraper] 📜 Scroll attempt ${scrollAttempts}...`);

    // First, collect any posts visible in DOM
    const domPosts = parsePostsFromDOM();
    if (domPosts.length > 0) {
      addPosts(domPosts);
    }

    // Check if we've reached target
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      return;
    }

    // Check if we're making progress
    if (collectedPosts.length === lastPostCount) {
      noNewPostsCount++;
      console.log(`[IG Profile Scraper] ⚠️ No new posts found (attempt ${noNewPostsCount}/5)`);

      if (noNewPostsCount >= 5) {
        console.log('[IG Profile Scraper] 📭 No more posts available after multiple attempts');
        finishCollection();
        return;
      }
    } else {
      noNewPostsCount = 0;
      lastPostCount = collectedPosts.length;
    }

    // Scroll down to load more
    const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    if (postLinks.length > 0) {
      const lastPost = postLinks[postLinks.length - 1];
      lastPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollBy(0, window.innerHeight);
    }

    // Wait and then try again
    setTimeout(() => {
      if (isCollecting && !stopRequested) {
        scrollToLoadMore();
      }
    }, 1000);
  }

  // Start collection process
  function startCollection(count = 0) {
    console.log('[IG Profile Scraper] 🎬 Starting collection, target:', count || 'all');

    collectedPosts = [];
    isCollecting = true;
    targetPostCount = count;
    stopRequested = false;
    currentUsername = getUsername();
    scrollAttempts = 0;
    lastPostCount = 0;
    noNewPostsCount = 0;

    // Send started message
    window.postMessage({
      type: 'PROFILE_SCRAPE_PROGRESS',
      count: 0,
      targetCount: targetPostCount
    }, '*');

    // First, collect posts already visible in DOM
    const initialPosts = parsePostsFromDOM();
    console.log('[IG Profile Scraper] 📋 Found', initialPosts.length, 'initial posts in DOM');

    if (initialPosts.length > 0) {
      addPosts(initialPosts);
    }

    // Check if we already have enough
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      finishCollection();
      return;
    }

    // Start scrolling to load more
    setTimeout(() => scrollToLoadMore(), 500);
  }

  // Stop collection
  function stopCollection() {
    console.log('[IG Profile Scraper] 🛑 Stop requested');
    stopRequested = true;
    finishCollection();
  }

  // Finish collection and send results
  function finishCollection() {
    if (!isCollecting) return; // Prevent double finish

    isCollecting = false;
    stopRequested = false;

    console.log('[IG Profile Scraper] ✅ Collection finished with', collectedPosts.length, 'posts');

    // Trim to target if we overshot
    let finalPosts = collectedPosts;
    if (targetPostCount > 0 && collectedPosts.length > targetPostCount) {
      finalPosts = collectedPosts.slice(0, targetPostCount);
    }

    // Extract just the URLs for the batch download
    const postUrls = finalPosts.map(p => p.postUrl);

    window.postMessage({
      type: 'PROFILE_SCRAPE_COMPLETE',
      posts: finalPosts,
      postUrls: postUrls,
      count: finalPosts.length,
      username: currentUsername
    }, '*');
  }

  // XHR Interception - capture API responses for richer data
  (function() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      this._url = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      this.addEventListener('load', function() {
        if (!isCollecting) return;
        if (stopRequested) return;

        // Check if this is a GraphQL request with post data
        if (this._url && this._url.includes('/graphql/query') &&
            (this.responseType === '' || this.responseType === 'text')) {
          try {
            const data = JSON.parse(this.responseText);

            // Handle user timeline (posts) response
            if (data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection) {
              const connection = data.data.xdt_api__v1__feed__user_timeline_graphql_connection;
              const edges = connection.edges || [];

              console.log('[IG Profile Scraper] 📥 Intercepted API response:', edges.length, 'posts with full metadata');

              const posts = edges.map(edge => parsePostData(edge.node));

              // Update existing posts with richer data or add new ones
              posts.forEach(post => {
                const existing = collectedPosts.find(p => p.code === post.code);
                if (existing) {
                  // Update with richer API data
                  Object.assign(existing, post);
                } else {
                  collectedPosts.push(post);
                }
              });

              // Notify about progress
              window.postMessage({
                type: 'PROFILE_SCRAPE_PROGRESS',
                count: collectedPosts.length,
                targetCount: targetPostCount
              }, '*');
            }

            // Handle user clips (reels) response
            if (data?.data?.xdt_api__v1__clips__user__connection_v2) {
              const connection = data.data.xdt_api__v1__clips__user__connection_v2;
              const edges = connection.edges || [];

              console.log('[IG Profile Scraper] 📥 Intercepted reels response:', edges.length, 'reels');

              const posts = edges
                .filter(edge => edge.node?.media)
                .map(edge => parsePostData(edge.node.media));

              posts.forEach(post => {
                const existing = collectedPosts.find(p => p.code === post.code);
                if (existing) {
                  Object.assign(existing, post);
                } else {
                  collectedPosts.push(post);
                }
              });

              window.postMessage({
                type: 'PROFILE_SCRAPE_PROGRESS',
                count: collectedPosts.length,
                targetCount: targetPostCount
              }, '*');
            }

          } catch (e) {
            // Not JSON or parsing error, ignore
          }
        }
      });

      return originalSend.apply(this, arguments);
    };
  })();

  // Listen for commands from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'START_PROFILE_SCRAPE') {
      const count = event.data.count || 0;
      startCollection(count);
    }

    if (event.data.type === 'STOP_PROFILE_SCRAPE') {
      stopCollection();
    }

    if (event.data.type === 'GET_PROFILE_STATUS') {
      window.postMessage({
        type: 'PROFILE_STATUS_RESPONSE',
        isProfilePage: isProfilePage(),
        username: getUsername(),
        isCollecting: isCollecting,
        collectedCount: collectedPosts.length
      }, '*');
    }
  });

  // Notify that scraper is ready
  setTimeout(() => {
    const username = getUsername();
    const onProfile = isProfilePage();
    console.log('[IG Profile Scraper] Status check - isProfilePage:', onProfile, 'username:', username);

    if (onProfile) {
      console.log('[IG Profile Scraper] ✅ Ready on profile page:', username);
      window.postMessage({
        type: 'PROFILE_SCRAPER_READY',
        username: username
      }, '*');
    }
  }, 1000);

})();
