# UI screenshots of the main states at phone and desktop width, for design review.
import sys
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/shots'
import os; os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader'])
    for name, vp in [('phone', {'width': 390, 'height': 844}), ('desk', {'width': 1440, 'height': 900})]:
        pg = b.new_page(viewport=vp, device_scale_factor=1)
        pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(1200)
        pg.click('[data-tab="text"]'); pg.wait_for_timeout(400); pg.screenshot(path=f'{out}/{name}-sheet.png')
        pg.click('[data-text="heading"]'); pg.wait_for_timeout(600); pg.screenshot(path=f'{out}/{name}-text.png')
        pg.click('[data-tab="shapes"]'); pg.click('#shape-grid [data-add="circle"]'); pg.wait_for_timeout(600)
        pg.click('[data-tab="photo"]') if False else None
        pg.screenshot(path=f'{out}/{name}-shape.png')
        pg.click('[data-act="home"]'); pg.wait_for_timeout(1200); pg.screenshot(path=f'{out}/{name}-home.png', full_page=True)
        pg.click('#acct-btn'); pg.wait_for_timeout(300); pg.screenshot(path=f'{out}/{name}-profiles.png')
        pg.close()
    b.close()
