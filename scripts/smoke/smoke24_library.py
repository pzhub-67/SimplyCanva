# Library like Lightroom mobile: albums, flags (pick/reject), stars, filter, sort, search, viewer swipe/rate/info,
# edit and return to the viewer, export dialog (format, size, quality).
import sys
from PIL import Image
from playwright.sync_api import sync_playwright
errs = []
WK = 'wk' in sys.argv
files = ['/tmp/claude-0/test.png', '/tmp/claude-0/big.jpg', '/tmp/claude-0/phone/IMG_1000.jpg']
with sync_playwright() as p:
    b = p.webkit.launch() if WK else p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, accept_downloads=True)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept('Game day'))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(900)
    pg.click('#top [data-act="library"]'); pg.wait_for_timeout(300)
    pg.set_input_files('#lib-add', files=files); pg.wait_for_timeout(5000)
    print('cells', pg.locator('.lcell').count())
    # select two: pick, rate 4, album
    pg.click('#lib-select'); pg.locator('.lcell').nth(0).click(); pg.locator('.lcell').nth(1).click()
    pg.click('[data-lib-act="pick"]'); pg.wait_for_timeout(200)
    pg.click('[data-lib-act="rate"]'); pg.locator('#lib-sheet-list .opt', has_text='★★★★').first.click(); pg.wait_for_timeout(300)
    pg.click('[data-lib-act="album"]'); pg.locator('#lib-sheet-list .opt', has_text='New album').click(); pg.wait_for_timeout(500)
    print('albums', pg.locator('#lib-albums .chip').all_inner_texts())
    pg.click('#lib-select'); pg.click('#lib-select'); pg.locator('.lcell').nth(2).click(); pg.click('[data-lib-act="reject"]'); pg.wait_for_timeout(200)
    pg.click('#lib-select')
    print('flags', pg.locator('.lcell .flag').count(), 'rejected', pg.locator('.lcell.rejected').count(), 'stars', pg.locator('.lcell .stars').all_inner_texts())
    pg.click('#lib-filter-btn'); pg.select_option('#lf-flag', 'pick'); pg.wait_for_timeout(200); print('picked filter', pg.locator('.lcell').count())
    pg.select_option('#lf-flag', ''); pg.select_option('#lf-rating', '4'); print('4+ stars', pg.locator('.lcell').count()); pg.select_option('#lf-rating', '0')
    pg.locator('#lib-albums .chip', has_text='Game day').click(); print('album view', pg.inner_text('#lib-title'), pg.locator('.lcell').count())
    pg.locator('#lib-albums .chip').first.click()
    pg.fill('#lib-search', 'big'); pg.wait_for_timeout(100); print('search big', pg.locator('.lcell').count()); pg.fill('#lib-search', '')
    pg.select_option('#lib-sort', 'name'); print('sorted by name', pg.locator('.lcell').evaluate_all('l => l.map(c => c.getAttribute("aria-label").split(",")[0])'))
    # viewer
    pg.locator('.lcell').nth(0).click(); pg.wait_for_timeout(1500)
    print('viewer', pg.is_visible('#loupe'), pg.inner_text('#lp-pos'))
    box = pg.locator('#lp-stage').bounding_box()
    pg.mouse.move(box['x'] + box['width'] * .8, box['y'] + box['height'] * .5); pg.mouse.down(); pg.mouse.move(box['x'] + box['width'] * .2, box['y'] + box['height'] * .5, steps=6); pg.mouse.up(); pg.wait_for_timeout(800)
    print('after swipe', pg.inner_text('#lp-pos'))
    pg.locator('#lp-stars button').nth(2).click(); pg.wait_for_timeout(200); print('stars on', pg.locator('#lp-stars .on').count())
    pg.click('#lp-info'); print('info', pg.inner_text('#lp-meta')[:60])
    pg.screenshot(path='/tmp/claude-0/lib-loupe.png')
    pg.click('#lp-edit'); pg.wait_for_timeout(1500)
    pg.locator('[data-sliders="light"] input[aria-label="Exposure"]').fill('0.5'); pg.wait_for_timeout(300)
    pg.click('#ed-done'); pg.wait_for_timeout(2000)
    print('back in viewer', pg.is_visible('#loupe'), pg.inner_text('#lp-pos'))
    # export: PNG at 1080
    pg.click('#lp-save'); pg.select_option('#lx-format', 'png'); pg.select_option('#lx-size', '1080')
    with pg.expect_download() as d: pg.click('#lx-go')
    im = Image.open(d.value.path()); print('export', d.value.suggested_filename, im.format, im.size)
    pg.click('#lp-back'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/claude-0/lib-grid2.png')
    # persists
    pg.reload(); pg.wait_for_timeout(1800)
    print('after reload albums', pg.locator('#lib-albums .chip').all_inner_texts(), 'stars', pg.locator('.lcell .stars').all_inner_texts())
    b.close()
print('errors', errs)
