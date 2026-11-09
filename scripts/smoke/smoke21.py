# Photo library: import, edit and save back, flag, filters, batch preset, copy/paste, Save JPG at full size,
# add to a design, presets managed from the library, and everything still there after a reload.
import io, zipfile
from PIL import Image
from playwright.sync_api import sync_playwright
errs = []
FIX = '/home/claude/canva-lite/scripts/smoke/fixtures/golden-moody.xmp'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, accept_downloads=True)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(900)
    pg.click('#top [data-act="library"]'); pg.wait_for_timeout(400)
    print('empty state', pg.is_visible('#lib-empty'))
    pg.set_input_files('#lib-add', files=['/tmp/claude-0/test.png', '/tmp/claude-0/big.jpg']); pg.wait_for_timeout(3000)
    print('cells', pg.locator('.lcell').count(), pg.inner_text('#lib-count'))
    # presets from the library: import the .xmp (no file-type filter on the picker)
    pg.click('#lib-presets'); pg.wait_for_timeout(200)
    print('pimport accept attr', pg.get_attribute('#lib-pimport', 'accept'))
    pg.set_input_files('#lib-pimport', files=[FIX]); pg.wait_for_timeout(800)
    print('managed presets', pg.locator('#lib-sheet-list .prow').count())
    pg.click('#lib-sheet-close')
    # open the big photo, edit, Done
    pg.locator('.lcell').nth(0).click(); pg.wait_for_timeout(1500)
    print('editing, dark', pg.evaluate("getComputedStyle(document.body).backgroundColor"), 'save btn', pg.is_visible('#ed-save'))
    pg.locator('[data-sliders="light"] input[aria-label="Exposure"]').fill('40'); pg.wait_for_timeout(500)
    pg.click('[data-ed-tab="presets"]'); pg.wait_for_timeout(600)
    pg.select_option('#pgroup', label='Sports Pack (1)'); pg.wait_for_timeout(300)
    pg.locator('#filters .chip', has_text='Golden').click(); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/claude-0/l-edit.png')
    try:
        with pg.expect_download(timeout=8000) as d: pg.click('#ed-save')
    except Exception as e:
        print('NO DOWNLOAD', pg.locator('.toast').all_inner_texts(), errs); raise
    im = Image.open(d.value.path()); src = Image.open('/tmp/claude-0/big.jpg')
    mean = lambda i: [round(sum(c) / len(c)) for c in zip(*i.convert('RGB').resize((60, 40)).getdata())]
    print('full size jpg', d.value.suggested_filename, im.size, 'mean before', mean(src), 'after', mean(im))
    pg.click('#ed-done'); pg.wait_for_timeout(1500)
    print('back in library', pg.is_visible('#library'), 'edited dots', pg.locator('.lcell .dot').count())
    # select both: flag, apply a built-in preset, copy/paste
    pg.click('#lib-select'); pg.locator('.lcell').nth(0).click(); pg.locator('.lcell').nth(1).click()
    pg.click('[data-lib-act="pick"]'); pg.wait_for_timeout(300)
    print('flags', pg.locator('.lcell .flag').count())
    pg.click('[data-lib-act="preset"]'); pg.locator('#lib-sheet-list .opt', has_text='Noir').click(); pg.wait_for_timeout(2500)
    print('edited dots after batch', pg.locator('.lcell .dot').count())
    pg.screenshot(path='/tmp/claude-0/l-grid.png')
    with pg.expect_download() as d: pg.click('[data-lib-act="save"]')
    z = zipfile.ZipFile(d.value.path()); print('zip of jpgs', z.namelist())
    pg.click('[data-lib-filter="picks"]'); print('flagged filter', pg.locator('.lcell').count())
    pg.click('[data-lib-filter="all"]')
    pg.click('[data-lib-act="design"]'); pg.wait_for_timeout(2000)
    print('in design, library hidden', not pg.is_visible('#library'))
    # reload: photos, presets and edits persist; the app reopens the library
    pg.reload(); pg.wait_for_timeout(1500)
    print('after reload: library open', pg.is_visible('#library'), 'cells', pg.locator('.lcell').count(), 'dots', pg.locator('.lcell .dot').count())
    pg.click('#lib-presets'); pg.wait_for_timeout(300); print('presets kept', pg.locator('#lib-sheet-list .prow').count()); pg.click('#lib-sheet-close')
    pg.click('#lib-select'); pg.locator('.lcell').nth(1).click(); pg.click('#lib-del'); pg.click('#lib-del'); pg.wait_for_timeout(600)
    print('after delete', pg.locator('.lcell').count())
    pg.click('#lib-back'); pg.wait_for_timeout(500)
    imgs = pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('canva-lite'); q.onsuccess = () => { const g = q.result.transaction('designs').objectStore('designs').getAll(); g.onsuccess = () => r(g.result.map(d => d.pages[0].objects.filter(o => o.type === 'image').map(o => Object.keys(o.edit || {}).sort().join(',')))); }; })""")
    print('design images with edits', imgs)
    b.close()
print('errors', errs)
