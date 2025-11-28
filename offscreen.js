// Offscreen document for image processing
// Used to crop screenshots since service workers don't have Canvas access

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CROP_SCREENSHOT') {
    cropScreenshot(message.dataUrl, message.cropLeft, message.cropBottom)
      .then(croppedDataUrl => {
        sendResponse({ success: true, dataUrl: croppedDataUrl });
      })
      .catch(error => {
        console.error('[Offscreen] Error cropping screenshot:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function cropScreenshot(dataUrl, cropLeftPercent, cropBottomPercent) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        // Calculate crop amounts
        const cropLeft = Math.floor(img.width * (cropLeftPercent / 100));
        const cropBottom = Math.floor(img.height * (cropBottomPercent / 100));

        // New dimensions after cropping
        const newWidth = img.width - cropLeft;
        const newHeight = img.height - cropBottom;

        // Set canvas size to the cropped dimensions
        canvas.width = newWidth;
        canvas.height = newHeight;

        // Draw the cropped portion
        // sx, sy: source x,y (start from cropLeft, 0)
        // sWidth, sHeight: source width/height
        // dx, dy: destination x,y (0, 0)
        // dWidth, dHeight: destination width/height
        ctx.drawImage(
          img,
          cropLeft, 0,           // Start from cropLeft pixels from left, top of image
          newWidth, newHeight,   // Width and height to extract
          0, 0,                  // Place at 0,0 on canvas
          newWidth, newHeight    // Same dimensions on canvas
        );

        // Convert back to data URL
        const croppedDataUrl = canvas.toDataURL('image/png', 1.0);
        resolve(croppedDataUrl);

      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = dataUrl;
  });
}

console.log('[Offscreen] Document ready for image processing');
