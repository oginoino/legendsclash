import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './store';
import { primeVisualAssets } from './preload';
import './styles.css';

async function boot(): Promise<void> {
  await primeVisualAssets();
  connect(); // retoma a sessão se houver token salvo

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
