import json
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page()
    pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    print('home hidden on open', pg.evaluate("document.getElementById('home').hidden"))
    pg.click('[data-tab="shapes"]'); pg.click('[data-add]'); pg.wait_for_timeout(300)
    pg.click('[data-act="closeSheet"]') if pg.is_visible('[data-act="closeSheet"]') else None
    pg.screenshot(path='/tmp/claude-0/w1.png')
    # zoom in via button
    pg.click('#zoom-in'); pg.click('#zoom-in'); pg.wait_for_timeout(300)
    print('zoom label', pg.inner_text('#zoom-fit'))
    pg.screenshot(path='/tmp/claude-0/w2.png')
    pg.click('#zoom-fit'); print('after fit', pg.inner_text('#zoom-fit'))
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    pg.screenshot(path='/tmp/claude-0/w3.png')
    # home
    pg.click('[data-act="home"]'); pg.wait_for_timeout(900)
    print('cards', pg.locator('.dcard').count(), 'back visible', pg.is_visible('#home-back'))
    pg.screenshot(path='/tmp/claude-0/home1.png')
    # new design (story) -> then home shows 1 card (blank not saved)
    pg.click('#start-list [data-new="1"]'); pg.wait_for_timeout(500)
    pg.click('[data-act="home"]'); pg.wait_for_timeout(700)
    print('cards after blank new', pg.locator('.dcard').count())
    pg.click('#home-back'); pg.click('[data-tab="text"]'); pg.click('[data-text="heading"]'); pg.wait_for_timeout(900)
    pg.click('[data-act="home"]'); pg.wait_for_timeout(900)
    print('cards after 2nd design edited', pg.locator('.dcard').count())
    pg.screenshot(path='/tmp/claude-0/home2.png')
    # rename first card, reload, last design is the story one
    pg.reload(); pg.wait_for_timeout(1500)
    print('reload size', pg.evaluate("[document.getElementById('c').width]"), 'home hidden', pg.evaluate("document.getElementById('home').hidden"))
    pg.click('[data-act="home"]'); pg.wait_for_timeout(700)
    pg.locator('.dcard .thumb').nth(1).click(); pg.wait_for_timeout(1200)
    print('opened other design, objects', pg.evaluate("document.getElementById('home').hidden"))
    pg.click('[data-act="home"]'); pg.wait_for_timeout(700)
    d=pg.locator('.dcard .meta button').first; d.click(); d.click(); pg.wait_for_timeout(700)
    print('cards after delete', pg.locator('.dcard').count())
    # wheel zoom
    pg.click('#home-back') if pg.is_visible('#home-back') else None
    b.close()
print('errors:',errs)
