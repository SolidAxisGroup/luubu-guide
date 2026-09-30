import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'}); const p = await b.newPage({ viewport:{width:1400,height:820} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const L='zRK0moceMCOayumGoB8R', U=`http://localhost:8765/v2/location/${L}`;
await p.addInitScript(()=>{window.LUUBU_GUIDE_CONFIG={locations:['zRK0moceMCOayumGoB8R'],base:'http://localhost:8765/'}});
const boot=async u=>{await p.goto(u); await p.addScriptTag({url:'http://localhost:8765/src/guide.js'}); await p.waitForTimeout(1200);};
const sh = s => p.locator('#luubu-guide-root').locator(s);
await boot(U+'/funnels-websites/funnels');
await sh('.fab').click(); await p.waitForTimeout(1200);
console.log('here:', await sh('.sec').first().innerText(), '| hero:', await sh('.hero').count(), '| howtos here:', await sh('.list > .item').count());
await p.screenshot({path:'v2-1-onpage.png'});
await sh('[data-area=payments]').click(); await p.waitForTimeout(300);
console.log('payments open items:', await sh('.sub .item').count()); await p.screenshot({path:'v2-2-browse.png'});
await sh('input').fill('send invoice'); await p.waitForTimeout(300);
console.log('search top3:', (await sh('.item b').allInnerTexts()).slice(0,3));
await sh('input').fill('');
await sh('.hero').click(); await p.waitForTimeout(1500);
console.log('page tour card:', await sh('.card h4').innerText());
// go through steps quickly timing coach
for (let i=0;i<3;i++){ const t0=Date.now(); await sh('.card [data-a=next]').click(); await p.waitForFunction(()=>{const r=document.getElementById('luubu-guide-root').shadowRoot.querySelector('.card .hint .wait');return !r},null,{timeout:15000}).catch(()=>{}); console.log(' step', await sh('.card .n').innerText(), '|', await sh('.card h4').innerText(), '|', Date.now()-t0,'ms', '| spot', await sh('.spot').count()); }
await p.screenshot({path:'v2-3-step.png'});
await sh('.card .x').click();
await boot(U+'/dashboard'); await sh('.fab').click(); await p.waitForTimeout(1000);
console.log('dashboard first sec:', await sh('.sec').first().innerText());
await boot(U+'/settings/phone_system'); await sh('.fab').click(); await p.waitForTimeout(1000);
console.log('settings phone sec:', await sh('.sec').first().innerText(), '| hero:', await sh('.hero').count());
console.log('errors', errs); await b.close();
