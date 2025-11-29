// State
let posts = [];
let currentView = 'grid';
let currentPostIndex = 0;
let currentMediaIndex = 0;

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const postsContainer = document.getElementById('postsContainer');
const loading = document.getElementById('loading');
const gridView = document.getElementById('gridView');
const feedView = document.getElementById('feedView');
const emptyState = document.getElementById('emptyState');
const viewToggle = document.getElementById('viewToggle');
const modalOverlay = document.getElementById('modalOverlay');
const modalMedia = document.getElementById('modalMedia');
const modalHeader = document.getElementById('modalHeader');
const modalCaption = document.getElementById('modalCaption');
const modalComments = document.getElementById('modalComments');
const modalFooter = document.getElementById('modalFooter');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const typeFilter = document.getElementById('typeFilter');

// Check if File System Access API is supported
const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';

// Select folder buttons
document.getElementById('selectFolderBtn').addEventListener('click', selectFolder);
document.getElementById('welcomeBtn').addEventListener('click', selectFolder);

// Fallback file input for Safari and other browsers
const fallbackUpload = document.getElementById('fallbackUpload');
const fileInput = document.getElementById('fileInput');
const selectFilesBtn = document.getElementById('selectFilesBtn');

// Show fallback if directory picker not supported
if (!supportsDirectoryPicker) {
  fallbackUpload.classList.remove('hidden');
  document.getElementById('welcomeBtn').classList.add('hidden');
  document.getElementById('selectFolderBtn').classList.add('hidden');
}

selectFilesBtn?.addEventListener('click', () => fileInput.click());
fileInput?.addEventListener('change', handleFileSelect);

// View toggle
viewToggle.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    viewToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderPosts();
  });
});

// Filters
searchInput.addEventListener('input', renderPosts);
sortSelect.addEventListener('change', renderPosts);
typeFilter.addEventListener('change', renderPosts);

// Modal close
document.getElementById('modalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (!modalOverlay.classList.contains('active')) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'ArrowLeft') navigateModal(-1);
  if (e.key === 'ArrowRight') navigateModal(1);
});

// Select folder using File System Access API
async function selectFolder() {
  // Check if API is supported
  if (!supportsDirectoryPicker) {
    fallbackUpload.classList.remove('hidden');
    alert('Your browser does not support folder selection.\n\nPlease use the file picker below to select files from your Instagram folder, or use Chrome for the best experience.');
    return;
  }

  try {
    console.log('Opening folder picker...');
    const dirHandle = await window.showDirectoryPicker();
    console.log('Folder selected:', dirHandle.name);

    welcomeScreen.classList.add('hidden');
    loading.classList.remove('hidden');

    posts = await scanFolder(dirHandle);
    console.log('Scan complete. Found', posts.length, 'posts');

    loading.classList.add('hidden');

    if (posts.length > 0) {
      postsContainer.classList.remove('hidden');
      viewToggle.classList.remove('hidden');
      updateStats();
      renderPosts();
    } else {
      welcomeScreen.classList.remove('hidden');
      alert('No Instagram posts found in this folder.\n\nMake sure you selected a folder containing posts downloaded with IG Quick Save.\n\nExpected structure:\nInstagram/\n  username_POST_date_code/\n    *_metadata.json\n    media/\n    comments/');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Error selecting folder:', err);
      console.error('Error details:', err.message, err.stack);
      alert('Error reading folder: ' + err.message + '\n\nPlease try again or check the browser console for details.');
    }
    loading.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
  }
}

// Handle file input for browsers without directory picker (Safari fallback)
async function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  console.log('Files selected:', files.length);
  welcomeScreen.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    posts = await processFilesFromInput(files);
    console.log('Processing complete. Found', posts.length, 'posts');

    loading.classList.add('hidden');

    if (posts.length > 0) {
      postsContainer.classList.remove('hidden');
      viewToggle.classList.remove('hidden');
      updateStats();
      renderPosts();
    } else {
      welcomeScreen.classList.remove('hidden');
      alert('No Instagram posts found in the selected files.\n\nMake sure you selected files from a folder containing posts downloaded with IG Quick Save.');
    }
  } catch (err) {
    console.error('Error processing files:', err);
    alert('Error processing files: ' + err.message);
    loading.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
  }
}

