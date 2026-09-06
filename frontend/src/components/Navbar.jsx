import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="navbar">
      <div className="navbar-brand">ScreenSync</div>
      <div className="navbar-user">
        <span className="navbar-user-name">{user?.name}</span>
        <span className="navbar-user-role">{user?.role}</span>
        <button type="button" className="btn btn-ghost" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}
