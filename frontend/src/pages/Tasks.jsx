import React, { useEffect, useState, useCallback } from 'react';
import { taskApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import TaskCard from '../components/TaskCard';
import PriorityPicker from '../components/PriorityPicker';

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
  const [submitting, setSubmitting] = useState(false);

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
      await taskApi.create({
        title,
        content,
        priority: Number(priority),
        schedule: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      });
      setTitle('');
      setContent('');
      setPriority(2);
      setStart('');
      setEnd('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
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

          <label htmlFor="task-content">Message</label>
          <textarea
            id="task-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            placeholder="The text to show on the screens"
          />

          <label>Priority</label>
          <PriorityPicker name="task-priority" value={priority} onChange={setPriority} />
          <p className="form-hint">
            Live tasks take turns in the strip at the bottom of the screens, highest priority first, while the
            playlist keeps playing. Each turn lasts: Emergency 50 s, High 40 s, Medium 30 s, Low 20 s.
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
          </div>
          <p className="form-hint">The message scrolls at the bottom of the screens from the start time until the end time.</p>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Task'}
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