// Process files from file input (Safari fallback)
async function processFilesFromInput(files) {
  const foundPosts = [];
  const folderMap = new Map(); // folder path -> files

  // Group files by their parent folder
  for (const file of files) {
    // webkitRelativePath gives us the path like "Instagram/username_POST_date/media/file.jpg"
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');

    // Find the post folder (one containing _metadata.json or has /media/ subfolder)
    for (let i = 0; i < parts.length; i++) {
      const folderPath = parts.slice(0, i + 1).join('/');
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, []);
      }
      folderMap.get(folderPath).push({ file, relativePath: parts.slice(i + 1).join('/') });
    }
  }

  console.log('Found', folderMap.size, 'unique paths');

  // Find folders that have metadata files
  for (const [folderPath, folderFiles] of folderMap) {
    const metadataFile = folderFiles.find(f => f.relativePath.endsWith('_metadata.json') && !f.relativePath.includes('/'));

    if (metadataFile) {
      console.log('Found metadata in:', folderPath);

      try {
        const metadataText = await metadataFile.file.text();
        const metadata = JSON.parse(metadataText);

        const post = {
          ...metadata,
          media: [],
          comments: [],
          avatars: {}
        };

        // Get media files
        const mediaFiles = folderFiles.filter(f => f.relativePath.startsWith('media/'));
        for (const mediaFile of mediaFiles) {
          post.media.push({
            name: mediaFile.relativePath.replace('media/', ''),
            type: mediaFile.file.type.startsWith('video') ? 'video' : 'image',
            url: URL.createObjectURL(mediaFile.file)
          });
        }
        post.media.sort((a, b) => a.name.localeCompare(b.name));

        // Get comments
        const commentsFile = folderFiles.find(f => f.relativePath.startsWith('comments/') && f.relativePath.endsWith('.json'));
        if (commentsFile) {
          try {
            const commentsText = await commentsFile.file.text();
            const commentsData = JSON.parse(commentsText);
            post.comments = commentsData.comments || [];
            post.totalComments = commentsData.total || post.comments.length;
          } catch (e) {
            console.error('Error reading comments:', e);
          }
        }

        // Get avatars from HTML archive
        const archiveFile = folderFiles.find(f => f.relativePath.endsWith('_archive.html') && !f.relativePath.includes('/'));
        if (archiveFile) {
          try {
            const html = await archiveFile.file.text();
            const avatarRegex = /<img\s+src="(data:image\/[^"]+)"\s+alt="([^"]+)"\s+class="[^"]*avatar[^"]*"/g;
            let match;
            while ((match = avatarRegex.exec(html)) !== null) {
              const [, base64, username] = match;
              if (username && base64) post.avatars[username] = base64;
            }
          } catch (e) {
            console.error('Error reading HTML archive:', e);
          }
        }

        if (post.media.length > 0 || post.comments.length > 0) {
          foundPosts.push(post);
        }
      } catch (e) {
        console.error('Error processing folder:', folderPath, e);
      }
    }
  }

  return foundPosts;
}

