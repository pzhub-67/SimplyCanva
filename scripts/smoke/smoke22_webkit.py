# Photo library in WebKit (Safari engine) and Chromium, phone-sized. Run: PLAYWRIGHT_BROWSERS_PATH=<webkit install> python3 smoke22_webkit.py wk
import os, sys
from playwright.sync_api import sync_playwright
errs = []
with sync_playwright() as p:
    eng = p.webkit if 'wk' in sys.argv else p.chromium
    dev = dict(p.devices['iPhone 13']) if 'wk' in sys.argv else {'viewport': {'width': 390, 'height': 844}, 'has_touch': True, 'device_scale_factor': 2}
    dev.pop('default_browser_type', None)
    b = eng.launch() if 'wk' in sys.argv else eng.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    ctx = b.new_context(**dev)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.type + ' ' + m.text[:200]) if m.type in ('error', 'warning') else None)
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(1200)
    pg.tap('#top [data-act="library"]'); pg.wait_for_timeout(500)
    pg.set_input_files('#lib-add', files=['/tmp/claude-0/test.png', '/tmp/claude-0/big.jpg']); pg.wait_for_timeout(4000)
    th0 = pg.eval_on_selector_all('.lcell img', 'l => l.map(i => i.src.length + ":" + i.src.slice(-20))')
    print('cells', pg.locator('.lcell').count(), th0, pg.locator('.toast').all_inner_texts(), errs[:5])
    pg.tap('#lib-select'); pg.locator('.lcell').nth(0).tap(); pg.locator('.lcell').nth(1).tap()
    pg.tap('[data-lib-act="preset"]'); pg.wait_for_timeout(300); pg.locator('#lib-sheet-list .opt', has_text='Noir').tap(); pg.wait_for_timeout(4000)
    th1 = pg.eval_on_selector_all('.lcell img', 'l => l.map(i => i.src.length + ":" + i.src.slice(-20))')
    print('thumb changed', [a != b for a, b in zip(th0, th1)], 'dots', pg.locator('.lcell .dot').count(), 'toast', pg.locator('.toast').all_inner_texts())
    pg.screenshot(path='/tmp/claude-0/wk-grid.png')
    print('select text', pg.inner_text('#lib-select'), 'pressed attrs', pg.locator('.lcell[aria-pressed]').count())
    print('tags', pg.locator('.lcell .ptag').all_inner_texts())
    pg.locator('.lcell').nth(0).tap(); pg.wait_for_timeout(800); pg.tap('#lp-edit'); pg.wait_for_timeout(2000)
    print('editor open', pg.is_visible('#editor'), 'library visible', pg.is_visible('#library'))
    pg.screenshot(path='/tmp/claude-0/wk-open.png')
    b.close()
print('errors', errs[:10])
