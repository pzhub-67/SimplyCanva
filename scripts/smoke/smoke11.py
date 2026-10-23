from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    pg.click('[data-act="edit"]'); pg.wait_for_timeout(300)
    pg.click('#dial .chip:has-text("Auto")'); pg.wait_for_timeout(300)
    print('changed dots', pg.locator('#dial .chip.changed').count())
    pg.screenshot(path='/tmp/claude-0/f0.png')
    pg.click('[data-ed-tab="filters"]'); pg.wait_for_timeout(500)
    print('thumb chips', pg.locator('#filters .chip.th').count())
    pg.click('#filters .chip.th:nth-child(5)'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/claude-0/f1.png')
    b.close()
print('errors',errs)
