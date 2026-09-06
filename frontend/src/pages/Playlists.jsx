import React, { useEffect, useState, useCallback } from 'react';
import { playlistApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PlaylistCard from '../components/PlaylistCard';

const emptyItem = {
  media_type: 'image',
  source: 'url',
  url: '',
  file: null,
  content: '',
  duration: 10,
};

// Get actual duration of an uploaded video
function getVideoDuration(file) {
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

export default function Playlists() {
  const { isAdmin } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const res = await playlistApi.list();
    setPlaylists(res.data.data.playlists);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setItems([{ ...emptyItem }]);
    setShowForm(false);
  }

  function updateItem(index, field, value) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, [field]: value } : it
      )
    );
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function editPlaylist(playlist) {
    setEditingId(playlist._id);
    setName(playlist.name);

    setItems(
      playlist.items.map((it) => ({
        ...it,
        source: 'url',
        file: null,
      }))
    );

    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');

    try {
      const processedItems = [];

      for (const item of items) {
        let mediaUrl = item.url;

        // Upload file if user selected "Upload from device"
        if (
          item.media_type !== 'text' &&
          item.source === 'upload' &&
          item.file
        ) {
          const uploadResponse =
            await playlistApi.uploadMedia(item.file);

          mediaUrl = uploadResponse.data.data.url;
        }

        if (
          item.media_type !== 'text' &&
          !mediaUrl
        ) {
          throw new Error(
            `Please provide a URL or upload a ${item.media_type}.`
          );
        }

        processedItems.push({
          media_type: item.media_type,
          url:
            item.media_type !== 'text'
              ? mediaUrl
              : undefined,
          content:
            item.media_type === 'text'
              ? item.content
              : undefined,
          duration: Number(item.duration),
        });
      }

      const payload = {
        name,
        items: processedItems,
      };

      if (editingId) {
        await playlistApi.update(
          editingId,
          payload
        );
      } else {
        await playlistApi.create(payload);
      }

      resetForm();
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.message ||
        'Failed to save playlist'
      );
    }
  }

  async function handleDelete(playlist) {
    if (!window.confirm(`Delete playlist "${playlist.name}"?`)) return;

    await playlistApi.remove(playlist._id);
    load();
  }

  async function handleBroadcast(playlist) {
    await playlistApi.broadcast(playlist._id);
    load();
  }

  if (loading) {
    return (
      <div className="page-loading">
        Loading playlists...
      </div>
    );
  }

  return (
    <div className="page">

      <div className="page-header">
        <h1>Playlists</h1>

        {isAdmin && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? 'Cancel' : '+ Add Playlist'}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form
          className="card form-card"
          onSubmit={handleSave}
        >
          <h3>
            {editingId
              ? 'Edit Playlist'
              : 'New Playlist'}
          </h3>

          {error && (
            <div className="form-error">
              {error}
            </div>
          )}

          <label htmlFor="playlist-name">
            Playlist Name
          </label>

          <input
            id="playlist-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {items.map((item, idx) => (
            <div
              className="playlist-item-form"
              key={idx}
            >

              {/* Media Type */}
              <select
                value={item.media_type}
                onChange={(e) => {
                  updateItem(
                    idx,
                    'media_type',
                    e.target.value
                  );

                  // Reset duration when changing type
                  if (e.target.value === 'image') {
                    updateItem(idx, 'duration', 10);
                  }
                }}
              >
                <option value="image">
                  Image
                </option>

                <option value="video">
                  Video
                </option>

                <option value="text">
                  Text
                </option>
              </select>

              {item.media_type === 'text' ? (

                /* Text */
                <input
                  placeholder="Text content"
                  value={item.content}
                  onChange={(e) =>
                    updateItem(
                      idx,
                      'content',
                      e.target.value
                    )
                  }
                  required
                />

              ) : (

                /* Image / Video */
                <div className="media-source">

                  <select
                    value={item.source || 'url'}
                    onChange={(e) => {
                      updateItem(
                        idx,
                        'source',
                        e.target.value
                      );

                      // Clear the other source
                      if (e.target.value === 'url') {
                        updateItem(
                          idx,
                          'file',
                          null
                        );
                      } else {
                        updateItem(
                          idx,
                          'url',
                          ''
                        );
                      }
                    }}
                  >
                    <option value="url">
                      Paste URL
                    </option>

                    <option value="upload">
                      Upload from device
                    </option>
                  </select>

                  {item.source === 'upload' ? (

                    <input
                      type="file"
                      accept={
                        item.media_type === 'image'
                          ? 'image/*'
                          : 'video/*'
                      }
                      onChange={async (e) => {
                        const file =
                          e.target.files?.[0] ||
                          null;

                        updateItem(
                          idx,
                          'file',
                          file
                        );

                        if (!file) return;

                        // Automatically detect media type
                        if (
                          file.type.startsWith(
                            'video/'
                          )
                        ) {
                          updateItem(
                            idx,
                            'media_type',
                            'video'
                          );

                          try {
                            // Read actual video duration
                            const duration =
                              await getVideoDuration(
                                file
                              );

                            updateItem(
                              idx,
                              'duration',
                              duration
                            );

                            console.log(
                              `[VIDEO] ${file.name} duration: ${duration}s`
                            );

                          } catch (err) {
                            console.error(
                              '[VIDEO] Failed to read duration:',
                              err
                            );
                          }

                        } else if (
                          file.type.startsWith(
                            'image/'
                          )
                        ) {
                          updateItem(
                            idx,
                            'media_type',
                            'image'
                          );

                          // Default image duration
                          updateItem(
                            idx,
                            'duration',
                            10
                          );
                        }
                      }}
                      required={
                        !editingId || !item.url
                      }
                    />

                  ) : (

                    <input
                      placeholder="https://example.com/media.jpg"
                      value={item.url}
                      onChange={(e) =>
                        updateItem(
                          idx,
                          'url',
                          e.target.value
                        )
                      }
                      required
                    />

                  )}

                </div>
              )}

              {/* Duration */}
              <input
                type="number"
                min="1"
                placeholder="Duration (sec)"
                value={item.duration}
                onChange={(e) =>
                  updateItem(
                    idx,
                    'duration',
                    e.target.value
                  )
                }
                readOnly={
                  item.media_type === 'video' &&
                  item.source === 'upload'
                }
                required
              />

              {items.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => removeItem(idx)}
                >
                  Remove
                </button>
              )}

            </div>
          ))}

          <button
            type="button"
            className="btn btn-ghost"
            onClick={addItem}
          >
            + Add Item
          </button>

          <button
            type="submit"
            className="btn btn-primary"
          >
            Save Playlist
          </button>

        </form>
      )}

      <div className="playlist-grid">

        {playlists.length === 0 && (
          <p className="empty-state">
            No playlists yet.
          </p>
        )}

        {playlists.map((playlist) => (
          <PlaylistCard
            key={playlist._id}
            playlist={playlist}
            onEdit={
              isAdmin
                ? editPlaylist
                : () => {}
            }
            onDelete={
              isAdmin
                ? handleDelete
                : () => {}
            }
            onBroadcast={
              isAdmin
                ? handleBroadcast
                : () => {}
            }
          />
        ))}

      </div>

    </div>
  );
}