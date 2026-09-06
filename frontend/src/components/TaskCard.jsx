import React from 'react';

const PRIORITY_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Emergency' };

export default function TaskCard({ task, onDelete }) {
  return (
    <div className={`card task-card priority-${task.priority}`}>
      <div className="card-header">
        <h3>{task.title}</h3>
        <span className={`badge badge-priority-${task.priority}`}>
          {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
      </div>
      <p className="task-content">{task.content}</p>
      <div className="task-schedule">
        <span>Start: {new Date(task.schedule.start).toLocaleString()}</span>
        <span>End: {new Date(task.schedule.end).toLocaleString()}</span>
      </div>
      {onDelete && (
        <div className="card-actions">
          <button type="button" className="btn btn-danger" onClick={() => onDelete(task)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
