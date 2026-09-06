import React, { useEffect, useState, useCallback } from 'react';
import { taskApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import TaskCard from '../components/TaskCard';

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
      setError(err.response?.data?.message || 'Failed to create task');
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
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New Task'}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          <label htmlFor="task-title">Title</label>
          <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required />

          <label htmlFor="task-content">Content</label>
          <textarea id="task-content" value={content} onChange={(e) => setContent(e.target.value)} required />

          <label htmlFor="task-priority">Priority</label>
          <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
            <option value={4}>Emergency</option>
          </select>

          <label htmlFor="task-start">Start Time</label>
          <input
            id="task-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />

          <label htmlFor="task-end">End Time</label>
          <input
            id="task-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />

          <button type="submit" className="btn btn-primary">
            Create Task
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