// Scan folder recursively for Instagram posts
async function scanFolder(dirHandle, path = '', depth = 0) {
  const foundPosts = [];
  const maxDepth = 5; // Prevent infinite recursion

  if (depth > maxDepth) {
    console.log('Max depth reached at:', path);
    return foundPosts;
  }

  console.log('Scanning:', path || dirHandle.name);

  try {
    for await (const entry of dirHandle.values()) {
      try {
        if (entry.kind === 'directory') {
          console.log('  Found directory:', entry.name);

          // Check if this looks like an Instagram post folder
          const metadata = await findMetadata(entry);

          if (metadata) {
            console.log('  Found metadata in:', entry.name);
            const post = await loadPost(entry, metadata);
            if (post) {
              console.log('  Loaded post:', post.username, post.shortcode);
              foundPosts.push(post);
            }
          } else {
            // Recurse into subdirectories
            const subPosts = await scanFolder(entry, path + entry.name + '/', depth + 1);
            foundPosts.push(...subPosts);
          }
        } else if (entry.kind === 'file') {
          // Check if there's a metadata file directly in this folder
          if (entry.name.endsWith('_metadata.json')) {
            console.log('  Found metadata file:', entry.name);
          }
        }
      } catch (entryErr) {
        console.warn('Error processing entry:', entry.name, entryErr.message);
      }
    }
  } catch (scanErr) {
    console.error('Error scanning directory:', path, scanErr.message);
  }

  return foundPosts;
}

// Find metadata.json in a folder
async function findMetadata(dirHandle) {
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('_metadata.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          return JSON.parse(text);
        } catch (e) {
          console.error('Error reading metadata file:', entry.name, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Error iterating folder for metadata:', e.message);
  }
  return null;
}

// Load a post from a folder
async function loadPost(dirHandle, metadata) {
  const post = {
    ...metadata,
    media: [],
    comments: [],
    avatars: {}, // Map of username -> base64 avatar
    folderHandle: dirHandle
  };

  // Load media files
  try {
    const mediaHandle = await dirHandle.getDirectoryHandle('media');
    for await (const entry of mediaHandle.values()) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          post.media.push({
            name: entry.name,
            type: file.type.startsWith('video') ? 'video' : 'image',
            url: URL.createObjectURL(file)
          });
        } catch (fileErr) {
          console.warn('Error loading media file:', entry.name, fileErr.message);
        }
      }
    }
    // Sort media by name
    post.media.sort((a, b) => a.name.localeCompare(b.name));
    console.log('  Loaded', post.media.length, 'media files');
  } catch (e) {
    // No media folder - that's ok
    console.log('  No media folder found');
  }

  // Load comments
  try {
    const commentsHandle = await dirHandle.getDirectoryHandle('comments');
    for await (const entry of commentsHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const data = JSON.parse(text);
          post.comments = data.comments || [];
          post.totalComments = data.total || post.comments.length;
          console.log('  Loaded', post.comments.length, 'comments');
        } catch (e) {
          console.error('Error reading comments:', e.message);
        }
      }
    }
  } catch (e) {
    // No comments folder - that's ok
    console.log('  No comments folder found');
  }

  // Load avatars from HTML archive
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('_archive.html')) {
        try {
          const file = await entry.getFile();
          const html = await file.text();

          // Extract avatars from HTML - they're in img tags with base64 src
          // Pattern: <img src="data:image/..." alt="username" class="...-avatar">
          const avatarRegex = /<img\s+src="(data:image\/[^"]+)"\s+alt="([^"]+)"\s+class="[^"]*avatar[^"]*"/g;
          let match;
          while ((match = avatarRegex.exec(html)) !== null) {
            const [, base64, username] = match;
            if (username && base64 && !post.avatars[username]) {
              post.avatars[username] = base64;
            }
          }

          // Also try alternate pattern where class comes before src
          const avatarRegex2 = /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="(data:image\/[^"]+)"[^>]*alt="([^"]+)"/g;
          while ((match = avatarRegex2.exec(html)) !== null) {
            const [, base64, username] = match;
            if (username && base64 && !post.avatars[username]) {
              post.avatars[username] = base64;
            }
          }

          // Try to find profile avatar specifically (may have different pattern)
          const profileAvatarMatch = html.match(/class="profile-avatar"[^>]*src="(data:image\/[^"]+)"/);
          if (profileAvatarMatch && post.username) {
            post.avatars[post.username] = profileAvatarMatch[1];
          }

          // Alternate: src before class
          const profileAvatarMatch2 = html.match(/src="(data:image\/[^"]+)"[^>]*alt="([^"]+)"[^>]*class="profile-avatar"/);
          if (profileAvatarMatch2) {
            post.avatars[profileAvatarMatch2[2]] = profileAvatarMatch2[1];
          }

          console.log('  Loaded', Object.keys(post.avatars).length, 'avatars from HTML');
        } catch (e) {
          console.error('Error reading HTML archive:', e.message);
        }
        break; // Only need one HTML file
      }
    }
  } catch (e) {
    console.log('  No HTML archive found');
  }

  return post;
}

