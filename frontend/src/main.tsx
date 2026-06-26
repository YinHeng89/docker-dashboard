import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import LoginPage from './pages/Login'
import NotificationProvider from './components/NotificationProvider'
import './styles/index.css'
import './config/i18n'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  </React.StrictMode>,
)
