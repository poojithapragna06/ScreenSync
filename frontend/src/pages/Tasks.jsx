import React, { useEffect, useState, useCallback, useRef } from 'react';
import { taskApi, playlistApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import TaskCard from '../components/TaskCard';
import PriorityPicker from '../components/PriorityPicker';
import {
  YOUTUBE_LINK,
  YOUTUBE_ID,
  getYouTubeDuration,
  getVideoDuration,
  getVideoUrlDuration,
} from '../utils/media';

// "5:54" / "1:02:10"
function formatLength(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// "YYYY-MM-DDTHH:mm" in this computer's local time, as <input type="datetime-local"> expects
function toDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function Tasks() {
  const { isAdmin } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState(2);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  // Optional media shown full screen while the task is on ('' = message only)
  const [mediaType, setMediaType] = useState('');
  const [mediaSource, setMediaSource] = useState('url');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaDuration, setMediaDuration] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [readingDuration, setReadingDuration] = useState(false);
  const [mediaError, setMediaError] = useState('');
  // Videos: play once (end = start + video length) or loop until an end time
  const [playOnce, setPlayOnce] = useState(true);
  const latestYouTubeUrl = useRef('');
  const latestVideoSource = useRef(null);

  const isVideo = mediaType === 'video' || mediaType === 'youtube';
  const endsWithVideo = isVideo && playOnce;

  const load = useCallback(async () => {
    const res = await taskApi.listAll();
    setTasks(res.data.data.tasks.sort((a, b) => b.priority - a.priority));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      let media;

      if (mediaType) {
        let url = mediaUrl.trim();

        // Upload the file first if "Upload from device" was chosen
        if (mediaType !== 'youtube' && mediaSource === 'upload') {
          if (!mediaFile) throw new Error(`Please choose a ${mediaType} file to upload.`);
          const uploadResponse = await playlistApi.uploadMedia(mediaFile);
          url = uploadResponse.data.data.url;
        }

        if (!url) throw new Error(`Please provide a URL for the ${mediaType}.`);

        if (mediaType === 'youtube' && !YOUTUBE_LINK.test(url)) {
          throw new Error(
            `"${url}" is not a YouTube video link. Use a link like https://www.youtube.com/watch?v=... or https://youtu.be/...`
          );
        }

        if (mediaType === 'youtube' && mediaError) throw new Error(mediaError);

        media = { media_type: mediaType, url };
      }

      let startMs = new Date(start).getTime();
      let endMs = new Date(end).getTime();

      if (isVideo) {
        // The time box only has minutes, so "now" is up to a minute in the
        // past - and the screens would start the video that far in. A start
        // that has already passed means "start right away".
        if (startMs < Date.now()) startMs = Date.now() + 2000;

        let duration = mediaDuration;
        if (!duration && mediaType === 'video') {
          // Length not read yet (e.g. Enter pressed in the link box)
          const source = mediaSource === 'upload' ? mediaFile : media.url;
          duration = await (typeof source === 'string' ? getVideoUrlDuration(source) : getVideoDuration(source))
            .catch(() => null);
        }
        if (duration) media.duration = duration;

        if (playOnce) {
          if (!duration) {
            throw new Error(
              "Couldn't read the video's length. Choose \"Until an end time\" and set the end yourself."
            );
          }
          endMs = startMs + duration * 1000;
        }
      }

      await taskApi.create({
        title,
        content,
        priority: Number(priority),
        schedule: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
        media,
      });
      setTitle('');
      setContent('');
      setPriority(2);
      setStart('');
      setEnd('');
      resetMedia('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  // Read an uploaded file's or a video link's length (for "Play once")
  async function readVideoLength(source) {
    latestVideoSource.current = source;
    setMediaDuration(null);
    if (!source) return;

    setReadingDuration(true);
    try {
      const duration = typeof source === 'string'
        ? await getVideoUrlDuration(source)
        : await getVideoDuration(source);
      if (latestVideoSource.current === source) setMediaDuration(duration);
    } catch (err) {
      console.warn('[VIDEO] Failed to read length:', err.message);
    } finally {
      if (latestVideoSource.current === source) setReadingDuration(false);
    }
  }

  function resetMedia(type) {
    latestYouTubeUrl.current = '';
    latestVideoSource.current = null;
    setPlayOnce(true);
    setReadingDuration(false);
    setMediaError('');
    setMediaType(type);
    setMediaSource('url');
    setMediaUrl('');
    setMediaFile(null);
    setMediaDuration(null);
  }

  // Read the YouTube video's length: it sets the end time for "Play once",
  // and lets every screen work out the same playback position
  async function onYouTubeUrlChange(url) {
    latestYouTubeUrl.current = url;
    setMediaUrl(url);
    setMediaDuration(null);
    setMediaError('');

    const match = url.match(YOUTUBE_ID);
    if (!match) return;

    setReadingDuration(true);
    try {
      const duration = await getYouTubeDuration(match[1]);
      // Ignore a lookup that finished after the link was changed
      if (latestYouTubeUrl.current === url) setMediaDuration(duration);
    } catch (err) {
      console.warn('[YOUTUBE] Failed to read duration:', err.message);
      // YouTube won't let the screens play this video
      if (err.blocked && latestYouTubeUrl.current === url) setMediaError(err.message);
    } finally {
      if (latestYouTubeUrl.current === url) setReadingDuration(false);
    }
  }

  async function handleDelete(task) {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    await taskApi.remove(task._id);
    load();
  }

  if (loading) return <div className="page-loading">Loading tasks...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tasks</h1>
        {isAdmin && (
          <button
            type="button"
            className={showForm ? 'btn btn-ghost' : 'btn btn-primary'}
            onClick={() => {
              // Opening the form: start now, run for 10 minutes (both editable)
              if (!showForm && !start && !end) {
                const now = new Date();
                setStart(toDateTimeLocal(now));
                setEnd(toDateTimeLocal(new Date(now.getTime() + 10 * 60 * 1000)));
              }
              setShowForm((s) => !s);
            }}
          >
            {showForm ? 'Cancel' : '+ New Task'}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form className="card form-card task-form" onSubmit={handleSubmit}>
          <h3>New task</h3>
          {error && <div className="form-error">{error}</div>}

          <label htmlFor="task-title">Title</label>
          <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required />

          <label>What to show on the screens</label>
          <div className="segmented" role="radiogroup" aria-label="What to show">
            {[
              ['', '💬', 'Message'],
              ['image', '🖼', 'Image'],
              ['video', '🎬', 'Video'],
              ['youtube', '▶', 'YouTube'],
            ].map(([type, icon, label]) => (
              <button
                key={type || 'message'}
                type="button"
                role="radio"
                aria-checked={mediaType === type}
                className={`segmented-option ${mediaType === type ? 'is-selected' : ''}`}
                onClick={() => resetMedia(type)}
              >
                <span aria-hidden="true">{icon}</span> {label}
              </button>
            ))}
          </div>

          {mediaType === 'youtube' && (
            <>
              <label htmlFor="task-youtube">YouTube link</label>
              <input
                id="task-youtube"
                placeholder="https://www.youtube.com/watch?v=..."
                value={mediaUrl}
                onChange={(e) => onYouTubeUrlChange(e.target.value)}
                required
              />
              {mediaDuration && (
                <p className="form-hint">Video length: {formatLength(mediaDuration)}</p>
              )}
              {mediaError && <div className="form-error">{mediaError}</div>}
            </>
          )}

          {(mediaType === 'image' || mediaType === 'video') && (
            <>
              <label>{mediaType === 'image' ? 'Image' : 'Video'}</label>
              <div className="media-source">
                <select
                  value={mediaSource}
                  onChange={(e) => {
                    setMediaSource(e.target.value);
                    setMediaUrl('');
                    setMediaFile(null);
                    if (mediaType === 'video') readVideoLength(null);
                  }}
                >
                  <option value="url">Paste URL</option>
                  <option value="upload">Upload from device</option>
                </select>

                {mediaSource === 'upload' ? (
                  <input
                    type="file"
                    accept={mediaType === 'image' ? 'image/*' : 'video/*'}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setMediaFile(file);
                      if (mediaType === 'video') readVideoLength(file);
                    }}
                    required
                  />
                ) : (
                  <input
                    placeholder={`${mediaType === 'image' ? 'Image' : 'Video'} URL`}
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    // Read the length once the link is complete, not on every key
                    onBlur={() => {
                      const url = mediaUrl.trim();
                      if (mediaType === 'video' && url && url !== latestVideoSource.current) readVideoLength(url);
                    }}
                    required
                  />
                )}
              </div>
              {mediaType === 'video' && mediaDuration && (
                <p className="form-hint">Video length: {formatLength(mediaDuration)}</p>
              )}
            </>
          )}

          {isVideo && (
            <>
              <label>How long</label>
              <div className="chip-group" role="radiogroup" aria-label="How long">
                <label className={`chip ${playOnce ? 'is-selected' : ''}`}>
                  <input type="radio" name="task-length" checked={playOnce} onChange={() => setPlayOnce(true)} />
                  Play the video once
                </label>
                <label className={`chip ${!playOnce ? 'is-selected' : ''}`}>
                  <input type="radio" name="task-length" checked={!playOnce} onChange={() => setPlayOnce(false)} />
                  Until an end time (loops)
                </label>
              </div>
              <p className="form-hint">
                {playOnce
                  ? 'The task ends by itself when the video finishes — no end time needed.'
                  : 'The video repeats until the end time you choose.'}
              </p>
            </>
          )}

          <label htmlFor="task-content">
            {mediaType ? 'Caption (optional — shown under the media)' : 'Message'}
          </label>
          <textarea
            id="task-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required={!mediaType}
            placeholder={mediaType ? 'e.g. Safety briefing for all staff' : 'The text to show on the screens'}
          />

          <label>Priority</label>
          <PriorityPicker name="task-priority" value={priority} onChange={setPriority} />
          <p className="form-hint">
            Only the highest-priority task that is on shows on the screens. Alerts always come first.
          </p>

          <div className="form-row">
            <div>
              <label htmlFor="task-start">Start</label>
              <input
                id="task-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            {endsWithVideo ? (
              <div>
                <label>End</label>
                <div className="computed-field">
                  {mediaDuration
                    ? `When the video ends (${formatLength(mediaDuration)} after the start)`
                    : readingDuration
                      ? 'Reading the video length...'
                      : 'When the video ends'}
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="task-end">End</label>
                <input
                  id="task-end"
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
          {isVideo && (
            <p className="form-hint">A start time that has already passed means the video starts right away.</p>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting || readingDuration}>
            {submitting ? 'Creating...' : readingDuration ? 'Reading video length...' : 'Create Task'}
          </button>
        </form>
      )}

      <div className="task-grid">
        {tasks.length === 0 && <p className="empty-state">No tasks yet.</p>}
        {tasks.map((task) => (
          <TaskCard key={task.task_id} task={task} onDelete={isAdmin ? handleDelete : null} />
        ))}
      </div>
    </div>
  );
}
