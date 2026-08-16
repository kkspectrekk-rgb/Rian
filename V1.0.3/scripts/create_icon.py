from pathlib import Path

from PIL import Image, ImageChops


SIZE = 1024
root = Path(__file__).resolve().parents[1]
build_dir = root / "build"
source_path = build_dir / "rain-icon-source.png"
png_path = build_dir / "icon.png"
ico_path = build_dir / "icon.ico"

source = Image.open(source_path).convert("RGB")
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
canvas.save(
    ico_path,
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
