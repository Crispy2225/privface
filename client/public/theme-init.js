// Resolve before the stylesheet paints to avoid a light flash on a dark page.
(() => {
  let preference = null
  try { preference = localStorage.getItem('privface-theme') } catch { /* Storage is optional. */ }
  const theme = preference === 'light' || preference === 'dark'
    ? preference
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0d10' : '#fbfbfd')
})()
