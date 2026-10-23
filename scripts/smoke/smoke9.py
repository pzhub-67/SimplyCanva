from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.click('[data-tab="shapes"]'); pg.click('[data-add]'); pg.wait_for_timeout(300)
    box=pg.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
    cx,cy=box[0]+box[2]/2, box[1]+box[3]/2
    pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx+10,cy+3,steps=4)
    pg.screenshot(path='/tmp/claude-0/s1.png')
    pg.mouse.up(); pg.wait_for_timeout(300)
    b.close()
print('errors',errs)
