# Multi-page, JPG export, export all, sheet auto-pan, persistence
import json
from playwright.sync_api import sync_playwright
errs=[]
JS="""() => new Promise(r => {
  const q = indexedDB.open('canva-lite');
  q.onsuccess = () => { const g = q.result.transaction('designs').objectStore('designs').getAll();
    g.onsuccess = () => r(JSON.stringify(g.result[0].pages.map(p => p.objects.map(o => o.type)))); }; })"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    st=lambda: (pg.wait_for_timeout(900), json.loads(pg.evaluate(JS)))[1]
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="rect"]'); pg.wait_for_timeout(300)
    # style sheet should pan the page so the selected rect stays visible
    pg.click('[data-act="style"]'); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/claude-0/m0.png')
    pg.click('[data-act="closeSheet"]'); pg.wait_for_timeout(300)
    print('zoom label after closing sheet', pg.inner_text('#zoom-fit'))
    pg.click('#pager'); pg.click('[data-act="addPage"]'); pg.wait_for_timeout(900)
    print('pager', pg.inner_text('#pager'))
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="circle"]'); pg.wait_for_timeout(300)
    pg.click('#pager'); pg.wait_for_timeout(900)
    pg.screenshot(path='/tmp/claude-0/m1.png')
    pg.locator('#page-strip .chip').nth(0).click(); pg.wait_for_timeout(900)
    print('back on', pg.inner_text('#pager'), st())
    pg.click('[data-act="export"]'); pg.wait_for_timeout(500)
    pg.click('[data-fmt="jpeg"]'); pg.wait_for_timeout(300)
    print('jpg src', pg.evaluate("document.getElementById('export-img').src.slice(0,22)"))
    pg.click('#export-all'); pg.wait_for_timeout(1500)
    print('export-all images', pg.locator('#export-more img').count())
    pg.screenshot(path='/tmp/claude-0/m2.png')
    pg.reload(); pg.wait_for_timeout(1500)
    print('after reload', pg.inner_text('#pager'))
    b.close()
print('errors',errs)
