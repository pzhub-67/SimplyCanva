import json
from playwright.sync_api import sync_playwright
errs=[]
JS="""() => new Promise(r => {
  const q = indexedDB.open('canva-lite');
  q.onsuccess = () => {
    const g = q.result.transaction('designs').objectStore('designs').getAll();
    g.onsuccess = () => r(JSON.stringify(g.result[0].pages[0].objects.map(o => ({t:o.type,l:Math.round(o.left),tp:Math.round(o.top),w:Math.round(o.width*o.scaleX),lk:o.locked||false,n:(o.objects||[]).length}))));
  };
})"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    box=pg.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
    cx,cy=box[0]+box[2]/2, box[1]+box[3]/2
    state=lambda: (pg.wait_for_timeout(900), json.loads(pg.evaluate(JS)))[1]
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="rect"]'); pg.wait_for_timeout(200)
    pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx-60,cy-60,steps=5); pg.mouse.up()
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="circle"]'); pg.wait_for_timeout(200); pg.wait_for_timeout(200)
    print('two objects', state())
    # align single (circle selected) left
    pg.click('[data-act="align"]'); pg.click('[data-align="l"]'); print('after align left', state())
    pg.wait_for_timeout(100)
    # lock circle, try to drag
    pg.click('#b-lock'); print('locked', state()[-1])
    pg.mouse.move(cx-100,cy+0); 
    # marquee select all
    pg.mouse.move(box[0]+6,box[1]+60); pg.mouse.down(); pg.mouse.move(box[0]+box[2]-6,box[1]+box[3]-60,steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
    print('group btn visible', pg.is_visible('#b-group'))
    pg.click('#b-group'); s=state(); print('grouped', s)
    print('btn label', pg.inner_text('#b-group'))
    pg.click('#b-group'); print('ungrouped', state())
    pg.screenshot(path='/tmp/claude-0/g1.png')
    b.close()
print('errors',errs)
