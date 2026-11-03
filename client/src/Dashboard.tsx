import { useEffect, useRef, useState } from 'react'
import type { AccountSession } from './account-api'
import { api } from './account-api'
import ThemeToggle from './ThemeToggle'
import './dashboard.css'

const transactions = [
  { name: 'Corner Coffee', category: 'Food & drinks', date: '03 Nov 2026', amount: -680, icon: 'C' },
  { name: 'Studio Supply', category: 'Shopping', date: '02 Nov 2026', amount: -2450, icon: 'S' },
  { name: 'Cloud Workspace', category: 'Subscription', date: '01 Nov 2026', amount: -1499, icon: 'W' },
  { name: 'Fresh Basket', category: 'Groceries', date: '31 Oct 2026', amount: -1299, icon: 'F' },
  { name: 'Acme Studio', category: 'Sample salary', date: '30 Oct 2026', amount: 85000, icon: 'A' },
]
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value)
const income = transactions.reduce((sum, tx) => sum + Math.max(0, tx.amount), 0)
const spent = transactions.reduce((sum, tx) => sum + Math.max(0, -tx.amount), 0)
const balance = 105578.75 + income - spent

export default function Dashboard() {
  const [session, setSession] = useState<AccountSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    let controller: AbortController | null = null
    let disposed = false
    const check = async () => {
      controller?.abort()
      const current = new AbortController(); controller = current
      setLoading(true); setSession(null); setError('')
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: current.signal })
        if (response.status === 401) { window.location.replace('/face-login.html'); return }
        if (!response.ok) throw Error('Your session could not be checked. Please retry.')
        const value = await response.json() as AccountSession
        if (!value.account?.username || !value.csrf) throw Error('Your session could not be checked. Please sign in again.')
        if (!disposed && !current.signal.aborted) setSession(value)
      } catch (err) {
        if (!disposed && !current.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to check your session.')
      } finally { if (!disposed && !current.signal.aborted) setLoading(false) }
    }
    refresh.current = () => { void check() }
    const visibility = () => { if (document.hidden) { controller?.abort(); setSession(null); setLoading(true) } else void check() }
    const pageShow = () => { void check() }
    void check()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pageshow', pageShow)
    return () => { disposed = true; controller?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pageshow', pageShow) }
  }, [])
  async function signOut() {
    if (!session || busy) return
    setBusy(true); setError('')
    try { await api('/logout', {}, session.csrf); setSession(null); window.location.replace('/face-login.html') }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign out failed. Please retry.'); setBusy(false) }
  }
  if (!session) return <main className="dash-loading"><a className="brand" href="/face-login.html">privface<span className="brand-period">.</span></a><h1>{loading ? 'Checking your session…' : 'Unable to open dashboard'}</h1>{error && <p role="alert">{error}</p>}{!loading && <><button className="primary-button" onClick={() => refresh.current()}>Retry</button><a href="/face-login.html">Back to sign in</a></>}</main>
  const face = session.authentication === 'face-proof-demo'
  return <div className="bank-shell">
    <header className="bank-header"><a className="brand" href="/dashboard">privface<span className="brand-period">.</span><span className="bank-word"> / sandbox</span></a><div className="bank-header-actions"><ThemeToggle /><span className="bank-avatar" aria-hidden="true">{session.account.username.slice(0, 1).toUpperCase()}</span><button className="bank-signout" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out ↗'}</button></div></header>
    <div className="bank-body">
      <aside className="bank-sidebar"><span className="bank-eyebrow">YOUR SPACE</span><nav aria-label="Dashboard navigation"><a href="#overview" aria-current="page">◫ <span>Overview</span></a><a href="#activity">↗ <span>Transactions</span></a><a href="/">⚙ <span>Account settings</span></a></nav><div className="bank-sidebar-note"><span aria-hidden="true">◇</span><strong>A private way in.</strong><p>Your account session is real. The banking data is fictional.</p></div></aside>
      <main className="bank-main" id="overview">
        <div className="bank-welcome"><div><span className="bank-eyebrow">YOUR PERSONAL OVERVIEW</span><h1>Welcome, {session.account.username}!</h1><p>You’re in. Here’s a little snapshot of your demo finances.</p></div><span className="bank-demo-badge">DEMO DATA</span></div>
        <p className="bank-notice">Illustrative dashboard · All balances, accounts, and transactions below are fictional. No real bank is connected.</p>
        {error && <p role="alert" className="camera-error">{error}</p>}
        <div className="bank-grid">
          <section className="bank-balance" aria-label="Demo account balance"><div className="bank-card-top"><span>Available balance</span><span>INR · DEMO</span></div><strong>{money(balance)}</strong><p>Everyday account <span>•••• 2048</span></p><div className="bank-card-bottom"><span>PRIVFACE SANDBOX</span><span aria-hidden="true">◉</span></div></section>
          <section className="bank-session"><div className="bank-check" aria-hidden="true">✓</div><span className="bank-eyebrow">SESSION CONFIRMED</span><h2>{face ? 'Signed in with your face.' : 'Signed in with your password.'}</h2><p>{face ? 'The server verified your face proof before granting access to this dashboard.' : 'Your password was verified by the server before granting access to this dashboard.'}</p><span className="bank-session-tag">{face ? 'Face proof accepted' : 'Password login accepted'}</span></section>
        </div>
        <div className="bank-stats"><section><span>Sample income</span><strong>{money(income)}</strong><small>30 Oct – 03 Nov 2026</small></section><section><span>Sample spending</span><strong>{money(spent)}</strong><small>Across {transactions.length - 1} sample purchases</small></section><section><span>Travel fund</span><strong>₹72,000 <small>/ ₹1,00,000</small></strong><progress value="72000" max="100000" aria-label="Fictional travel fund: 72 percent"/><small>Illustrative savings goal · 72%</small></section></div>
        <section className="bank-activity" id="activity"><div className="bank-section-title"><div><h2>Recent activity</h2><p>A few sample transactions to bring your account to life.</p></div><span>5 transactions</span></div><div className="bank-table-wrap"><table><caption className="bank-sr-only">Fictional transaction history</caption><thead><tr><th scope="col">Transaction</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>{transactions.map(tx => <tr key={tx.name}><td><div className="bank-merchant"><span className="bank-merchant-icon" aria-hidden="true">{tx.icon}</span><div><strong>{tx.name}</strong><small>{tx.category}<span className="bank-mobile-date"> · {tx.date}</span></small></div></div></td><td>{tx.date}</td><td><span className="bank-tx-status">Completed</span></td><td className={tx.amount > 0 ? 'bank-credit' : ''}>{tx.amount > 0 ? '+' : '−'}{money(Math.abs(tx.amount))}</td></tr>)}</tbody></table></div></section>
        <footer className="bank-footer"><span>PrivFace · Authentication demonstration</span><span>Sample financial snapshot · 03 Nov 2026</span></footer>
      </main>
    </div>
  </div>
}
