# Import six 12 MP phone photos (one rotated by EXIF) in WebKit at iPhone size; then again with IndexedDB blocked.
# Needs WebKit: PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pwb python3 -m playwright install webkit
import glob, sys
from playwright.sync_api import sync_playwright
files = sorted(glob.glob('/tmp/claude-0/phone/*.jpg'))
BLOCK = "Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('blocked', 'SecurityError'); } });"
with sync_playwright() as p:
    for blocked in (False, True):
        errs = []
        b = p.webkit.launch()
        dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None)
        ctx = b.new_context(**dev)
        if blocked: ctx.add_init_script(BLOCK)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
        pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(1500)
        pg.tap('#top [data-act="library"]'); pg.wait_for_timeout(500)
        pg.set_input_files('#lib-add', files=files)
        pg.wait_for_function("() => /photo|Added|failed/.test(document.querySelector('.toast')?.textContent || '')", timeout=120000)
        pg.wait_for_timeout(500)
        sizes = pg.eval_on_selector_all('.lcell img', 'l => l.map(i => i.naturalWidth + "x" + i.naturalHeight)')
        print('blocked' if blocked else 'normal', 'cells', pg.locator('.lcell').count(), sizes, pg.locator('.toast').all_inner_texts())
        pg.screenshot(path=f'/tmp/claude-0/phone-{"blocked" if blocked else "normal"}.png')
        pg.locator('.lcell').last.tap(); pg.wait_for_timeout(2500)
        print('  opens editor', pg.is_visible('#editor'))
        print('  errors', errs[:4])
        b.close()
