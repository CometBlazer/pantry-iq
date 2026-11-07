"""Decode an image (honouring EXIF orientation, like browsers do) to raw RGBA for the Node OCR harness.
Writes <out>.rgba and prints 'width height'."""
import sys
from PIL import Image, ImageOps

src, out = sys.argv[1], sys.argv[2]
img = ImageOps.exif_transpose(Image.open(src)).convert("RGBA")
open(out, "wb").write(img.tobytes())
print(img.width, img.height)
