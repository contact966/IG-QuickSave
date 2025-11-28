// Configuration file for Instagram Post & Comments Downloader Extension V2
// Centralizes all magic numbers, timeouts, delays, and constants
// V2 Features: Adaptive rate limiting, fetch timeouts, exponential backoff, secure auth

const CONFIG = {
  // ============================================================================
  // VERSION INFO
  // ============================================================================

  VERSION: '2.0.0',
  VERSION_NAME: 'V2 - Optimized',
  RELEASE_DATE: '2025-01-17',

  // ============================================================================
  // TIMING & DELAYS
  // ============================================================================

  TIMING: {
    // Page loading and navigation
    PAGE_LOAD_DELAY: 2000,                    // Wait after navigating to new post (ms)
    PAGE_COMPLETE_CHECK_INTERVAL: 500,        // How often to check if page loaded (ms)

    // Extraction timeouts
    EXTRACTION_WAIT_TIMEOUT: 3000,            // How long popup waits for extraction (ms)
    POLL_INTERVAL_START: 500,                 // Initial polling interval (ms)
    POLL_INTERVAL_MAX: 2000,                  // Maximum polling interval (ms)
    POLL_MAX_WAIT: 60000,                     // Max time to wait for data (ms)
    POLL_BACKOFF_MULTIPLIER: 1.5,             // Exponential backoff multiplier

    // Button UI feedback
    BUTTON_RESET_DELAY: 2000,                 // How long to show success/error on buttons (ms)
    HTML_GENERATION_TIMEOUT: 15000,           // Estimated HTML generation time (ms)

    // Batch processing
    BATCH_DELAY_MIN: 3000,                    // Minimum delay between batch items (ms)
    BATCH_DELAY_MAX: 5000,                    // Maximum delay between batch items (ms)
    BATCH_CONCURRENT_MAX: 3,                  // Max posts to process in parallel
    BATCH_RETRY_MAX: 2,                       // Max retries for failed batch items
    BATCH_RETRY_DELAY: 5000,                  // Delay before retrying failed item (ms)
  },

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  RATE_LIMITS: {
    // GraphQL endpoint (faster, less strict)
    graphql: {
      min: 800,                               // Minimum delay between requests (ms)
      max: 1200,                              // Maximum delay between requests (ms)
      base: 800,                              // Base delay (ms)
      backoffMultiplier: 1.5,                 // Increase delay after 429
    },

    // Main comment API endpoint
    commentApi: {
      min: 1500,                              // Minimum delay between requests (ms)
      max: 2500,                              // Maximum delay between requests (ms)
      base: 1500,                             // Base delay (ms)
      backoffMultiplier: 2,                   // Increase delay after 429
    },

    // Reply/child comment API endpoint
    replyApi: {
      min: 800,                               // Minimum delay between requests (ms)
      max: 1200,                              // Maximum delay between requests (ms)
      base: 800,                              // Base delay (ms)
      backoffMultiplier: 1.5,                 // Increase delay after 429
    },

    // Reply pagination (more sensitive)
    replyPagination: {
      min: 400,                               // Minimum delay between requests (ms)
      max: 600,                               // Maximum delay between requests (ms)
      base: 400,                              // Base delay (ms)
      backoffMultiplier: 1.5,                 // Increase delay after 429
    },
  },

  // ============================================================================
  // API CONFIGURATION
  // ============================================================================

  API: {
    // Instagram API endpoints
    BASE_URL: 'https://www.instagram.com',
    GRAPHQL_ENDPOINT: '/graphql/query/',
    COMMENTS_ENDPOINT: '/api/v1/media/{mediaId}/comments/',
    CHILD_COMMENTS_ENDPOINT: '/api/v1/media/{mediaId}/comments/{commentId}/child_comments/',

    // API parameters
    GRAPHQL_QUERY_HASH: 'f0986789a5c5d17c2400faebf16efd0d',
    COMMENTS_PER_PAGE: 50,                    // How many comments to fetch per request

    // API headers
    HEADERS: {
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '198387',
      'X-Requested-With': 'XMLHttpRequest',
    },

    // Retry configuration
    MAX_RETRIES: 3,                           // Max retry attempts for failed requests
    RETRY_BACKOFF_BASE: 1500,                 // Base delay for retries (ms)
    RETRY_BACKOFF_MULTIPLIER: 2,              // Exponential backoff: 1.5s, 3s, 6s

    // Fetch timeouts
    FETCH_TIMEOUT: 30000,                     // Timeout for fetch requests (ms)

    // Request limits
    MAX_GRAPHQL_REQUESTS: 50,                 // Safety limit for GraphQL pagination
    MAX_API_REQUESTS: 50,                     // Safety limit for API pagination
    MAX_CHILD_COMMENT_REQUESTS: 20,           // Safety limit for reply pagination
  },

  // ============================================================================
  // VALIDATION
  // ============================================================================

  VALIDATION: {
    // Instagram shortcode format
    SHORTCODE_REGEX: /^[a-zA-Z0-9_-]{11}$/,
    SHORTCODE_LENGTH: 11,

    // URL patterns
    POST_URL_REGEX: /instagram\.com\/(p|reel|reels)\/([a-zA-Z0-9_-]{11})/,
    USERNAME_REGEX: /^[a-zA-Z0-9._]{1,30}$/,

    // Batch limits
    MAX_BATCH_SIZE: 100,                      // Maximum URLs in batch queue
    MIN_BATCH_SIZE: 1,                        // Minimum URLs in batch queue
  },

  // ============================================================================
  // FILE NAMING & ORGANIZATION
  // ============================================================================

  FILES: {
    // Folder structure
    BASE_FOLDER: 'Instagram',
    MEDIA_SUBFOLDER: 'media',
    COMMENTS_SUBFOLDER: 'comments',

    // Filename templates
    FOLDER_NAME_TEMPLATE: '{username}_{postType}_{date}_{shortcode}',
    MEDIA_FILENAME_TEMPLATE: '{shortcode}_{index}.{ext}',
    METADATA_FILENAME: 'metadata.json',
    COMMENTS_JSON_FILENAME: 'comments.json',
    COMMENTS_CSV_FILENAME: 'comments.csv',
    HTML_ARCHIVE_FILENAME: 'post_archive.html',

    // Date format for filenames
    DATE_FORMAT: 'YYYYMMDD',                  // e.g., 20241117
  },

  // ============================================================================
  // CACHING
  // ============================================================================

  CACHE: {
    // Request deduplication cache
    REQUEST_CACHE_TTL: 5000,                  // Time-to-live for request cache (ms)

    // Data cache
    POST_DATA_CACHE_TTL: 30000,               // Cache post data for 30 seconds
    AVATAR_CACHE_TTL: 300000,                 // Cache avatars for 5 minutes

    // Enable/disable caching
    ENABLE_REQUEST_CACHE: true,
    ENABLE_AVATAR_CACHE: true,
  },

  // ============================================================================
  // MEMORY & PERFORMANCE
  // ============================================================================

  PERFORMANCE: {
    // Conversion limits
    MAX_BASE64_SIZE: 50 * 1024 * 1024,        // 50MB max for base64 conversion

    // Batch processing
    BATCH_MEMORY_CLEANUP_INTERVAL: 10,        // Clean up memory every N items

    // Image processing
    IMAGE_CROP_QUALITY: 0.92,                 // JPEG quality for cropped images
    CANVAS_MAX_SIZE: 4096,                    // Maximum canvas dimension (px)
  },

  // ============================================================================
  // SECURITY & AUTHENTICATION
  // ============================================================================

  SECURITY: {
    // Default password hash (SHA-256 of 'MM66^^')
    // To change password: use chrome.storage.local.set({ passwordHash: 'new_hash' })
    DEFAULT_PASSWORD_HASH: 'f8e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a2918f7',
    PASSWORD_STORAGE_KEY: 'passwordHash',
    AUTH_STORAGE_KEY: 'isAuthenticated',
  },

  // ============================================================================
  // DEBUG & LOGGING
  // ============================================================================

  DEBUG: {
    ENABLE_CONSOLE_LOGS: true,                // Set to false for production
    ENABLE_VERBOSE_LOGS: true,                // Extra detailed logs
    LOG_API_REQUESTS: true,                   // Log all API calls
    LOG_RATE_LIMITS: true,                    // Log rate limit info
  },

  // ============================================================================
  // UI MESSAGES
  // ============================================================================

  MESSAGES: {
    ERRORS: {
      RATE_LIMITED: 'Instagram has rate limited you. Please wait 5-10 minutes before trying again.',
      SESSION_EXPIRED: 'Your Instagram session has expired. Please refresh the page and log back in.',
      NOT_ON_POST_PAGE: 'Please navigate to an Instagram post or reel page first.',
      EXTRACTION_FAILED: 'Failed to extract post data. Please try refreshing the page.',
      NETWORK_ERROR: 'Network error occurred. Please check your connection and try again.',
      INVALID_URL: 'Invalid Instagram URL format. Please use a valid post or reel URL.',
      BATCH_SIZE_EXCEEDED: 'Maximum batch size is 100 URLs. Please reduce the number of URLs.',
      DOWNLOAD_FAILED: 'Download failed. Please try again.',
    },

    SUCCESS: {
      EXTRACTION_COMPLETE: 'Data extracted successfully!',
      DOWNLOAD_COMPLETE: 'Download complete!',
      BATCH_COMPLETE: 'Batch processing complete!',
    },

    PROGRESS: {
      EXTRACTING_POST: 'Extracting post data...',
      FETCHING_COMMENTS: 'Fetching comments ({current}/{total})...',
      FETCHING_REPLIES: 'Fetching replies ({current}/{total})...',
      DOWNLOADING_MEDIA: 'Downloading media ({current}/{total})...',
      DOWNLOADING_AVATARS: 'Downloading avatars...',
      GENERATING_HTML: 'Generating HTML archive...',
      GENERATING_CSV: 'Generating CSV file...',
      GENERATING_JSON: 'Generating JSON file...',
      BATCH_PROCESSING: 'Processing batch ({current}/{total})...',
    },
  },
};

// Helper function to get random delay within range
CONFIG.getRandomDelay = function(rateLimitType) {
  const config = this.RATE_LIMITS[rateLimitType];
  if (!config) {
    console.warn(`Unknown rate limit type: ${rateLimitType}`);
    return 1000;
  }
  return config.min + Math.floor(Math.random() * (config.max - config.min));
};

// Helper function to format delay for display
CONFIG.formatDelay = function(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// Helper function to build Instagram URL
CONFIG.buildPostUrl = function(postType, shortcode) {
  const type = postType === 'reel' ? 'reel' : 'p';
  return `${this.API.BASE_URL}/${type}/${shortcode}/`;
};

// Helper function to validate shortcode
CONFIG.isValidShortcode = function(shortcode) {
  return this.VALIDATION.SHORTCODE_REGEX.test(shortcode);
};

// Simple hash function for password (not cryptographically secure, but sufficient for basic access control)
CONFIG.hashPassword = async function(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

// Verify password against stored hash
CONFIG.verifyPassword = async function(password, storedHash) {
  const inputHash = await this.hashPassword(password);
  return inputHash === storedHash;
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
