from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    box=pg.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
    cx,cy=box[0]+box[2]/2, box[1]+box[3]/2
    pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx+60,cy+120,steps=8); pg.mouse.move(cx+170,cy+260,steps=8); pg.mouse.up(); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/claude-0/o1.png')   # selected, partly outside
    pg.mouse.click(box[0]+20, box[1]+30); pg.wait_for_timeout(400)  # deselect
    pg.screenshot(path='/tmp/claude-0/o2.png')
    pg.click('[data-act="export"]'); pg.wait_for_timeout(600)
    print('export size', pg.evaluate("(()=>{const i=document.getElementById('export-img');return [i.naturalWidth,i.naturalHeight]})()"))
    pg.screenshot(path='/tmp/claude-0/o3.png')
    pg.click('[data-act="closeExport"]')
    pg.click('#zoom-in'); pg.click('#zoom-in'); pg.wait_for_timeout(300)
    pg.click('[data-act="home"]'); pg.wait_for_timeout(900)
    pg.screenshot(path='/tmp/claude-0/o4.png')
    b.close()
print('errors',errs)
