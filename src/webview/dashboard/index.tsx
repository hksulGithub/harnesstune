import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/dashboard.css';
import './styles/fleet.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
