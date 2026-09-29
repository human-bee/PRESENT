import { createRoot } from 'react-dom/client';
import { AccessApp } from './access/bootstrap';
import './styles.css';
const root = document.getElementById('root');
if (root) createRoot(root).render(<AccessApp />);
