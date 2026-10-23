import React from 'react';
import {createRoot} from 'react-dom/client';
import FinanceApp from '../components/finance-app';
import '../app/globals.css';
import '../app/finance.css';
import '../app/connections.css';
import '../app/refined.css';
createRoot(document.getElementById('root')!).render(<FinanceApp/>);
