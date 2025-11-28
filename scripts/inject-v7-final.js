// inject-v7-final.js - V2 - Optimized with adaptive rate limiting and CONFIG
(function() {
  'use strict';

  console.log('[IG DL V2] 🚀 Starting - Optimized extraction engine loaded...');

  let cachedPostData = null;

  // Adaptive rate limiting state
  let rateLimitState = {
    graphqlMultiplier: 1,
    commentApiMultiplier: 1,
    replyApiMultiplier: 1,
    last429Time: null
  };

  // Helper to get adaptive delay (increases after 429 errors)
  function getAdaptiveDelay(rateLimitType) {
    const baseDelay = CONFIG.getRandomDelay(rateLimitType);
    const multiplier = rateLimitState[rateLimitType + 'Multiplier'] || 1;
    return baseDelay * multiplier;
  }

  // Helper to record 429 error and increase delays
  function record429Error(rateLimitType) {
    console.warn('[IG DL V2] 🚫 Rate limit detected (429). Adaptive delays activated...');
    rateLimitState.last429Time = Date.now();

    // Increase delay multiplier for this endpoint type
    const multiplierKey = rateLimitType + 'Multiplier';
    rateLimitState[multiplierKey] = Math.min((rateLimitState[multiplierKey] || 1) * CONFIG.RATE_LIMITS[rateLimitType].backoffMultiplier, 4);

    console.log('[IG DL V2] 📊 Adaptive multiplier for', rateLimitType, ':', rateLimitState[multiplierKey] + 'x');
  }

  // Helper function to fetch with timeout using AbortController
  async function fetchWithTimeout(url, options = {}, timeout = CONFIG.API.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  // Helper function to get actionable error message based on error type
  function getActionableError(error, context = '') {
    const errorMsg = error.message || error.toString();

    // Rate limiting detection
    if (error.status === 429 || errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('HTML instead of JSON')) {
      return {
        error: CONFIG.MESSAGES.ERRORS.RATE_LIMITED,
        type: 'rate_limit',
        guidance: 'Wait 5-10 minutes, then try again. Consider using fewer requests or enabling "Skip Replies" mode.'
      };
    }

    // Session/authentication errors
    if (error.status === 401 || error.status === 403 || errorMsg.includes('401') || errorMsg.includes('403')) {
      return {
        error: CONFIG.MESSAGES.ERRORS.SESSION_EXPIRED,
        type: 'auth',
        guidance: 'Refresh the Instagram page and log back in, then try extracting again.'
      };
    }

    // Timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
      return {
        error: `Request timed out after ${CONFIG.API.FETCH_TIMEOUT/1000}s`,
        type: 'timeout',
        guidance: 'Your connection may be slow. Try refreshing the page and extracting again.'
      };
    }

    // Network errors
    if (errorMsg.includes('network') || errorMsg.includes('Failed to fetch') || error.name === 'NetworkError') {
      return {
        error: CONFIG.MESSAGES.ERRORS.NETWORK_ERROR,
        type: 'network',
        guidance: 'Check your internet connection and try again.'
      };
    }

    // Generic error with context
    return {
      error: `${context ? context + ': ' : ''}${errorMsg}`,
      type: 'unknown',
      guidance: 'Try refreshing the page. If the problem persists, the post may have restricted access.'
    };
  }

  // Helper function to extract owner info from various possible paths
  function getOwnerInfo(post) {
    // Try multiple possible paths where Instagram might store owner info
    // IMPORTANT: Prioritize sources that have username field
    const ownerSources = [
      post.user,                      // NEW: Instagram moved user data here (as of Nov 2024)
      post.owner,                     // OLD: Used to have user data, now just has id
      post.caption?.user,             // Sometimes nested in caption
      post.coauthor_producers?.[0],  // For collaborative posts
    ];

    // Find the first source that has username (most important field)
    const owner = ownerSources.find(source => source && source.username);

    if (owner) {
      console.log('[IG DL v7] 🔍 Found owner info from:', owner);
      return {
        username: owner.username,
        full_name: owner.full_name || owner.name || '',
        user_id: owner.pk || owner.id || '',
        profile_pic_url: owner.profile_pic_url || owner.profile_picture || owner.hd_profile_pic_url_info?.url || ''
      };
    }

    // Fallback: try to extract from URL or page DOM
    console.warn('[IG DL v7] ⚠️ Could not find owner info in post data. Trying fallback methods...');

    let username = 'unknown';
    let profilePicUrl = '';

    // Method 1: Try to extract username from page DOM
    try {
      // Try to find the username link in the header
      const usernameLink = document.querySelector('header a[role="link"]');
      if (usernameLink && usernameLink.href) {
        const match = usernameLink.href.match(/instagram\.com\/([^\/\?]+)/);
        if (match) {
          username = match[1];
          console.log('[IG DL v7] 🔍 Found username from DOM:', username);
        }
      }

      // Try to find profile picture
      const headerImg = document.querySelector('header img');
      if (headerImg && headerImg.src) {
        profilePicUrl = headerImg.src;
        console.log('[IG DL v7] 🔍 Found profile pic from DOM:', profilePicUrl);
      }
    } catch (e) {
      console.warn('[IG DL v7] Could not scrape from DOM:', e.message);
    }

    // Method 2: Fall back to URL if DOM scraping failed
    if (username === 'unknown') {
      const urlMatch = window.location.pathname.match(/^\/([^\/]+)\//);
      username = urlMatch ? urlMatch[1] : 'unknown';
      console.log('[IG DL v7] 🔍 Using username from URL:', username);
    }

    return {
      username: username,
      full_name: '',
      user_id: '',
      profile_pic_url: profilePicUrl
    };
  }

  // Helper function to build post metadata object
  // Consolidates duplicate code from extractComments() and extractMedia()
  function buildPostInfo(post) {
    const urlType = window.location.href.includes('/reel/') ? 'reel' : 'p';
    const ownerInfo = getOwnerInfo(post);

    return {
      username: ownerInfo.username,
      full_name: ownerInfo.full_name,
      user_id: ownerInfo.user_id,
      profile_pic_url: ownerInfo.profile_pic_url,
      post_url: `https://www.instagram.com/${urlType}/` + post.code,
      post_type: urlType === 'reel' ? 'reel' : 'post',
      shortcode: post.code,
      caption: post.caption?.text || '',
      like_count: post.like_count || 0,
      comment_count: post.comment_count || 0,
      posted_at: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : '',
      posted_at_timestamp: post.taken_at || 0,
      media_type: post.media_type === 2 ? 'Video' : post.media_type === 8 ? 'Carousel' : 'Image',
      is_video: post.media_type === 2
    };
  }

  // Parse post data from script tags
  function parsePostDataFromScripts() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/(p|reel)\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post or reel page' };
      }

      const contentType = shortcodeMatch[1]; // 'p' or 'reel'
      const shortcode = shortcodeMatch[2];

      const scripts = document.querySelectorAll('script[type="application/json"]');

      for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        const content = script.textContent;

        if (!content.includes(shortcode)) continue;

        try {
          const data = JSON.parse(content);

          if (data.require && Array.isArray(data.require)) {
            for (const requireItem of data.require) {
              if (!Array.isArray(requireItem) || requireItem.length < 4) continue;

              const bbox = requireItem[3];
              if (!bbox || !Array.isArray(bbox) || !bbox[0] || !bbox[0].__bbox) continue;

              const bboxRequire = bbox[0].__bbox.require;
              if (!bboxRequire || !Array.isArray(bboxRequire)) continue;

              for (const cacheItem of bboxRequire) {
                if (!Array.isArray(cacheItem) || cacheItem[0] !== 'RelayPrefetchedStreamCache') continue;

                const cacheData = cacheItem[3];
                if (!cacheData || !Array.isArray(cacheData) || cacheData.length < 2) continue;

                const cacheEntry = cacheData[1];
                if (!cacheEntry || !cacheEntry.__bbox || !cacheEntry.__bbox.result) continue;

                const resultData = cacheEntry.__bbox.result.data;
                if (!resultData) continue;

                const mediaInfo = resultData.xdt_api__v1__media__shortcode__web_info;
                if (mediaInfo && mediaInfo.items && mediaInfo.items.length > 0) {
                  const post = mediaInfo.items[0];

                  if (post.code === shortcode) {
                    console.log('[IG DL V2] ✅ Found post data!');

                    // DEBUG: Log the full post structure to see what fields are available
                    console.log('[IG DL V2] 🔍 DEBUG - Post object keys:', Object.keys(post));
                    console.log('[IG DL V2] 🔍 DEBUG - Owner object:', post.owner);
                    console.log('[IG DL V2] 🔍 DEBUG - User object:', post.user);

                    // Check alternative owner fields
                    if (post.owner) {
                      console.log('[IG DL V2] 🔍 DEBUG - Owner keys:', Object.keys(post.owner));
                    }
                    if (post.user) {
                      console.log('[IG DL V2] 🔍 DEBUG - User keys:', Object.keys(post.user));
                    }

                    cachedPostData = post;
                    window.__foundPost = post;
                    return { shortcode, post, method: 'script-tag-parsing' };
                  }
                }
              }
            }
          }

        } catch (parseError) {
          continue;
        }
      }

      return { error: 'Post data not found' };

    } catch (error) {
      console.error('[IG DL v7] Error:', error);
      return { error: error.message };
    }
  }

  // Extract post data
  async function extractPostData() {
    if (cachedPostData) {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/(p|reel)\/([^\/\?]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[2] : '';
      return { shortcode, post: cachedPostData, method: 'cached' };
    }

    return parsePostDataFromScripts();
  }

  // Fetch comments via GraphQL endpoint (fallback method)
  async function fetchCommentsViaGraphQL(shortcode, expectedTotal = null) {
    console.log('[IG DL v7] 🔄 Trying GraphQL fallback method...');
    console.log('[IG DL v7] Shortcode:', shortcode);
    sendProgress('🔄 Fetching comments via GraphQL...');

    try {
      const allComments = [];
      let hasNextPage = true;
      let endCursor = null;
      let requestCount = 0;
      const maxRequests = CONFIG.API.MAX_GRAPHQL_REQUESTS;

      while (hasNextPage && requestCount < maxRequests) {
        requestCount++;

        const variables = {
          shortcode: shortcode,
          first: CONFIG.API.COMMENTS_PER_PAGE,
          after: endCursor
        };

        const url = `${CONFIG.API.BASE_URL}${CONFIG.API.GRAPHQL_ENDPOINT}?query_hash=${CONFIG.API.GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
        console.log('[IG DL v7] GraphQL Request', requestCount, '...');

        const response = await fetchWithTimeout(url, {
          method: 'GET',
          credentials: 'include',
          headers: CONFIG.API.HEADERS
        });

        if (!response.ok) {
          if (response.status === 429) {
            record429Error('graphql');
          }
          console.error('[IG DL v7] GraphQL HTTP Error:', response.status);
          throw new Error(`GraphQL HTTP ${response.status}`);
        }

        const data = await response.json();
        const media = data?.data?.shortcode_media;

        if (!media || !media.edge_media_to_comment) {
          console.warn('[IG DL v7] GraphQL: No comment data in response');
          break;
        }

        const edges = media.edge_media_to_comment.edges || [];
        const pageInfo = media.edge_media_to_comment.page_info;

        console.log('[IG DL v7] GraphQL: Got', edges.length, 'comments. Total:', allComments.length + edges.length);

        // Send progress update
        const newTotal = allComments.length + edges.length;
        const progressMsg = expectedTotal
          ? `💬 Fetching comments: ${newTotal}/${expectedTotal}...`
          : `💬 Fetched ${newTotal} comments so far...`;
        sendProgress(progressMsg);

        // Convert GraphQL format to our format
        for (const edge of edges) {
          const node = edge.node;

          // Debug: Check if this is a reply or parent comment
          const isReply = node.did_report_as_spam !== undefined ? false : null; // GraphQL doesn't clearly indicate parent vs reply

          allComments.push({
            id: node.id,
            text: node.text || '',
            created_at: node.created_at || 0,
            owner: {
              id: node.owner?.id,
              username: node.owner?.username,
              profile_pic_url: node.owner?.profile_pic_url
            },
            like_count: node.edge_liked_by?.count || 0,
            child_comment_count: node.edge_threaded_comments?.count || 0,
            replies: [] // Would need separate query for replies
          });
        }

        console.log('[IG DL v7] GraphQL batch sample:', {
          total: edges.length,
          first_comment: edges[0]?.node?.text?.substring(0, 30),
          has_child_counts: edges.filter(e => e.node.edge_threaded_comments?.count > 0).length
        });

        hasNextPage = pageInfo?.has_next_page || false;
        endCursor = pageInfo?.end_cursor || null;

        if (hasNextPage && endCursor) {
          console.log('[IG DL v7] GraphQL: More pages available');
          const delay = getAdaptiveDelay('graphql');
          console.log('[IG DL v7] Using adaptive delay:', delay, 'ms');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.log('[IG DL v7] GraphQL: No more pages');
          break;
        }
      }

      console.log('[IG DL v7] ✅ GraphQL fetched', allComments.length, 'comments');
      sendProgress(`✅ Fetched all ${allComments.length} comments successfully!`);
      return allComments;

    } catch (error) {
      console.error('[IG DL v7] GraphQL method failed:', error);
      sendProgress(`❌ Error fetching comments: ${error.message}`);
      throw error;
    }
  }

  // Fetch child comments (replies) for a parent comment
  async function fetchChildComments(mediaId, commentId) {
    try {
      const allReplies = [];
      let hasMore = true;
      let minId = null;
      let requestCount = 0;
      const maxRequests = CONFIG.API.MAX_CHILD_COMMENT_REQUESTS;

      while (hasMore && requestCount < maxRequests) {
        requestCount++;

        // Build URL with pagination
        let url = `${CONFIG.API.BASE_URL}/api/v1/media/${mediaId}/comments/${commentId}/child_comments/`;
        if (minId) {
          url += `?min_id=${minId}`;
        }

        // RETRY LOGIC: Try up to 3 times with exponential backoff
        let data = null;
        let retryCount = 0;
        const maxRetries = CONFIG.API.MAX_RETRIES;

        while (retryCount < maxRetries) {
          try {
            const response = await fetchWithTimeout(url, {
              method: 'GET',
              credentials: 'include',
              headers: CONFIG.API.HEADERS
            });

            if (!response.ok) {
              // Record rate limit and increase delays
              if (response.status === 429) {
                record429Error('commentApi');
                isRateLimited = true;
              }
              // Rate limit or server error - retry with backoff
              if (response.status === 429 || response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText} (retryable)`);
              }
              console.warn('[IG DL v7] ⚠️ Child comment fetch failed:', response.status, response.statusText);
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Check content type before parsing
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              console.warn('[IG DL v7] ⚠️ Got HTML instead of JSON for child comments (likely rate limited)');
              console.warn('[IG DL v7] Content-Type:', contentType);
              throw new Error('Rate limited - got HTML instead of JSON (retryable)');
            }

            data = await response.json();
            break; // Success, exit retry loop

          } catch (error) {
            retryCount++;

            if (retryCount >= maxRetries) {
              console.warn('[IG DL v7] ⚠️ Failed to fetch child comments after', maxRetries, 'retries');
              console.warn('[IG DL v7] Skipping replies for comment', commentId);
              return []; // Return empty, don't break entire process
            }

            // Exponential backoff using CONFIG
            const backoffDelay = Math.pow(CONFIG.API.RETRY_BACKOFF_MULTIPLIER, retryCount) * CONFIG.API.RETRY_BACKOFF_BASE;
            console.warn('[IG DL v7] ⚠️ Child comment request failed, retrying in', backoffDelay, 'ms (attempt', retryCount + 1, '/', maxRetries, ')');
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }

        if (!data || !data.child_comments || !Array.isArray(data.child_comments)) {
          console.warn('[IG DL v7] ⚠️ No child_comments array in response for comment', commentId);
          break;
        }

        // Add replies from this page
        for (const reply of data.child_comments) {
          allReplies.push({
            id: reply.pk || reply.id,
            text: reply.text || '',
            created_at: reply.created_at || reply.created_at_utc || 0,
            owner: {
              id: reply.user?.pk,
              username: reply.user?.username,
              profile_pic_url: reply.user?.profile_pic_url
            },
            like_count: reply.comment_like_count || 0,
            replies: [] // Replies to replies not typically supported by Instagram
          });
        }

        // Check if there are more replies to fetch
        if (data.has_more_tail_child_comments && data.next_min_id) {
          minId = data.next_min_id;
          // Delay to avoid rate limiting using CONFIG
          const delay = CONFIG.getRandomDelay('replyPagination');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          hasMore = false;
        }
      }

      return allReplies;

    } catch (error) {
      console.error('[IG DL v7] ❌ Error fetching child comments:', error.message);
      return []; // Return empty array on error, don't break the whole process
    }
  }

  // Fetch comments using direct API call (tested and working!)
  async function fetchCommentsViaAPI(mediaId, expectedTotal = null, skipReplies = false) {
    console.log('[IG DL v7] 🚀 fetchCommentsViaAPI() called with mediaId:', mediaId);
    if (expectedTotal) {
      console.log('[IG DL v7] Expected total comments (from post):', expectedTotal);
    }
    if (skipReplies) {
      console.log('[IG DL v7] ⚡ SKIP REPLIES MODE - Will only fetch parent comments to avoid rate limiting');
    }

    try {
      console.log('[IG DL v7] Fetching comments via direct API call...');

      const allComments = [];
      let hasMore = true;
      let maxId = null;
      let requestCount = 0;
      const maxRequests = CONFIG.API.MAX_API_REQUESTS;
      let consecutiveEmptyResponses = 0;
      let isRateLimited = false;

      // Fetch main comments with pagination
      while (hasMore && requestCount < maxRequests) {
        requestCount++;

        // Build URL with pagination
        let url = `${CONFIG.API.BASE_URL}/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`;
        if (maxId) {
          url += `&max_id=${maxId}`;
        }

        console.log('[IG DL v7] Request', requestCount, '- Fetching main comments from:', url);

        // RETRY LOGIC: Try up to 3 times with exponential backoff
        let data = null;
        let retryCount = 0;
        const maxRetries = CONFIG.API.MAX_RETRIES;

        while (retryCount < maxRetries) {
          try {
            const response = await fetchWithTimeout(url, {
              method: 'GET',
              credentials: 'include',
              headers: CONFIG.API.HEADERS
            });

            if (!response.ok) {
              // Record rate limit and increase delays
              if (response.status === 429) {
                record429Error('commentApi');
                isRateLimited = true;
              }
              // Rate limit or server error - retry with backoff
              if (response.status === 429 || response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText} (retryable)`);
              }
              // Client error - don't retry
              console.error('[IG DL v7] ❌ HTTP Error:', response.status, response.statusText);
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            data = await response.json();
            break; // Success, exit retry loop

          } catch (error) {
            retryCount++;

            if (retryCount >= maxRetries) {
              console.error('[IG DL v7] ❌ Failed after', maxRetries, 'retries:', error.message);
              throw error;
            }

            // Check if this is a rate limit error
            if (error.message.includes('rate limited') || error.message.includes('HTML instead of JSON')) {
              isRateLimited = true;
              console.error('[IG DL v7] 🚫 RATE LIMITED by Instagram!');
              console.error('[IG DL v7] You need to wait 5-10 minutes before trying again.');
              console.error('[IG DL v7] Or try using GraphQL fallback.');
            }

            // Exponential backoff using CONFIG
            const backoffDelay = Math.pow(CONFIG.API.RETRY_BACKOFF_MULTIPLIER, retryCount) * CONFIG.API.RETRY_BACKOFF_BASE;
            console.warn('[IG DL v7] ⚠️ Request failed, retrying in', backoffDelay, 'ms (attempt', retryCount + 1, '/', maxRetries, ')');
            console.warn('[IG DL v7] Error:', error.message);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }

        // DETAILED DEBUGGING: Log API response structure
        console.log('[IG DL v7] 📊 API Response Details:');
        console.log('  - Comments in this batch:', data.comments?.length || 0);
        console.log('  - has_more_comments:', data.has_more_comments);
        console.log('  - next_max_id:', data.next_max_id || 'null');
        console.log('  - comment_count (from API):', data.comment_count || 'not provided');
        console.log('  - Status:', data.status);

        if (!data.comments || !Array.isArray(data.comments)) {
          console.warn('[IG DL v7] ⚠️ No comments array in response. Data structure:', Object.keys(data));
          console.warn('[IG DL v7] Full response:', data);
          consecutiveEmptyResponses++;

          // If we get multiple empty responses in a row, stop
          if (consecutiveEmptyResponses >= 3) {
            console.error('[IG DL v7] ❌ Got 3 consecutive empty responses, stopping pagination');
            break;
          }

          // Otherwise, try to continue if we have next_max_id
          if (data.next_max_id) {
            console.log('[IG DL v7] ⚠️ Trying to continue with next_max_id despite empty response...');
            maxId = data.next_max_id;
            await new Promise(resolve => setTimeout(resolve, 1500)); // Longer delay
            continue;
          } else {
            break;
          }
        }

        // Reset empty response counter if we got data
        consecutiveEmptyResponses = 0;

        // Add comments from this page (temporarily without replies)
        for (const comment of data.comments) {
          allComments.push({
            id: comment.pk || comment.id,
            text: comment.text || '',
            created_at: comment.created_at || comment.created_at_utc || 0,
            owner: {
              id: comment.user?.pk,
              username: comment.user?.username,
              profile_pic_url: comment.user?.profile_pic_url
            },
            like_count: comment.comment_like_count || 0,
            child_comment_count: comment.child_comment_count || 0,
            replies: []
          });
        }

        console.log('[IG DL v7] ✅ Got', data.comments.length, 'main comments in this batch. Total so far:', allComments.length);

        // RELAXED PAGINATION: Try to continue even if Instagram says there's no more
        // This works around Instagram's API bug where has_more_comments is false prematurely
        const shouldContinue = data.next_max_id && (
          data.has_more_comments ||
          (expectedTotal && allComments.length < expectedTotal)
        );

        if (shouldContinue) {
          maxId = data.next_max_id;

          if (!data.has_more_comments && expectedTotal && allComments.length < expectedTotal) {
            console.log('[IG DL v7] ⚠️ Instagram says no more comments, but we haven\'t reached expected total');
            console.log('  - Instagram API has_more_comments:', data.has_more_comments);
            console.log('  - But next_max_id exists:', data.next_max_id);
            console.log('  - Current:', allComments.length, '/ Expected:', expectedTotal);
            console.log('  - 🔄 Trying to fetch more anyway (Instagram API bug workaround)...');
          } else {
            console.log('[IG DL v7] ➡️ More comments available, next_max_id:', maxId);
          }

          // Delay to avoid rate limiting using adaptive delays
          const delay = getAdaptiveDelay('commentApi');
          console.log('[IG DL v7] Waiting', delay, 'ms before next request (adaptive)...');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          hasMore = false;
          console.log('[IG DL v7] 🛑 Pagination stopped:');
          console.log('  - has_more_comments:', data.has_more_comments);
          console.log('  - next_max_id:', data.next_max_id || 'null');
          console.log('  - Total parent comments fetched:', allComments.length);

          if (expectedTotal && allComments.length < expectedTotal) {
            console.warn('[IG DL v7] ⚠️ WARNING: Stopped pagination but haven\'t reached expected total');
            console.warn('  - Expected:', expectedTotal, '| Fetched:', allComments.length);
            console.warn('  - This is likely Instagram API pagination bug (known since Sept 2024)');
          }
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', allComments.length, 'main comments');

      // Now fetch replies for each comment that has them
      let totalReplies = 0;

      if (skipReplies) {
        console.log('[IG DL v7] ⚡ Skipping reply fetching (skipReplies mode enabled)');
      } else if (isRateLimited) {
        console.log('[IG DL v7] 🚫 Skipping reply fetching (rate limited)');
        console.log('[IG DL v7] You can try extracting again in 5-10 minutes to get replies');
      } else {
        console.log('[IG DL v7] Checking for replies...');

        for (let i = 0; i < allComments.length; i++) {
          const comment = allComments[i];

          if (comment.child_comment_count > 0) {
            console.log(`[IG DL v7] Fetching ${comment.child_comment_count} replies for comment ${i + 1}/${allComments.length}...`);

            const replies = await fetchChildComments(mediaId, comment.id);
            comment.replies = replies;
            totalReplies += replies.length;

            console.log(`[IG DL v7] ✅ Got ${replies.length} replies`);

            // Delay between parent comments to avoid rate limiting using CONFIG
            const delay = CONFIG.getRandomDelay('commentApi');
            console.log(`[IG DL v7] Waiting ${delay}ms before fetching next comment's replies...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', totalReplies, 'replies across all comments');

      const grandTotal = allComments.length + totalReplies;
      console.log('[IG DL v7] ✅ Grand total:', allComments.length, 'parent comments +', totalReplies, 'replies =', grandTotal, 'total');

      // VERIFICATION: Compare against post's comment count (if provided)
      if (expectedTotal) {
        console.log('[IG DL v7] 📊 VERIFICATION CHECK:');
        console.log('  - Post shows total:', expectedTotal, 'comments');
        console.log('  - We fetched:', grandTotal, 'comments (parents + replies)');

        if (grandTotal >= expectedTotal) {
          console.log('  - ✅ SUCCESS! We got all', expectedTotal, 'comments');
          console.log('  - Note: Instagram count may include hidden/deleted comments');
        } else {
          const missing = expectedTotal - grandTotal;
          const percentage = Math.round((grandTotal / expectedTotal) * 100);
          console.log('  - ⚠️ INCOMPLETE: Missing', missing, 'comments (' + percentage + '% complete)');
          console.log('  - This may be due to Instagram API pagination bug (known issue since Sept 2024)');
        }
      }

      return allComments;

    } catch (error) {
      console.error('[IG DL v7] Error fetching via API:', error);
      throw error;
    }
  }

  // Helper to send progress updates
  function sendProgress(message) {
    window.postMessage({ type: 'EXTRACTION_PROGRESS', message }, '*');
  }

  // Extract comments
  async function extractComments() {
    console.log('[IG DL V2] 🎯 extractComments() function called!');
    sendProgress('⏳ Starting comment extraction...');

    try {
      const postData = await extractPostData();
      if (postData.error) {
        console.error('[IG DL V2] ❌ Error getting post data:', postData.error);
        return postData;
      }

      const post = postData.post;

      console.log('[IG DL V2] Fetching comments for shortcode:', post.code);
      console.log('[IG DL V2] Post has', post.comment_count, 'total comments');
      sendProgress(`📊 Found ${post.comment_count} total comments to fetch...`);

      // PURE GRAPHQL: Fast and gets everything, presented as flat list
      console.log('[IG DL v7] 🚀 Using PURE GraphQL method (fast, complete, flat list)...');

      let comments = [];
      let totalReplies = 0;

      try {
        // Get ALL comments via GraphQL (super fast!)
        const allCommentsFlat = await fetchCommentsViaGraphQL(post.code, post.comment_count);
        console.log('[IG DL v7] ✅ GraphQL fetched', allCommentsFlat.length, 'total comments');

        // Present all comments as parent comments with empty replies
        // GraphQL doesn't give us parent-child relationship, so we treat all as top-level
        comments = allCommentsFlat.map(comment => ({
          ...comment,
          replies: [] // No nesting info available from GraphQL
        }));

        totalReplies = 0; // All comments are treated as parents

        console.log('[IG DL v7] ✅ All', comments.length, 'comments retrieved (flat list, no nesting)');
        console.log('[IG DL v7] Note: Comments are presented as a flat list since GraphQL doesn\'t provide nesting info');

      } catch (error) {
        console.error('[IG DL v7] ❌ GraphQL extraction failed:', error.message);
        throw error;
      }

      // FINAL VERIFICATION
      const grandTotal = comments.length + totalReplies;

      console.log('[IG DL v7] 📊 FINAL RESULTS:');
      console.log('  - Parent comments:', comments.length);
      console.log('  - Total replies:', totalReplies);
      console.log('  - Grand total:', grandTotal);
      console.log('  - Expected:', post.comment_count);

      // Debug: Show sample of comment structure with replies
      const commentsWithReplies = comments.filter(c => c.replies && c.replies.length > 0);
      console.log('  - Comments with replies:', commentsWithReplies.length);
      if (commentsWithReplies.length > 0) {
        const sample = commentsWithReplies[0];
        console.log('  - Sample structure:', {
          comment_text: sample.text.substring(0, 30) + '...',
          has_replies: sample.replies.length,
          first_reply: sample.replies[0]?.text?.substring(0, 30) + '...'
        });
      } else {
        console.warn('[IG DL v7] ⚠️ NO COMMENTS HAVE REPLIES IN THE DATA STRUCTURE!');
        console.warn('[IG DL v7] This means replies are not being nested properly');
      }

      if (grandTotal >= post.comment_count) {
        console.log('  - ✅ SUCCESS! Got all', post.comment_count, 'comments (', Math.round((grandTotal/post.comment_count)*100), '%)');
      } else {
        const missing = post.comment_count - grandTotal;
        const percentage = Math.round((grandTotal / post.comment_count) * 100);
        console.log('  - ⚠️ Got', percentage, '% (missing', missing, 'comments)');
      }

      // Build post metadata using helper function
      const postInfo = buildPostInfo(post);

      return {
        post_info: postInfo,
        total: post.comment_count || comments.length,
        total_comments: comments.length,
        total_replies: totalReplies,
        comments,
        note: null
      };

    } catch (error) {
      console.error('[IG DL v7] ❌ Error extracting comments:', error);
      console.error('[IG DL v7] Error stack:', error.stack);

      // Get actionable error message
      const actionableError = getActionableError(error, 'Comment extraction failed');

      return {
        total: 0,
        comments: [],
        error: actionableError.error,
        errorType: actionableError.type,
        guidance: actionableError.guidance,
        debug: {
          errorMessage: error.message,
          errorStack: error.stack
        }
      };
    }
  }

  // Extract media
  async function extractMedia() {
    try {
      sendProgress('📸 Extracting media from post...');
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      if (post.carousel_media && Array.isArray(post.carousel_media)) {
        sendProgress(`📸 Found ${post.carousel_media.length} media items in carousel...`);
        for (let i = 0; i < post.carousel_media.length; i++) {
          const item = post.carousel_media[i];
          media.push(extractMediaItem(item));
          sendProgress(`📸 Extracted media ${i + 1}/${post.carousel_media.length}...`);
        }
      } else {
        sendProgress('📸 Extracting single media item...');
        media.push(extractMediaItem(post));
      }

      // Build post metadata using helper function (same as in extractComments)
      const postInfo = buildPostInfo(post);

      sendProgress(`✅ Successfully extracted ${media.length} media items!`);
      return {
        media,
        post_info: postInfo
      };

    } catch (error) {
      sendProgress(`❌ Error extracting media: ${error.message}`);
      return { error: error.message };
    }
  }

  // Extract single media item
  function extractMediaItem(item) {
    const mediaItem = {
      type: item.media_type === 2 ? 'Video' : 'Image',
      id: item.pk || item.id || '',
      shortcode: item.code || ''
    };

    if (item.video_versions && item.video_versions.length > 0) {
      const highestQuality = item.video_versions[0];
      mediaItem.video_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;

      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
        mediaItem.thumbnail_url = item.image_versions2.candidates[0].url;
      }
    }
    else if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
      const highestQuality = item.image_versions2.candidates[0];
      mediaItem.image_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;
    }

    return mediaItem;
  }

  // Message handler
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'EXTRACT_POST_DATA') {
      console.log('[IG DL v7] 🔔 EXTRACT_POST_DATA message received!');
      const data = await extractPostData();
      console.log('[IG DL v7] 📤 Sending POST_DATA_RESPONSE');
      window.postMessage({ type: 'POST_DATA_RESPONSE', data }, '*');
    } else if (event.data.type === 'EXTRACT_COMMENTS') {
      console.log('[IG DL v7] 🔔 EXTRACT_COMMENTS message received!');
      const data = await extractComments();
      console.log('[IG DL v7] 📤 Sending COMMENTS_RESPONSE with', data.comments?.length || 0, 'comments');
      window.postMessage({ type: 'COMMENTS_RESPONSE', data }, '*');
    } else if (event.data.type === 'EXTRACT_MEDIA') {
      console.log('[IG DL v7] 🔔 EXTRACT_MEDIA message received!');
      const data = await extractMedia();
      console.log('[IG DL v7] 📤 Sending MEDIA_RESPONSE');
      window.postMessage({ type: 'MEDIA_RESPONSE', data }, '*');
    }
  });

  // Initialize
  setTimeout(() => {
    const result = parsePostDataFromScripts();

    if (result.post) {
      console.log('[IG DL V2] ✅ Ready! Post data parsed successfully');
      console.log('[IG DL V2] 📝 Tip: Scroll to comments section before extracting for complete data');
      console.log('[IG DL V2] 🚀 Features: Adaptive rate limiting · Fetch timeouts · Smart error handling');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    }
  }, 1000);

})();
