import React, { useEffect, useState, useCallback } from 'react';
import { userApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

const ROLE_INFO = {
  admin: 'Full control: playlists, tasks, alerts, playback and users',
  viewer: 'Can look at everything but not change anything',
};

// Prefer the specific validation message ("Password must be at least 6 characters")
function errorText(err, fallback) {
  const data = err.response?.data;
  return data?.errors?.[0] || data?.message || fallback;
}

const emptyForm = { name: '', email: '', password: '', role: 'viewer' };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text }
  const [resetFor, setResetFor] = useState(null); // user id whose password is being reset
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    const res = await userApi.list();
    setUsers(res.data.data.users);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function run(action, fallback) {
    setNotice(null);
    try {
      const res = await action();
      setNotice({ type: 'success', text: res.data.message });
      await load();
      return true;
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err, fallback) });
      return false;
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await userApi.create(form);
      setNotice({ type: 'success', text: res.data.message });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(errorText(err, 'Failed to add user'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(user, role) {
    await run(() => userApi.update(user.id, { role }), 'Failed to change role');
  }

  async function handleResetPassword(user) {
    const ok = await run(() => userApi.update(user.id, { password: newPassword }), 'Failed to reset password');
    if (ok) {
      setResetFor(null);
      setNewPassword('');
    }
  }

  async function handleRemove(user) {
    if (!window.confirm(`Remove ${user.name} (${user.email})? They will no longer be able to sign in.`)) return;
    await run(() => userApi.remove(user.id), 'Failed to remove user');
  }

  if (loading) return <div className="page-loading">Loading users...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Users</h1>
        <button
          type="button"
          className={showForm ? 'btn btn-ghost' : 'btn btn-primary'}
          onClick={() => {
            setShowForm((s) => !s);
            setForm(emptyForm);
            setFormError('');
          }}
        >
          {showForm ? 'Cancel' : '+ Add User'}
        </button>
      </div>
      <p className="section-hint">
        Only the people listed here can sign in to ScreenSync. There is no public sign-up.
      </p>

      {notice && (
        <div className={notice.type === 'error' ? 'form-error' : 'form-success'} role="status">
          {notice.text}
        </div>
      )}

      {showForm && (
        <form className="card form-card user-form" onSubmit={handleCreate}>
          <h3>Add a user</h3>
          {formError && <div className="form-error">{formError}</div>}

          <div className="form-row">
            <div>
              <label htmlFor="user-name">Name</label>
              <input id="user-name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
            </div>
            <div>
              <label htmlFor="user-email">Email</label>
              <input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                required
              />
            </div>
          </div>

          <label htmlFor="user-password">Password</label>
          <input
            id="user-password"
            type="password"
            minLength={6}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setField('password', e.target.value)}
            required
          />
          <p className="form-hint">At least 6 characters. Share it with the person so they can sign in.</p>

          <label>Role</label>
          <div className="chip-group" role="radiogroup" aria-label="Role">
            {Object.keys(ROLE_INFO).map((role) => (
              <label key={role} className={`chip ${form.role === role ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="user-role"
                  value={role}
                  checked={form.role === role}
                  onChange={() => setField('role', role)}
                />
                {role === 'admin' ? 'Admin' : 'Viewer'}
              </label>
            ))}
          </div>
          <p className="form-hint">{ROLE_INFO[form.role]}</p>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add User'}
          </button>
        </form>
      )}

      <table className="data-table users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Added</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isMe = me && String(user.id) === String(me.id);
            return (
              <tr key={user.id}>
                <td>
                  <span className="user-name">
                    <span className="user-avatar" aria-hidden="true">
                      {user.name.trim().charAt(0).toUpperCase()}
                    </span>
                    {user.name}
                    {isMe && <span className="status-pill">You</span>}
                  </span>
                </td>
                <td>{user.email}</td>
                <td>
                  <select
                    className="role-select"
                    value={user.role}
                    onChange={(e) => handleRoleChange(user, e.target.value)}
                    aria-label={`Role for ${user.name}`}
                    title={isMe ? "You can't change your own role" : ROLE_INFO[user.role]}
                    disabled={isMe}
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                <td>
                  {resetFor === user.id ? (
                    <form
                      className="user-reset"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleResetPassword(user);
                      }}
                    >
                      <input
                        type="password"
                        minLength={6}
                        autoComplete="new-password"
                        placeholder="New password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        autoFocus
                      />
                      <button type="submit" className="btn btn-primary btn-small">Save</button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => {
                          setResetFor(null);
                          setNewPassword('');
                        }}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="user-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => {
                          setResetFor(user.id);
                          setNewPassword('');
                        }}
                      >
                        Reset password
                      </button>
                      {!isMe && (
                        <button type="button" className="btn btn-danger btn-small" onClick={() => handleRemove(user)}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
