from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


SIZE = 1024
root = Path(__file__).resolve().parents[1]
build_dir = root / "build"
source_path = build_dir / "rain-icon-source.png"
png_path = build_dir / "icon.png"
ico_path = build_dir / "icon.ico"
app_asset_path = root / "src" / "assets" / "rain-icon.png"

# Keep the Rain mark deterministic: every element is the same round-ended,
# 32-degree rain stroke.  The varied lengths and staggered positions keep the
# mark lively without mixing literal droplet silhouettes into the symbol.
source = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
stroke_mask = Image.new("L", (SIZE, SIZE), 0)
draw = ImageDraw.Draw(stroke_mask)
strokes = [
    ((330, 384), (396, 274)),
    ((462, 390), (538, 264)),
    ((586, 380), (660, 258)),
    ((255, 535), (325, 419)),
    ((374, 606), (470, 446)),
    ((520, 590), (648, 378)),
    ((650, 574), (730, 442)),
    ((724, 650), (782, 554)),
    ((402, 728), (468, 618)),
    ((536, 760), (594, 664)),
]
stroke_width = 28
radius = stroke_width // 2
for start, end in strokes:
    draw.line((start, end), fill=255, width=stroke_width)
    for point in (start, end):
        draw.ellipse(
            (point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius),
            fill=255,
        )

glow = stroke_mask.filter(ImageFilter.GaussianBlur(13))
glow_layer = Image.new("RGBA", source.size, (255, 255, 255, 0))
glow_layer.putalpha(glow.point(lambda value: int(value * 0.34)))
source.alpha_composite(glow_layer)
core = Image.new("RGBA", source.size, (255, 255, 255, 0))
core.putalpha(stroke_mask)
source.alpha_composite(core)
source.convert("RGB").save(source_path, optimize=True)

source = source.convert("RGB")
background = Image.new("RGB", source.size, "black")
difference = ImageChops.difference(source, background).convert("L")
difference = difference.point(lambda value: 255 if value > 22 else 0)
bounds = difference.getbbox()

if not bounds:
    raise RuntimeError("Rain icon source does not contain a visible white rain mark.")

left, top, right, bottom = bounds
mark = source.crop((left, top, right, bottom))
available = int(SIZE * 0.68)
mark.thumbnail((available, available), Image.Resampling.LANCZOS)

canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
x = (SIZE - mark.width) // 2
y = (SIZE - mark.height) // 2
canvas.alpha_composite(mark.convert("RGBA"), (x, y))

canvas.save(png_path, optimize=True)
canvas.save(app_asset_path, optimize=True)
canvas.save(
    ico_path,
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
