# SVG and PDF export (run `pdfinfo` on the saved file to double check the PDF)
import base64
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    pg.click('#pager'); pg.click('[data-act="addPage"]'); pg.wait_for_timeout(900)
    pg.click('[data-tab="shapes"]'); pg.click('[data-add="circle"]'); pg.wait_for_timeout(400)
    pg.click('[data-act="export"]'); pg.wait_for_timeout(500)
    pg.click('[data-fmt="svg"]'); pg.wait_for_timeout(600)
    r=pg.evaluate("""(async()=>{const i=document.getElementById('export-img');await i.decode();const c=document.createElement('canvas');c.width=300;c.height=300;const x=c.getContext('2d');x.drawImage(i,0,0,300,300);
      const px=(a,b)=>Array.from(x.getImageData(a,b,1,1).data).slice(0,3);
      return {corner:px(3,3),center:px(150,150),svgStart:i.src.slice(0,30)}})()""")
    print('svg', r)
    pg.click('[data-fmt="pdf"]'); pg.wait_for_timeout(1500)
    href=pg.evaluate("document.getElementById('export-dl').href")
    data=pg.evaluate("fetch(document.getElementById('export-dl').href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))")
    open('/tmp/claude-0/out.pdf','wb').write(bytes(data))
    print('pdf bytes', len(data), pg.inner_text('#export-note'))
    b.close()
print('errors',errs)
