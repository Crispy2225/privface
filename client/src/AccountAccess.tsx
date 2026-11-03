import { useEffect, useRef, useState } from 'react'
import { api, authorizeBinding, recoverAccount, securityAction } from './account-api'
import type { AccountSession } from './account-api'
import { getEnrollment } from './enrollment-store'
import { prepareProofBinding, proofConfig } from './proof-client'
import { prepareBinding } from './template-binding'

export default function AccountAccess({session,onSession}:{session:AccountSession|null;onSession:(value:AccountSession|null)=>void}){
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[recovery,setRecovery]=useState('')
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[disable,setDisable]=useState(false)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>{const hide=()=>{if(document.hidden){setCode('');setPassword('');setConfirm('')}};document.addEventListener('visibilitychange',hide);return()=>{active.current?.abort();document.removeEventListener('visibilitychange',hide)}},[])
  async function run(action:string){
    if(active.current)return
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');setCode('')
    try{
      if(action==='recover'){
        if(password!==confirm)throw new Error('Passwords do not match.')
        if(password.length<12||password.length>128)throw new Error('Use a password with 12–128 characters.')
        const restored=await recoverAccount(recovery.trim(),password,controller.signal)
        onSession(restored);setRecovery('');setMessage('Password reset. Set up or bind your face enrollment again.')
      }else if(session){
        if(action==='logout'){await api('/logout',{},session.csrf,controller.signal);onSession(null);setMessage('Signed out.')}
        else if(action==='bind'){
          if(session.enrollment?.scheme==='privface-zkml-demo-v1')throw new Error('Manage this enrollment on the Face login page. The older template cannot refresh it.')
          const record=await getEnrollment(session.account.username)
          if(!record)throw new Error('Capture and save your face first.')
          const config=await proofConfig(controller.signal)
          const binding=await (config.enabled?prepareProofBinding:prepareBinding)(session.account.id,record,controller.signal)
          await authorizeBinding(binding,session.csrf,controller.signal)
          onSession(await api<AccountSession>('/session',undefined,undefined,controller.signal));setMessage('Face enrollment linked to your account.')
        }else{
          if(!password)throw new Error('Enter your current password to confirm this action.')
          if(action==='disable-account'&&!disable)throw new Error('Confirm account disablement first.')
          const result=await securityAction(action,password,session.csrf,controller.signal)
          setCode(result.recovery_code??'')
          if(action==='logout-all'||action==='disable-account')onSession(null)
          else onSession(await api<AccountSession>('/session',undefined,undefined,controller.signal))
          setMessage(action==='recovery-code'?'Save this recovery code offline. It is shown only once.':action==='revoke-binding'?'Face binding removed. Your local template remains on this browser.':'All sessions ended.')
          setDisable(false)
        }
      }
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Request failed.')}
    finally{setPassword('');setConfirm('');if(active.current===controller){active.current=null;setBusy(false)}}
  }
  return <section className="account-access" aria-label="Account controls">
    {session?<>
      <p>Signed in as <strong>@{session.account.username}</strong>.</p>
      {session.descriptor_proof&&<p>Private face-descriptor comparison verified.</p>}
      <button className="text-button" disabled={busy} onClick={()=>void run('logout')}>Sign out</button>
      <details key="security"><summary>Account security</summary>
        {session.enrollment?.scheme==='privface-zkml-demo-v1'?<a href="/face-login.html?mode=enroll">Manage face enrollment</a>:<button className="secondary-button" disabled={busy} onClick={()=>void run('bind')}>Link or refresh saved face enrollment</button>}
        <label className="field">Current password<input type="password" autoComplete="current-password" value={password} maxLength={128} onChange={e=>setPassword(e.target.value)} /></label>
        <button className="secondary-button" disabled={busy||!password} onClick={()=>void run('recovery-code')}>Generate recovery code</button>
        {code&&<div role="status"><p>Keep this code private. It can reset your password.</p><code style={{overflowWrap:'anywhere'}}>{code}</code><button className="text-button" onClick={()=>setCode('')}>Hide code</button></div>}
        <button className="secondary-button" disabled={busy||!password} onClick={()=>void run('revoke-binding')}>Remove face binding</button>
        <button className="secondary-button" disabled={busy||!password} onClick={()=>void run('logout-all')}>Sign out all devices</button>
        <label className="consent"><input type="checkbox" checked={disable} onChange={e=>setDisable(e.target.checked)} />I understand disabling my account prevents login and recovery.</label>
        <button className="secondary-button" disabled={busy||!password||!disable} onClick={()=>void run('disable-account')}>Disable account</button>
      </details>
    </>:<details key="recovery"><summary>Forgot your password?</summary>
      <p>Use a previously saved recovery code to choose a new password. Without a recovery code, contact the project operator.</p>
      <label className="field">Recovery code<input type="password" autoComplete="off" value={recovery} onChange={e=>setRecovery(e.target.value)} /></label>
      <label className="field">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} /></label>
      <label className="field">Confirm new password<input type="password" autoComplete="new-password" maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} /></label>
      <button className="secondary-button" disabled={busy||!recovery||password.length<12||password!==confirm} onClick={()=>void run('recover')}>Reset password</button>
    </details>}
    {message&&<p role="status">{message}</p>}
  </section>
}
