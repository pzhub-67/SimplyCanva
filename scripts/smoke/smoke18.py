# Every basic shape can be added
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.click('[data-tab="shapes"]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/sh0.png')
    ids=pg.evaluate("[...document.querySelectorAll('#shape-grid [data-add]')].map(b=>b.dataset.add)")
    for i in ids:
        pg.click('[data-tab="shapes"]') if not pg.is_visible('#shape-grid') else None
        pg.click(f'#shape-grid [data-add="{i}"]'); pg.wait_for_timeout(150)
    pg.mouse.click(30,300); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/claude-0/sh1.png')
    print('shapes added', len(ids))
    b.close()
print('errors',errs)