// Update stats
function updateStats() {
  document.getElementById('totalPosts').textContent = posts.length;
  document.getElementById('totalMedia').textContent = posts.reduce((sum, p) => sum + p.media.length, 0);
  document.getElementById('totalComments').textContent = posts.reduce((sum, p) => sum + (p.totalComments || p.comments.length), 0);
}

// Filter and sort posts
function getFilteredPosts() {
  let filtered = [...posts];

  // Search filter
  const search = searchInput.value.toLowerCase();
  if (search) {
    filtered = filtered.filter(p =>
      (p.username || '').toLowerCase().includes(search) ||
      (p.caption || '').toLowerCase().includes(search)
    );
  }

  // Type filter
  const type = typeFilter.value;
  if (type !== 'all') {
    filtered = filtered.filter(p => {
      if (type === 'image') return p.media.length === 1 && p.media[0].type === 'image';
      if (type === 'video') return p.media.some(m => m.type === 'video');
      if (type === 'carousel') return p.media.length > 1;
      return true;
    });
  }

  // Sort
  const sort = sortSelect.value;
  filtered.sort((a, b) => {
    if (sort === 'newest') return new Date(b.posted_at || 0) - new Date(a.posted_at || 0);
    if (sort === 'oldest') return new Date(a.posted_at || 0) - new Date(b.posted_at || 0);
    if (sort === 'most-liked') return (b.like_count || 0) - (a.like_count || 0);
    if (sort === 'most-comments') return (b.comment_count || 0) - (a.comment_count || 0);
    return 0;
  });

  return filtered;
}

