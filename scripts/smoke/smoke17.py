# Templates on Home and brand colors
import json
from playwright.sync_api import sync_playwright
errs=[]
JS="""() => new Promise(r => {
  const q = indexedDB.open('canva-lite');
  q.onsuccess = () => { const g = q.result.transaction('designs').objectStore('designs').getAll();
    g.onsuccess = () => r(JSON.stringify(g.result.map(d => [d.title, d.pages[0].width, d.pages[0].height, d.pages[0].objects.length]))); }; })"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.click('[data-act="home"]'); pg.wait_for_timeout(2500)
    pg.fill('#brand-color','#ff00aa'); pg.dispatch_event('#brand-color','input'); pg.click('#brand-add'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/t1.png', full_page=False)
    print('templates', pg.locator('#tpl-grid .tpl').count(), 'brand swatches', pg.locator('#brand-manage button').count())
    pg.locator('#tpl-grid .tpl').nth(1).click(); pg.wait_for_timeout(2000)
    pg.screenshot(path='/tmp/claude-0/t2.png')
    print('saved', json.loads(pg.evaluate(JS)))
    pg.click('[data-tab="bg"]'); pg.wait_for_timeout(200)
    print('bg brand swatches', pg.locator('#bg-brand button').count())
    b.close()
print('errors',errs)
