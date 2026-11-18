import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from '@/components/ui/tooltip'

const root = document.getElementById('root')
if (!root) {
  throw new Error('index.html 缺少 #root')
}

createRoot(root).render(
  <StrictMode>
    {/* 屬性面板參數的 ⓘ 用 Radix 的 Tooltip，需要共用的 Provider */}
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
