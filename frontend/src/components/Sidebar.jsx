import React from 'react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/devices', label: 'Devices' },
];

export default function Sidebar() {
  return (
    <nav className="sidebar">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
