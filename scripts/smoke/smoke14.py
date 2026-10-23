# One-finger pan when zoomed, page reorder
import json, hashlib
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
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="rect"]'); pg.wait_for_timeout(300)
    pg.mouse.click(30, 300)  # deselect (empty stage)
    for _ in range(3): pg.click('#zoom-in')
    pg.wait_for_timeout(300)
    shot=lambda: hashlib.md5(pg.screenshot(clip={'x':0,'y':120,'width':390,'height':600})).hexdigest()
    s=ctx.new_cdp_session(pg)
    t=lambda k,pts: s.send('Input.dispatchTouchEvent',{'type':k,'touchPoints':[{'x':x,'y':y} for x,y in pts]})
    before=shot()
    t('touchStart',[(60,200)])
    for k in range(1,8): t('touchMove',[(60+k*8,200+k*6)])
    t('touchEnd',[]); pg.wait_for_timeout(300)
    print('panned (screen changed):', shot()!=before)
    pg.click('#zoom-fit'); pg.wait_for_timeout(200)
    pg.click('#pager'); pg.click('[data-act="addPage"]'); pg.wait_for_timeout(900)
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="circle"]'); pg.wait_for_timeout(300)
    pg.click('#pager'); pg.click('[data-act="pageLeft"]'); pg.wait_for_timeout(1000)
    print('pager', pg.inner_text('#pager'), json.loads(pg.evaluate(JS)))
    b.close()
print('errors',errs)
