# Gradient fill: apply, persist, reload, back to solid
import json
from playwright.sync_api import sync_playwright
errs=[]
JS="""() => new Promise(r => {
  const q = indexedDB.open('canva-lite');
  q.onsuccess = () => { const g = q.result.transaction('designs').objectStore('designs').getAll();
    g.onsuccess = () => r(JSON.stringify(g.result[0].pages[0].objects.map(o => typeof o.fill === 'string' ? o.fill : (o.fill.colorStops||[]).map(s=>s.color)))); }; })"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    st=lambda: (pg.wait_for_timeout(900), json.loads(pg.evaluate(JS)))[1]
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="rect"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="style"]'); pg.click('[data-fill="Ocean"]'); print('ocean', st())
    pg.screenshot(path='/tmp/claude-0/gr1.png')
    pg.reload(); pg.wait_for_timeout(1500); print('after reload', st())
    pg.mouse.click(300,400); pg.wait_for_timeout(200)
    b.close()
print('errors',errs)
