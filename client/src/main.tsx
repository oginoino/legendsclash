import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './store';
import { primeVisualAssets, type VisualAssetProgress } from './preload';
import './styles.css';

function updateBootProgress(progress: VisualAssetProgress): void {
  const root = document.getElementById('root');
  if (!root) return;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const label = root.querySelector<HTMLElement>('[data-boot-label]');
  const detail = root.querySelector<HTMLElement>('[data-boot-detail]');
  const bar = root.querySelector<HTMLElement>('[data-boot-bar]');
  if (label) label.textContent = progress.label;
  if (detail) detail.textContent = `${pct}% dos recursos essenciais`;
  if (bar) bar.style.width = `${pct}%`;
}

async function boot(): Promise<void> {
  // A reconexão de uma partida não pode esperar fontes e imagens. O estado
  // autoritativo chega em paralelo enquanto o loader prepara a apresentação.
  connect(); // retoma a sessão se houver token salvo
  await primeVisualAssets({ onProgress: updateBootProgress });

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
