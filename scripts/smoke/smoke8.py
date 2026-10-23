from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('file:///home/claude/canva-lite/dist/artifact.html'); pg.wait_for_timeout(800)
    pg.set_input_files('#img', files=['/tmp/claude-0/test.png']); pg.wait_for_timeout(900)
    for _ in range(4): pg.click('#zoom-in')
    pg.wait_for_timeout(300)
    pg.click('[data-act="export"]'); pg.wait_for_timeout(600)
    r=pg.evaluate("""(async()=>{const i=document.getElementById('export-img');await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);
      const px=(a,b)=>Array.from(x.getImageData(a,b,1,1).data).slice(0,3);
      return {w:c.width,h:c.height,center:px(540,540),corner:px(5,5),imgTopLeft:px(220,300)}})()""")
    print(r)
    b.close()
print('errors',errs)