// Render posts
function renderPosts() {
  const filtered = getFilteredPosts();

  if (filtered.length === 0) {
    gridView.classList.add('hidden');
    feedView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  if (currentView === 'grid') {
    gridView.classList.remove('hidden');
    feedView.classList.add('hidden');
    renderGridView(filtered);
  } else {
    gridView.classList.add('hidden');
    feedView.classList.remove('hidden');
    renderFeedView(filtered);
  }
}

// Render grid view
function renderGridView(postsToRender) {
  gridView.innerHTML = postsToRender.map((post, index) => {
    const media = post.media[0];
    const isVideo = post.media.some(m => m.type === 'video');
    const isCarousel = post.media.length > 1;
    const postIndex = posts.indexOf(post);
    const username = post.username || 'Unknown';
    const hasLongCaption = post.caption && post.caption.length > 100;
    const captionId = `grid-caption-${postIndex}`;

    return `
      <div class="grid-item" data-post-index="${postIndex}">
        <div class="grid-item-media" data-action="open-modal">
          ${media ? (media.type === 'video'
            ? `<video src="${media.url}" muted></video>`
            : `<img src="${media.url}" alt="">`)
            : '<div style="background: var(--bg-tertiary); width: 100%; height: 100%;"></div>'}
          <div class="grid-item-overlay">
            <span class="grid-stat">❤️ ${formatNumber(post.like_count || 0)}</span>
            <span class="grid-stat">💬 ${formatNumber(post.comment_count || 0)}</span>
          </div>
          ${isCarousel ? '<span class="grid-item-type">📷</span>' : ''}
          ${isVideo && !isCarousel ? '<span class="grid-item-type">▶️</span>' : ''}
        </div>
        <div class="grid-item-info">
          <div class="grid-item-header">
            ${renderAvatar(username, post.avatars, 'grid-item-avatar')}
            <span class="grid-item-username">${escapeHtml(username)}</span>
          </div>
          ${post.caption ? `
            <div class="grid-item-caption" id="${captionId}">${escapeHtml(post.caption)}</div>
            ${hasLongCaption ? `
              <div class="grid-item-caption-more" data-caption-id="${captionId}">more</div>
            ` : ''}
          ` : ''}
          <div class="grid-item-stats">
            <span>❤️ ${formatNumber(post.like_count || 0)}</span>
            <span>💬 ${formatNumber(post.comment_count || 0)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for opening modal
  gridView.querySelectorAll('.grid-item-media').forEach(item => {
    item.addEventListener('click', () => {
      const postIndex = parseInt(item.closest('.grid-item').dataset.postIndex);
      openModal(postIndex);
    });
  });

  // Add click handlers for caption expand/collapse
  gridView.querySelectorAll('.grid-item-caption-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const captionId = btn.dataset.captionId;
      const caption = document.getElementById(captionId);
      if (caption.classList.contains('expanded')) {
        caption.classList.remove('expanded');
        btn.textContent = 'more';
      } else {
        caption.classList.add('expanded');
        btn.textContent = 'less';
      }
    });
  });
}

// Get avatar initial(s) from username
function getAvatarInitial(username) {
  if (!username) return '?';
  return username.charAt(0).toUpperCase();
}

// Generate a consistent color based on username
function getAvatarColor(username) {
  const colors = [
    'linear-gradient(45deg, #f09433, #dc2743)',
    'linear-gradient(45deg, #4f5bd5, #962fbf)',
    'linear-gradient(45deg, #00c6ff, #0072ff)',
    'linear-gradient(45deg, #11998e, #38ef7d)',
    'linear-gradient(45deg, #ee0979, #ff6a00)',
    'linear-gradient(45deg, #7f00ff, #e100ff)',
    'linear-gradient(45deg, #fc4a1a, #f7b733)',
    'linear-gradient(45deg, #00b4db, #0083b0)',
  ];
  if (!username) return colors[0];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Render avatar HTML - uses actual image if available, fallback to initial
function renderAvatar(username, avatars, cssClass = 'feed-avatar') {
  const initial = getAvatarInitial(username);
  const color = getAvatarColor(username);

  if (avatars && avatars[username]) {
    return `<img src="${avatars[username]}" alt="${escapeHtml(username)}" class="${cssClass}">`;
  }

  return `<div class="${cssClass}" style="background: ${color};">${initial}</div>`;
}

// Format relative time like Instagram
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 4) return `${diffWeeks} weeks ago`;

  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

// Render feed view
function renderFeedView(postsToRender) {
  feedView.innerHTML = postsToRender.map((post, index) => {
    const media = post.media[0];
    const postIndex = posts.indexOf(post);
    const relativeTime = formatRelativeTime(post.posted_at);
    const username = post.username || 'Unknown';
    const captionId = `caption-${postIndex}`;
    const hasLongCaption = post.caption && post.caption.length > 125;

    return `
      <article class="feed-post" data-post-index="${postIndex}">
        <header class="feed-post-header">
          ${renderAvatar(username, post.avatars, 'feed-avatar')}
          <div>
            <div class="feed-username">${escapeHtml(username)}</div>
          </div>
        </header>
        <div class="feed-media-container" data-action="open-modal">
          ${media ? (media.type === 'video'
            ? `<video class="feed-media" src="${media.url}" controls></video>`
            : `<img class="feed-media" src="${media.url}" alt="">`)
            : '<div class="feed-media" style="background: var(--bg-tertiary);"></div>'}
          ${post.media.length > 1 ? `
            <div class="feed-carousel-dots">
              ${post.media.map((_, i) => `<div class="feed-carousel-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
            </div>
          ` : ''}
        </div>
        <div class="feed-actions">
          <div class="feed-actions-left">
            <button class="feed-action-btn" title="Like">🤍</button>
            <button class="feed-action-btn" data-action="open-modal" title="Comment">💬</button>
            <button class="feed-action-btn" title="Share">✈️</button>
          </div>
          <div class="feed-actions-right">
            <button class="feed-action-btn" title="Save">🔖</button>
          </div>
        </div>
        <div class="feed-stats">${formatNumber(post.like_count || 0)} likes</div>
        ${post.caption ? `
          <div class="feed-caption-section">
            <div class="feed-caption" id="${captionId}">
              <span class="feed-caption-username">${escapeHtml(username)}</span>${escapeHtml(post.caption)}
            </div>
            ${hasLongCaption ? `
              <div class="feed-caption-more" data-caption-id="${captionId}">more</div>
            ` : ''}
          </div>
        ` : ''}
        ${post.comment_count > 0 ? `
          <div class="feed-view-comments" data-action="open-modal">
            View all ${formatNumber(post.comment_count)} comments
          </div>
        ` : ''}
        <div class="feed-time">${relativeTime}</div>
      </article>
    `;
  }).join('');

  // Add click handlers
  feedView.querySelectorAll('[data-action="open-modal"]').forEach(el => {
    el.addEventListener('click', (e) => {
      const postEl = e.target.closest('.feed-post');
      if (postEl) {
        openModal(parseInt(postEl.dataset.postIndex));
      }
    });
  });

  feedView.querySelectorAll('.feed-caption-more').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleCaption(btn.dataset.captionId, btn);
    });
  });
}

