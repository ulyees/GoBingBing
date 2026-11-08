"""Generate the SearchFerry toolbar icons (run with Pillow available)."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"


def gradient(size: int) -> Image.Image:
    top = (59, 130, 246)
    bottom = (29, 78, 216)
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        t = y / (size - 1)
        row = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(size):
            pixels[x, y] = row
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    canvas = gradient(SIZE).convert("RGBA")

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=116, fill=255)

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(canvas, (0, 0), mask)

    draw = ImageDraw.Draw(icon)
    white = (255, 255, 255, 255)

    # Top arrow: left to right.
    draw.rounded_rectangle((132, 185, 352, 215), radius=15, fill=white)
    draw.polygon([(326, 152), (410, 200), (326, 248)], fill=white)

    # Bottom arrow: right to left.
    draw.rounded_rectangle((160, 297, 380, 327), radius=15, fill=white)
    draw.polygon([(186, 264), (102, 312), (186, 360)], fill=white)

    # Soft top highlight so the tile reads well on dark toolbars.
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-140, -260, 660, 160), fill=(255, 255, 255, 38))
    icon = Image.alpha_composite(icon, Image.composite(glow, Image.new("RGBA", icon.size, (0, 0, 0, 0)), mask))

    for size in (16, 32, 48, 128):
        resized = icon.resize((size, size), Image.LANCZOS)
        resized.save(OUT / f"icon{size}.png", optimize=True)
        print("wrote", OUT / f"icon{size}.png")


if __name__ == "__main__":
    main()
