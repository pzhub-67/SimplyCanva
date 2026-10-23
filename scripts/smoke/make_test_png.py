# Writes the 800x600 gradient photo the smoke tests upload to /tmp/claude-0/test.png
from PIL import Image
import os
os.makedirs('/tmp/claude-0', exist_ok=True)
im = Image.new('RGB', (800, 600))
px = im.load()
for x in range(800):
    for y in range(600):
        px[x, y] = (int(255 * x / 800), int(255 * y / 600), 200 - int(150 * y / 600))
im.save('/tmp/claude-0/test.png')