// Toggle caption expand/collapse
function toggleCaption(captionId, btn) {
  const caption = document.getElementById(captionId);
  if (caption.classList.contains('expanded')) {
    caption.classList.remove('expanded');
    btn.textContent = 'more';
  } else {
    caption.classList.add('expanded');
    btn.textContent = 'less';
  }
}

// Open modal
function openModal(postIndex) {
  currentPostIndex = postIndex;
  currentMediaIndex = 0;
  const post = posts[postIndex];

  updateModalMedia(post);

  // Header
  const username = post.username || 'Unknown';
  const relativeTime = formatRelativeTime(post.posted_at);

  modalHeader.innerHTML = `
    ${renderAvatar(username, post.avatars, 'feed-avatar')}
    <div>
      <div class="feed-username">${escapeHtml(username)}</div>
    </div>
  `;

  // Caption (separate section) - with expand/collapse for long captions
  if (post.caption) {
    const hasLongCaption = post.caption.length > 150;
    modalCaption.innerHTML = `
      <div class="modal-caption-content">
        ${renderAvatar(username, post.avatars, 'comment-avatar')}
        <div class="modal-caption-text">
          <div class="modal-caption-body" id="modalCaptionBody">
            <span class="modal-caption-username">${escapeHtml(username)}</span>${escapeHtml(post.caption)}
          </div>
          ${hasLongCaption ? `<span class="modal-caption-more" id="modalCaptionMore">more</span>` : ''}
          <div class="modal-caption-time">${relativeTime}</div>
        </div>
      </div>
    `;
    modalCaption.style.display = 'block';

    // Add click handler for expand/collapse
    if (hasLongCaption) {
      const captionMore = document.getElementById('modalCaptionMore');
      const captionBody = document.getElementById('modalCaptionBody');
      captionMore?.addEventListener('click', () => {
        if (captionBody.classList.contains('expanded')) {
          captionBody.classList.remove('expanded');
          captionMore.textContent = 'more';
        } else {
          captionBody.classList.add('expanded');
          captionMore.textContent = 'less';
        }
      });
    }
  } else {
    modalCaption.innerHTML = '';
    modalCaption.style.display = 'none';
  }

  // Comments
  if (post.comments.length > 0) {
    const totalComments = countAllComments(post.comments);
    modalComments.innerHTML = `
      <div class="modal-comments-search">
        <input type="text" id="commentSearchInput" placeholder="Search comments...">
        <span class="modal-comments-search-icon">🔍</span>
        <button class="modal-comments-search-clear" id="commentSearchClear">×</button>
      </div>
      <div class="modal-comments-header">
        <span>Comments</span>
        <span class="modal-comments-count" id="commentsCount">${totalComments} comments</span>
      </div>
      <div class="modal-comments-list" id="commentsListContainer">
        ${post.comments.map((comment, idx) => renderCommentWithId(comment, post.avatars, idx)).join('')}
      </div>
      <div class="no-results hidden" id="noCommentsResults">No comments matching your search</div>
    `;

    // Add event listeners for comment search
    const commentSearchInput = document.getElementById('commentSearchInput');
    const commentSearchClear = document.getElementById('commentSearchClear');
    if (commentSearchInput) {
      commentSearchInput.addEventListener('input', filterComments);
    }
    if (commentSearchClear) {
      commentSearchClear.addEventListener('click', clearCommentSearch);
    }

    // Store current post comments for filtering
    window.currentPostComments = post.comments;
    window.currentPostAvatars = post.avatars;
  } else {
    modalComments.innerHTML = `
      <div class="empty-state">
        <p>No comments available</p>
      </div>
    `;
  }

  // Footer
  modalFooter.innerHTML = `
    <div class="modal-stats">${formatNumber(post.like_count || 0)} likes</div>
  `;

  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// Update modal media
function updateModalMedia(post) {
  const media = post.media[currentMediaIndex];

  if (!media) {
    modalMedia.innerHTML = '<div style="padding: 40px; color: var(--text-secondary);">No media available</div>';
    return;
  }

  const hasMultiple = post.media.length > 1;

  modalMedia.innerHTML = `
    ${media.type === 'video'
      ? `<video src="${media.url}" controls autoplay style="max-width: 100%; max-height: 100%;"></video>`
      : `<img src="${media.url}" alt="" style="max-width: 100%; max-height: 100%;">`}
    ${hasMultiple ? `
      <button class="feed-carousel-btn prev" id="carouselPrev">❮</button>
      <button class="feed-carousel-btn next" id="carouselNext">❯</button>
      <div class="feed-carousel-dots" style="position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);">
        ${post.media.map((_, i) => `<div class="feed-carousel-dot ${i === currentMediaIndex ? 'active' : ''}" data-media-index="${i}"></div>`).join('')}
      </div>
    ` : ''}
  `;

  // Add carousel event listeners
  if (hasMultiple) {
    document.getElementById('carouselPrev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMedia(-1);
    });
    document.getElementById('carouselNext')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMedia(1);
    });
    modalMedia.querySelectorAll('.feed-carousel-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goToMedia(parseInt(dot.dataset.mediaIndex));
      });
    });
  }
}

