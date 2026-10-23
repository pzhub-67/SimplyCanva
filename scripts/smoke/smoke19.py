# Local profiles: add with passcode, separate data, lock, wrong/right passcode, backup + restore, delete
import json
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    def cards():
        pg.click('[data-act="home"]'); pg.wait_for_timeout(900); n=pg.locator('.dcard').count(); return n
    pg.click('[data-tab="shapes"]'); pg.click('#shape-grid [data-add="rect"]'); pg.wait_for_timeout(900)
    print('Me designs', cards(), 'profile btn:', pg.inner_text('#acct-btn'))
    pg.click('#acct-btn'); pg.fill('#acct-name','Work'); pg.fill('#acct-pass','passcode-1234'); pg.click('#acct-add'); pg.wait_for_timeout(2000)
    print('new protected profile asks for passcode', pg.is_visible('#lock'))
    pg.fill('#lock-pass','passcode-1234'); pg.click('#lock-go'); pg.wait_for_timeout(2500)
    pg.click('[data-tab="shapes"]'); pg.click('#shape-grid [data-add="circle"]'); pg.wait_for_timeout(900)
    print('Work designs', cards(), 'profile btn:', pg.inner_text('#acct-btn'))
    enc=pg.evaluate('''() => new Promise(r => { const q = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]); q.then(l => { const n = l.map(d => d.name).find(x => x.startsWith('canva-lite-')); const o = indexedDB.open(n); o.onsuccess = () => { const g = o.result.transaction('designs').objectStore('designs').getAll(); g.onsuccess = () => r(g.result.map(x => !!x.enc && !x.pages)); }; }); })''')
    print('Work records encrypted at rest', enc)
    pg.click('#acct-btn'); pg.screenshot(path='/tmp/claude-0/ac1.png'); pg.click('#acct-lock'); pg.wait_for_timeout(1500)
    print('locked overlay visible', pg.is_visible('#lock'))
    pg.fill('#lock-pass','nope'); pg.click('#lock-go'); pg.wait_for_timeout(800); print('error shown', pg.is_visible('#lock-err')); pg.wait_for_timeout(2500)
    pg.screenshot(path='/tmp/claude-0/ac2.png')
    pg.fill('#lock-pass','passcode-1234'); pg.click('#lock-go'); pg.wait_for_timeout(1500); print('unlocked, lock hidden', not pg.is_visible('#lock'))
    pg.click('[data-act="home"]'); pg.click('#acct-btn'); pg.locator('#acct-list .opt').nth(0).click(); pg.wait_for_timeout(2000)
    print('back in Me designs', cards(), pg.inner_text('#acct-btn'))
    # backup of Me
    pg.click('#acct-btn'); pg.click('#acct-backup'); pg.wait_for_timeout(1000)
    data=pg.evaluate("fetch(document.getElementById('acct-dl').href).then(r=>r.text())")
    d=json.loads(data); print('backup designs', len(d['designs']), d['app'])
    open('/tmp/claude-0/backup.json','w').write(data)
    # restore into Work (switch, unlock already flagged in session)
    pg.locator('#acct-list .opt').nth(1).click(); pg.wait_for_timeout(2000)
    print('switch asks passcode', pg.is_visible('#lock'))
    if pg.is_visible('#lock'):
        pg.fill('#lock-pass','passcode-1234'); pg.click('#lock-go'); pg.wait_for_timeout(2500)
        pg.screenshot(path='/tmp/claude-0/ac3.png'); print('lock err', pg.is_visible('#lock-err'), pg.inner_text('#lock-err'))
    pg.click('[data-act="home"]'); pg.click('#acct-btn')
    pg.set_input_files('#acct-restore', files=['/tmp/claude-0/backup.json']); pg.wait_for_timeout(2500)
    print('restore returns to Home', pg.is_visible('#home'), 'Work after restore', pg.locator('.dcard').count())
    # delete Work
    pg.click('#acct-btn'); pg.click('#acct-del'); pg.click('#acct-del'); pg.wait_for_timeout(2500)
    pg.click('[data-act="home"]'); pg.click('#acct-btn'); print('profiles left', pg.locator('#acct-list .opt').count(), pg.inner_text('#acct-btn'))
    b.close()
print('errors',errs)
