
(function () {
  const DB_NAME = 'ScreenSyncOffline';
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('playlist')) {
          db.createObjectStore('playlist', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveMedia(url, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put({ url, blob, savedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getCachedMedia(url) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction('media', 'readonly')
        .objectStore('media').get(url);
      request.onsuccess = () => {
        db.close();
        resolve(request.result?.blob || null);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async function savePlaylist(playlist) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlist', 'readwrite');
      tx.objectStore('playlist').put({
        id: 'active', data: playlist, savedAt: Date.now()
      });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getCachedPlaylist() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction('playlist', 'readonly')
        .objectStore('playlist').get('active');
      request.onsuccess = () => {
        db.close();
        resolve(request.result?.data || null);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  window.ScreenSyncOffline = {
    saveMedia,
    getCachedMedia,
    savePlaylist,
    getCachedPlaylist
  };
})();
