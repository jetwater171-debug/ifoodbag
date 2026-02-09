import React from 'react';
import { createRoot } from 'react-dom/client';
import '/style.css';
import '/script.js';
import Page from '../pages/admin-pages';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Page />);
}
