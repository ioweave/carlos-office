import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.scss';
import './chat.scss';
import './workspace.scss';
import './refinements.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
