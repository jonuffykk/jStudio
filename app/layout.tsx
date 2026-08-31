import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'jStudio',
  description: 'AI pair programmer and animation pipeline for Roblox Studio',
}

const firstPaint = `html{background:#f6f6f8}html[data-theme='dark']{background:#0b0b0f}`

const themeBoot = `(function(){var t='light';try{var s=localStorage.getItem('jstudio.theme');var v=s?JSON.parse(s):null;if(v==='light'||v==='dark'){t=v}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){t='dark'}}catch(e){}var r=document.documentElement;r.dataset.theme=t;r.style.background=t==='light'?'#f6f6f8':'#0b0b0f'})()`

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
