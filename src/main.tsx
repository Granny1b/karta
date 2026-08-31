import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@xyflow/react/dist/style.css';
import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Karta could not start: no #root element in the page');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