// Change media in carousel
function changeMedia(delta) {
  const post = posts[currentPostIndex];
  currentMediaIndex = (currentMediaIndex + delta + post.media.length) % post.media.length;
  updateModalMedia(post);
}

// Go to specific media
function goToMedia(index) {
  currentMediaIndex = index;
  updateModalMedia(posts[currentPostIndex]);
}

// Navigate modal between posts
function navigateModal(delta) {
  const filtered = getFilteredPosts();
  const currentFiltered = filtered.indexOf(posts[currentPostIndex]);
  const newIndex = currentFiltered + delta;

  if (newIndex >= 0 && newIndex < filtered.length) {
    currentPostIndex = posts.indexOf(filtered[newIndex]);
    currentMediaIndex = 0;
    openModal(currentPostIndex);
  }
}

// Count all comments including replies
function countAllComments(comments) {
  let count = 0;
  for (const comment of comments) {
    count++;
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies);
    }
  }
  return count;
}

// Render comment with ID for filtering
function renderCommentWithId(comment, avatars = {}, index, parentIndex = '') {
  const date = comment.created_at ? new Date(comment.created_at * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric'
  }) : '';
  const commentUsername = comment.owner?.username || 'Unknown';
  const commentId = parentIndex ? `${parentIndex}-${index}` : `${index}`;
  const commentText = comment.text || '';

  return `
    <div class="comment" data-comment-id="${commentId}" data-username="${escapeHtml(commentUsername).toLowerCase()}" data-text="${escapeHtml(commentText).toLowerCase()}">
      ${renderAvatar(commentUsername, avatars, 'comment-avatar')}
      <div class="comment-content">
        <span class="comment-username">${escapeHtml(commentUsername)}</span>
        <span class="comment-text" data-original="${escapeHtml(commentText)}">${escapeHtml(commentText)}</span>
        <div class="comment-meta">
          <span>${date}</span>
          <span>${formatNumber(comment.like_count || 0)} likes</span>
        </div>
        ${comment.replies && comment.replies.length > 0 ? `
          <div class="comment-replies">
            ${comment.replies.map((reply, replyIdx) => renderCommentWithId(reply, avatars, replyIdx, commentId)).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Filter comments based on search input
function filterComments() {
  const searchInput = document.getElementById('commentSearchInput');
  const clearBtn = document.getElementById('commentSearchClear');
  const searchIcon = document.querySelector('.modal-comments-search-icon');
  const countEl = document.getElementById('commentsCount');
  const noResults = document.getElementById('noCommentsResults');
  const container = document.getElementById('commentsListContainer');

  if (!searchInput || !container) return;

  const query = searchInput.value.toLowerCase().trim();

  // Toggle clear button visibility
  if (clearBtn && searchIcon) {
    if (query) {
      clearBtn.classList.add('visible');
      searchIcon.style.display = 'none';
    } else {
      clearBtn.classList.remove('visible');
      searchIcon.style.display = 'block';
    }
  }

  const comments = container.querySelectorAll('.comment');
  let visibleCount = 0;
  let totalCount = comments.length;

  comments.forEach(comment => {
    const username = comment.dataset.username || '';
    const text = comment.dataset.text || '';
    const textEl = comment.querySelector('.comment-text');
    const originalText = textEl?.dataset.original || '';

    if (!query) {
      // No search - show all, remove highlights
      comment.classList.remove('hidden');
      if (textEl) textEl.innerHTML = originalText;
      visibleCount++;
    } else if (username.includes(query) || text.includes(query)) {
      // Match found - show and highlight
      comment.classList.remove('hidden');
      visibleCount++;

      // Highlight matching text
      if (textEl && text.includes(query)) {
        const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
        textEl.innerHTML = originalText.replace(regex, '<span class="comment-highlight">$1</span>');
      } else if (textEl) {
        textEl.innerHTML = originalText;
      }
    } else {
      // No match - hide
      comment.classList.add('hidden');
      if (textEl) textEl.innerHTML = originalText;
    }
  });

  // Update count
  if (countEl) {
    if (query) {
      countEl.textContent = `${visibleCount} of ${totalCount} comments`;
    } else {
      countEl.textContent = `${totalCount} comments`;
    }
  }

  // Show/hide no results message
  if (noResults) {
    if (query && visibleCount === 0) {
      noResults.classList.remove('hidden');
    } else {
      noResults.classList.add('hidden');
    }
  }
}

// Clear comment search
function clearCommentSearch() {
  const searchInput = document.getElementById('commentSearchInput');
  if (searchInput) {
    searchInput.value = '';
    filterComments();
    searchInput.focus();
  }
}

// Escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Close modal
function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';

  // Stop any playing videos
  const video = modalMedia.querySelector('video');
  if (video) video.pause();
}

// Helper: Format number
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
