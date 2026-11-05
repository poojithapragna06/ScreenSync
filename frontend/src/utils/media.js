// Media helpers shared by the Playlists and Tasks pages

// youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/ (same pattern the TV clients use)
export const YOUTUBE_LINK =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{11}/i;

// Same as YOUTUBE_LINK, but captures the 11-character video ID
export const YOUTUBE_ID =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;

let youTubeApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);

  if (!youTubeApiPromise) {
    youTubeApiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (previous) previous();
        resolve(window.YT);
      };

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        youTubeApiPromise = null;
        reject(new Error('Unable to load the YouTube player API'));
      };
      document.head.appendChild(script);
    });
  }

  return youTubeApiPromise;
}

// YouTube player error codes, explained for the admin
// (https://developers.google.com/youtube/iframe_api_reference#onError)
export function describeYouTubeError(code) {
  switch (code) {
    case 2:
      return 'This YouTube link is not valid.';
    case 100:
      return 'This YouTube video was removed or is private.';
    case 101:
    case 150:
    case 152:
      return 'The owner of this YouTube video does not allow it to be played outside YouTube, so the screens cannot show it. Choose another video or upload the video file.';
    default:
      return 'YouTube refused to play this video outside YouTube. Choose another video or upload the video file.';
  }
}

// Get the length of a YouTube video by loading it in a hidden player.
// Rejects with error.blocked = true when YouTube refuses to play it embedded.

export async function getYouTubeDuration(videoId) {
  const YT = await loadYouTubeApi();

  return new Promise((resolve, reject) => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:fixed;left:-10000px;top:0;width:200px;height:200px;';

    const host = document.createElement('div');
    wrapper.appendChild(host);
    document.body.appendChild(wrapper);

    let player = null;
    let poll = null;
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error('Timed out reading YouTube duration. Check that the video is public and embeddable.'));
    }, 20000);

    function cleanup() {
      if (poll) clearInterval(poll);
      clearTimeout(timeout);

      try {
        if (player) player.destroy();
      } catch (e) {}

      wrapper.remove();
    }

    function finish(error, duration) {
      if (settled) return;
      settled = true;
      cleanup();

      if (error) reject(error);
      else resolve(duration);
    }

    function readDuration() {
      if (!player || settled) return;

      const duration = player.getDuration();

      if (Number.isFinite(duration) && duration > 0) {
        finish(null, Math.ceil(duration));
      }
    }

    player = new YT.Player(host, {
      width: 200,
      height: 200,
      playerVars: {
        autoplay: 0,
        controls: 0,
        playsinline: 1
      },
      events: {
        onReady: () => {
          player.cueVideoById(videoId);
          readDuration();
          poll = setInterval(readDuration, 300);
        },

        onStateChange: (event) => {
          if (event.data === YT.PlayerState.CUED) {
            readDuration();
          }
        },

        onError: (event) => {
          rejectYouTubeError(event.data);
        }
      }
    });

    function rejectYouTubeError(code) {
      const error = new Error(
        describeYouTubeError(code)
      );

      error.blocked = [2, 100, 101, 150, 152].includes(code);
      finish(error);
    }
  });
}


// Get the length of a video from its link (only the start of the file is downloaded)
export function getVideoUrlDuration(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeout = setTimeout(() => {
      video.removeAttribute('src');
      reject(new Error('Timed out reading video length'));
    }, 15000);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      if (isFinite(video.duration) && video.duration > 0) resolve(Math.ceil(video.duration));
      else reject(new Error('Invalid video duration'));
      video.removeAttribute('src');
    };
    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Unable to read video length'));
    };
    video.src = url;
  });
}

// Get actual duration of an uploaded video
export function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');

    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);

      if (isFinite(video.duration) && video.duration > 0) {
        resolve(Math.ceil(video.duration));
      } else {
        reject(new Error('Invalid video duration'));
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Unable to read video duration'));
    };

    video.src = URL.createObjectURL(file);
  });
}
