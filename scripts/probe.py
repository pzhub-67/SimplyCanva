# Measure the photo engine: python3 scripts/probe.py  (builds probe/, serves it, prints each setting's effect)
# Ramp = sRGB output at 10/25/50/75/90 % grey input. Patches: orange, blue, skin, green, red, grey, near-white, near-black.
import subprocess, threading, http.server, functools, json, sys
from playwright.sync_api import sync_playwright
subprocess.run(['npx', 'vite', 'build', '--config', 'probe/vite.config.ts', '--logLevel', 'error'], check=True)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory='dist-probe'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
CASES = json.loads(sys.argv[1]) if len(sys.argv) > 1 else [
  {}, {'Exposure2012': 1}, {'Exposure2012': -1}, {'Contrast2012': 50}, {'Contrast2012': -50},
  {'Highlights2012': -100}, {'Highlights2012': 100}, {'Shadows2012': 100}, {'Shadows2012': -100},
  {'Whites2012': 50}, {'Whites2012': -50}, {'Blacks2012': 50}, {'Blacks2012': -50},
  {'IncrementalTemperature': 50}, {'IncrementalTemperature': -50}, {'IncrementalTint': 50},
  {'Vibrance': 60}, {'Saturation': 60}, {'Saturation': -100}, {'Clarity2012': 60}, {'Dehaze': 60},
  {'HueAdjustmentOrange': 100}, {'SaturationAdjustmentBlue': -100}, {'LuminanceAdjustmentBlue': -100},
  {'ColorGradeShadowHue': 220, 'ColorGradeShadowSat': 50}, {'ColorGradeHighlightHue': 40, 'ColorGradeHighlightSat': 50},
  {'ParametricShadows': 100}, {'ParametricHighlights': -100}, {'ConvertToGrayscale': True},
]
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    pg = b.new_page(); pg.goto('http://127.0.0.1:8765/'); pg.wait_for_function('window.probe')
    for c in CASES:
        r = pg.evaluate('d => window.probe(d)', c)
        print(f"{json.dumps(c):58s} ramp {r['ramp']}  orange {r['patches'][0]} blue {r['patches'][1]} skin {r['patches'][2]} grey {r['patches'][5]}")
    b.close()
srv.shutdown()
