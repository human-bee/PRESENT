import { createRoot } from 'react-dom/client';
import { App } from './app';
import { Playbook } from './playbook/playbook';
import './styles.css';
const root = document.getElementById('root');
if (root) createRoot(root).render(location.pathname === '/playbook' ? <Playbook /> : <App />);
