import React from 'react';

export default function PlaylistCard({ playlist, onEdit, onDelete, onBroadcast }) {
  return (
    <div className="card playlist-card">
      <div className="card-header">
        <h3>{playlist.name}</h3>
        {playlist.active && <span className="badge badge-active">Active</span>}
      </div>
      <ul className="playlist-items">
        {playlist.items.map((item, idx) => (
          <li key={item._id || idx}>
            <span className="item-index">{idx + 1}.</span>
            <span className="item-type">{item.media_type}</span>
            <span className="item-detail">
              {item.media_type === 'text' ? item.content : item.url}
            </span>
            <span className="item-duration">{item.duration}s</span>
          </li>
        ))}
      </ul>
      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={() => onBroadcast(playlist)}>
          Sync to TVs
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onEdit(playlist)}>
          Edit
        </button>
        <button type="button" className="btn btn-danger" onClick={() => onDelete(playlist)}>
          Delete
        </button>
      </div>
    </div>
  );
}
