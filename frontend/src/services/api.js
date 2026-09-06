import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('screensync_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('screensync_token');
      localStorage.removeItem('screensync_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (payload) => api.post('/auth/register', payload),
  me: () => api.get('/auth/me'),
};

export const playlistApi = {
  list: () => api.get('/getPlaylists'),
  get: (id) => api.get(`/getPlaylist/${id}`),
  create: (payload) => api.post('/createPlaylist', payload),
  update: (id, payload) => api.put(`/updatePlaylist/${id}`, payload),
  remove: (id) => api.delete(`/deletePlaylist/${id}`),
  broadcast: (id) => api.post(`/broadcastPlaylist/${id}`),
  uploadMedia: (file) => {
  const formData = new FormData();
  formData.append('file', file);

  return api.post('/uploadMedia', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
},
};

export const taskApi = {
  listActive: () => api.get('/getTasks'),
  listAll: () => api.get('/getAllTasks'),
  create: (payload) => api.post('/createTask', payload),
  remove: (id) => api.delete(`/deleteTask/${id}`),
};

export const alertApi = {
  listActive: () => api.get('/getAlerts'),
  listAll: () => api.get('/getAllAlerts'),
  push: (payload) => api.post('/pushAlert', payload),
  clear: (id) => api.post(`/clearAlert/${id}`),
};

export const deviceApi = {
  list: () => api.get('/getDevices'),
};

export default api;
