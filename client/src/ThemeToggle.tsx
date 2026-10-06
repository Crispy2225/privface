import { useEffect, useRef, useState } from 'react'

type Theme = 'light' | 'dark'
const storageKey = 'privface-theme'

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' ? value : null
  } catch { return null }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0d10' : '#fbfbfd')
}

export default function ThemeToggle() {
  const preference = useRef<Theme | null>(savedTheme())
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function sync() {
      const next = preference.current ?? (media.matches ? 'dark' : 'light')
      applyTheme(next)
      setTheme(next)
    }
    function onStorage(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) { preference.current = savedTheme(); sync() }
    }
    sync()
    media.addEventListener('change', sync)
    window.addEventListener('storage', onStorage)
    return () => { media.removeEventListener('change', sync); window.removeEventListener('storage', onStorage) }
  }, [])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    preference.current = next
    applyTheme(next)
    setTheme(next)
    try { localStorage.setItem(storageKey, next) } catch { /* Still works when browser storage is disabled. */ }
  }

  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'light' ? <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
    </svg>
    <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
  </button>
}
