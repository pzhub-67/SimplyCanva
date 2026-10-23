import json
from playwright.sync_api import sync_playwright
errs=[]
JS="""() => new Promise(r => {
  const q = indexedDB.open('canva-lite');
  q.onsuccess = () => { const g = q.result.transaction('designs').objectStore('designs').getAll();
    g.onsuccess = () => r(JSON.stringify(g.result[0].pages[0].objects.map(o => ({t:o.type,op:o.opacity,rx:o.rx,sh:o.shadow&&o.shadow.blur,fx:o.flipX})))); }; })"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="rect"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="style"]'); pg.wait_for_timeout(200)
    pg.fill('#st-op','60'); pg.dispatch_event('#st-op','input'); pg.dispatch_event('#st-op','change')
    pg.fill('#st-rad','50'); pg.dispatch_event('#st-rad','input'); pg.dispatch_event('#st-rad','change')
    pg.click('[data-shadow="Soft"]'); pg.click('[data-flip="x"]'); pg.wait_for_timeout(900)
    print(json.loads(pg.evaluate(JS)))
    pg.screenshot(path='/tmp/claude-0/st1.png')
    pg.click('[data-shadow="None"]'); pg.wait_for_timeout(900); print(json.loads(pg.evaluate(JS)))
    pg.click('[data-act="undo"]'); pg.wait_for_timeout(900); print('after undo', json.loads(pg.evaluate(JS)))
    b.close()
print('errors',errs)
