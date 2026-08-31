import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'jStudio',
  description: 'AI pair programmer and animation pipeline for Roblox Studio',
}

const firstPaint = `html{background:#0b0b0f}html[data-theme='light']{background:#f6f6f8}`

const themeBoot = `(function(){var t='dark';try{var s=localStorage.getItem('jstudio.theme');var v=s?JSON.parse(s):null;if(v==='light'||v==='dark'){t=v}else if(window.matchMedia('(prefers-color-scheme: light)').matches){t='light'}}catch(e){}var r=document.documentElement;r.dataset.theme=t;r.style.background=t==='light'?'#f6f6f8':'#0b0b0f'})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: firstPaint }} />
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
