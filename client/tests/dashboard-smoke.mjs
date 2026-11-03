import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
const origin=process.env.M4_TEST_ORIGIN||'http://localhost:5173'
try {
 for(const phone of [false,true]) {
  const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1080},colorScheme:phone?'dark':'light'})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  let session=true,unavailable=false,method='face-proof-demo'
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname
   if(path==='/api/session') return route.fulfill({status:unavailable?503:session?200:401,contentType:'application/json',body:JSON.stringify(unavailable?{detail:'Unavailable'}:session?{account:{id:'demo',username:'demo_user',display_name:'Demo user'},csrf:'test-csrf',authentication:method}:{detail:'Sign in first'})})
   if(path==='/api/logout') {assert.equal(route.request().headers()['x-csrf-token'],'test-csrf');session=false;return route.fulfill({json:{ok:true}})}
   throw Error('Unexpected API call '+path)
  })
  await page.goto(origin+'/dashboard?username=wrong_user')
  await page.getByRole('heading',{name:'Welcome, demo_user!'}).waitFor()
  await page.getByText('Face proof accepted',{exact:true}).waitFor()
  assert.equal(await page.getByRole('table').count(),1)
  assert.equal(await page.locator('tbody tr').count(),5)
  const amountBox=await page.locator('tbody tr').first().locator('td').last().boundingBox()
  assert.ok(amountBox && amountBox.x + amountBox.width <= (phone?390:1440), 'Amounts must be visible without horizontal scrolling')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.ok((await page.locator('.bank-notice').textContent()).includes('fictional'))
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/'+(phone?'dashboard-phone':'dashboard-desktop')+'.png',fullPage:true})
  method='password';await page.reload();await page.getByText('Password login accepted',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Sign out ↗'}).click();await page.waitForURL('**/face-login.html')
  await page.goto(origin+'/dashboard');await page.waitForURL('**/face-login.html')
  assert.equal(await page.locator('.bank-balance').count(),0)
  unavailable=true;await page.goto(origin+'/dashboard');await page.getByRole('heading',{name:'Unable to open dashboard'}).waitFor()
  assert.equal(await page.locator('.bank-balance').count(),0)
  unavailable=false;session=true;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'Welcome, demo_user!'}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: '+(phone?'mobile dark':'desktop light')+' dashboard, server username, auth method, logout, unauthorized access, server failure and retry')
  await context.close()
 }
}finally{await browser.close()}
