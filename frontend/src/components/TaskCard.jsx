import React from 'react';
import { PRIORITY_LABELS } from './AlertBanner';
import { YOUTUBE_ID } from '../utils/media';

const MEDIA_LABELS = { image: '🖼 Image', video: '🎬 Video', youtube: '▶ YouTube' };

// Live now / Scheduled / Ended, from the task's time window
function taskStatus(task) {
  const now = new Date();
  if (new Date(task.schedule.end) < now) return { key: 'ended', label: 'Ended' };
  if (new Date(task.schedule.start) > now) return { key: 'scheduled', label: 'Scheduled' };
  return { key: 'live', label: 'Live now' };
}

// Small preview of the task's media (YouTube thumbnail, the image itself, or a video tile)
function MediaPreview({ media }) {
  if (media.media_type === 'youtube') {
    const match = media.url.match(YOUTUBE_ID);
    if (match) {
      return <img className="task-media-thumb" src={`https://i.ytimg.com/vi/${match[1]}/mqdefault.jpg`} alt="" loading="lazy" />;
    }
  }
  if (media.media_type === 'image') {
    return <img className="task-media-thumb" src={media.url} alt="" loading="lazy" />;
  }
  return <div className="task-media-thumb task-media-tile" aria-hidden="true">🎬</div>;
}

export default function TaskCard({ task, onDelete }) {
  const status = taskStatus(task);
  const hasMedia = task.media && task.media.url;

  return (
    <div className={`card task-card priority-${task.priority} is-${status.key}`}>
      <div className="card-header">
        <h3>{task.title}</h3>
        <span className={`badge badge-priority-${task.priority}`}>
          {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
      </div>

      <span className={`status-pill is-${status.key}`}>{status.label}</span>

      {hasMedia && (
        <a className="task-media" href={task.media.url} target="_blank" rel="noreferrer" title={task.media.url}>
          <MediaPreview media={task.media} />
          <span className="task-media-label">{MEDIA_LABELS[task.media.media_type] || 'Media'}</span>
        </a>
      )}

      {task.content && <p className="task-content">{task.content}</p>}

      <div className="task-schedule">
        <span>Start: {new Date(task.schedule.start).toLocaleString()}</span>
        <span>End: {new Date(task.schedule.end).toLocaleString()}</span>
      </div>
      {onDelete && (
        <div className="card-actions">
          <button type="button" className="btn btn-danger btn-small" onClick={() => onDelete(task)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
