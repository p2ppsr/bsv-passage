import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')!

if (window.top !== window.self) {
  rootElement.className = 'frame-refusal'
  rootElement.textContent = 'BSV Passage will not handle recovery material inside an embedded frame. Open the verified application directly.'
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
