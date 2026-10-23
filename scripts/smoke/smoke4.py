import json
from playwright.sync_api import sync_playwright
errs = []
def img(pg):
    pg.wait_for_timeout(900)
    d = json.loads(pg.evaluate("localStorage.getItem('canva-lite:design')"))
    o = [o for o in d['pages'][0]['objects'] if o['type'] == 'image'][0]
    return dict(w=o['width'], h=o['height'], orig=bool(o.get('orig')), crop=(o.get('edit') or {}).get('crop'), left=round(o['left']), top=round(o['top']), sx=round(o['scaleX'], 3))
def edit(pg):
    pg.evaluate("window.scrollTo(0,0)")
    pg.click('[data-act="edit"]'); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(600)
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    print('initial', img(pg))
    # 1) straighten 10 deg + 1:1, drag a corner inward, Done
    edit(pg)
    pg.click('[data-ed-tab="crop"]'); pg.wait_for_timeout(500)
    print('overlay visible', pg.evaluate("!document.getElementById('crop').hidden"))
    pg.fill('#crop-deg', '10'); pg.dispatch_event('#crop-deg', 'input')
    pg.click('#ratios .chip:has-text("1:1")'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/claude-0/v1-crop.png')
    box = pg.evaluate("(()=>{const r=document.getElementById('crop-cv').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
    # drag bottom-right corner roughly: find from center, corner is near center + offset; use screenshot-free approach: drag from the frame center to move
    cx, cy = box[0] + box[2]/2, box[1] + box[3]/2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 8, cy + 8, steps=4); pg.mouse.up()
    pg.click('#ed-done'); pg.wait_for_timeout(600)
    r1 = img(pg); print('after 1:1 + 10deg', r1)
    # 2) rotate 90 via crop tab
    edit(pg); pg.click('[data-ed-tab="crop"]'); pg.wait_for_timeout(500)
    print('reopened crop keeps params: ratio', pg.evaluate("document.querySelector('#ratios .chip[aria-pressed=true]').textContent"), 'deg', pg.evaluate("document.getElementById('crop-deg-val').textContent"))
    pg.click('#crop-rot'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/claude-0/v2-rot.png')
    pg.click('#ed-done'); pg.wait_for_timeout(600)
    r2 = img(pg); print('after rotate', r2)
    # 3) cancel after a new crop
    edit(pg); pg.click('[data-ed-tab="crop"]'); pg.wait_for_timeout(400)
    pg.click('#ratios .chip:has-text("16:9")'); pg.click('[data-ed-tab="adjust"]'); pg.wait_for_timeout(600)
    print('mid-session baked', img(pg) if False else 'skipped')
    pg.click('#ed-cancel'); pg.wait_for_timeout(700)
    r3 = img(pg); print('after cancel (should equal rotate result)', r3 == r2, r3)
    # 4) reset crop restores original
    edit(pg); pg.click('[data-ed-tab="crop"]'); pg.wait_for_timeout(400)
    pg.click('#crop-reset'); pg.click('#ed-done'); pg.wait_for_timeout(700)
    r4 = img(pg); print('after reset', r4)
    # 5) undo goes back to rotated crop
    pg.click('[data-act="undo"]'); pg.wait_for_timeout(1200)
    print('after undo', img(pg))
    # 6) page reload keeps working
    pg.reload(); pg.wait_for_timeout(1500)
    print('after reload', img(pg))
    b.close()
print('errors:', errs)
