#!/usr/bin/env python3
"""
Regenerate every raster app icon from the cosy NebulaX sparkle in public/logo.svg.

The design (kept identical to logo.svg / components/AiSparkle.tsx):
  - warm charcoal #1f1611 rounded tile
  - soft orange radial glow offset toward the main star
  - a four-point concave sparkle with the ffd5a6 -> fb923c -> f9518f -> ef3b6b
    vertical gradient, plus two companion sparkles
Rendered at 4x supersample then LANCZOS-downscaled to each target size.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VB = 512                      # logo.svg viewBox
F = 4                         # supersample factor
RES = VB * F                  # master resolution (2048)

CHARCOAL = (31, 22, 17, 255)  # #1f1611
GLOW_RGB = (251, 146, 60)     # #fb923c
GLOW_MAX_A = 128              # 0.5 * 255
CORNER = 120                  # logo.svg rx

# gradient stops: (offset, (r,g,b))
STOPS = [
    (0.00, (255, 213, 166)),  # #ffd5a6
    (0.35, (251, 146, 60)),   # #fb923c
    (0.70, (249, 81, 143)),   # #f9518f
    (1.00, (239, 59, 107)),   # #ef3b6b
]

# stars: (cx, cy, r, opacity) in 512-space  (matches logo.svg paths)
STARS = [
    (224, 256, 160.0, 1.00),  # main
    (416, 112, 51.2, 1.00),   # top-right companion
    (80, 432, 33.6, 0.85),    # bottom-left companion
]
K = 0.16  # concavity (control-point pull), same as AiSparkle


def grad_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(STOPS) - 1):
        o0, c0 = STOPS[i]
        o1, c1 = STOPS[i + 1]
        if t <= o1:
            f = 0 if o1 == o0 else (t - o0) / (o1 - o0)
            return tuple(round(c0[j] + (c1[j] - c0[j]) * f) for j in range(3))
    return STOPS[-1][1]


def qbez(p0, p1, p2, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def star_points(cx, cy, r, scale):
    """Concave four-point star, sampled to a polygon, in master pixels."""
    c = r * K
    top = (cx, cy - r)
    right = (cx + r, cy)
    bot = (cx, cy + r)
    left = (cx - r, cy)
    segs = [
        (top, (cx + c, cy - c), right),
        (right, (cx + c, cy + c), bot),
        (bot, (cx - c, cy + c), left),
        (left, (cx - c, cy - c), top),
    ]
    pts = []
    for p0, p1, p2 in segs:
        pts.extend(qbez(p0, p1, p2))
    return [(x * scale, y * scale) for (x, y) in pts]


def make_glow():
    """Radial orange glow as an RGBA layer sized RES, centred at the main star."""
    GR = 512
    cx, cy, rg = 224, 256, 190
    m = Image.new("L", (GR, GR), 0)
    d = ImageDraw.Draw(m)
    steps = rg
    # draw largest (faint) -> smallest (bright); each smaller circle overwrites
    # the centre with a higher alpha, giving a clean radial falloff.
    for i in range(steps):
        rad = rg * (1 - i / steps)
        a = int(GLOW_MAX_A * (i / steps))
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=a)
    m = m.resize((RES, RES), Image.LANCZOS)
    layer = Image.new("RGBA", (RES, RES), GLOW_RGB + (0,))
    layer.putalpha(m)
    return layer


def paste_stars(canvas, scale):
    for (cx, cy, r, op) in STARS:
        side = max(2, round(2 * r * scale))
        # vertical gradient over the star's bounding box
        col = [grad_color(y / (side - 1)) for y in range(side)]
        g = Image.new("RGB", (1, side))
        g.putdata(col)
        g = g.resize((side, side), Image.LANCZOS)
        # mask: the star shape in bbox-local coords
        x0 = (cx - r) * scale
        y0 = (cy - r) * scale
        pts = [(x - x0, y - y0) for (x, y) in star_points(cx, cy, r, scale)]
        mask = Image.new("L", (side, side), 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        if op < 1.0:
            mask = mask.point(lambda v: int(v * op))
        canvas.alpha_composite(_to_rgba(g, mask), (round(x0), round(y0)))


def _to_rgba(rgb, mask):
    out = rgb.convert("RGBA")
    out.putalpha(mask)
    return out


# ---- masters -------------------------------------------------------------
def master_tile(rounded=True):
    """Charcoal tile + glow + sparkles. Rounded => transparent corners."""
    bg = Image.new("RGBA", (RES, RES), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    if rounded:
        d.rounded_rectangle([0, 0, RES - 1, RES - 1], radius=CORNER * F, fill=CHARCOAL)
    else:
        d.rectangle([0, 0, RES, RES], fill=CHARCOAL)
    bg.alpha_composite(make_glow())
    paste_stars(bg, F)
    return bg


def master_marks():
    """Glow + sparkles on transparent (for the Android adaptive foreground)."""
    bg = Image.new("RGBA", (RES, RES), (0, 0, 0, 0))
    bg.alpha_composite(make_glow())
    paste_stars(bg, F)
    return bg


TILE = master_tile(rounded=True)      # web / desktop / android square
TILE_SQ = master_tile(rounded=False)  # iOS (full-bleed, system masks it)
MARKS = master_marks()                 # android adaptive foreground

# circular master for ic_launcher_round
_circle = Image.new("L", (RES, RES), 0)
ImageDraw.Draw(_circle).ellipse([0, 0, RES - 1, RES - 1], fill=255)
TILE_ROUND = TILE_SQ.copy()
TILE_ROUND.putalpha(_circle)


def out(master, size):
    return master.resize((size, size), Image.LANCZOS)


def save(master, relpath, size, mode="RGBA"):
    p = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img = out(master, size)
    if mode == "RGB":
        flat = Image.new("RGB", img.size, (31, 22, 17))
        flat.paste(img, mask=img.split()[-1])
        img = flat
    img.save(p)
    return relpath


def save_foreground(relpath, size):
    """Adaptive foreground: marks scaled into the inner safe zone, transparent."""
    p = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * 0.66)
    marks = MARKS.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(marks, (off, off))
    canvas.save(p)
    return relpath


written = []

# --- public/ (web + PWA) ---
for s in (72, 96, 128, 144, 152, 192, 384, 512):
    written.append(save(TILE, f"public/pwa-{s}.png", s))
written.append(save(TILE, "public/apple-touch-icon.png", 180))
# multi-size favicon
fav = os.path.join(ROOT, "public/favicon.ico")
out(TILE, 256).save(fav, sizes=[(16, 16), (32, 32), (48, 48)])
written.append("public/favicon.ico")

# --- src-tauri/icons (desktop + windows store) ---
for name, s in [
    ("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128),
    ("128x128@2x.png", 256), ("icon.png", 512),
    ("StoreLogo.png", 50),
    ("Square30x30Logo.png", 30), ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71), ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107), ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150), ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
]:
    written.append(save(TILE, f"src-tauri/icons/{name}", s))

# windows .ico (multi-size) + macOS .icns
ico = os.path.join(ROOT, "src-tauri/icons/icon.ico")
out(TILE, 256).save(ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
written.append("src-tauri/icons/icon.ico")
icns = os.path.join(ROOT, "src-tauri/icons/icon.icns")
out(TILE, 1024).save(icns)
written.append("src-tauri/icons/icon.icns")

# --- iOS (opaque, no rounded corners; system applies the mask) ---
ios = {
    "AppIcon-20x20@1x.png": 20, "AppIcon-20x20@2x.png": 40, "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-20x20@3x.png": 60, "AppIcon-29x29@1x.png": 29, "AppIcon-29x29@2x.png": 58,
    "AppIcon-29x29@2x-1.png": 58, "AppIcon-29x29@3x.png": 87, "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x.png": 80, "AppIcon-40x40@2x-1.png": 80, "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120, "AppIcon-60x60@3x.png": 180, "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152, "AppIcon-83.5x83.5@2x.png": 167, "AppIcon-512@2x.png": 1024,
}
for name, s in ios.items():
    written.append(save(TILE_SQ, f"src-tauri/icons/ios/{name}", s, mode="RGB"))
# Capacitor iOS appiconset
written.append(save(TILE_SQ, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024, mode="RGB"))

# --- Android (legacy square + round + adaptive foreground) ---
android = {
    "mdpi": (48, 108), "hdpi": (49, 162), "xhdpi": (96, 216),
    "xxhdpi": (144, 324), "xxxhdpi": (192, 432),
}
for dpi, (sq, fg) in android.items():
    base = f"src-tauri/icons/android/mipmap-{dpi}"
    written.append(save(TILE, f"{base}/ic_launcher.png", sq))
    p = os.path.join(ROOT, f"{base}/ic_launcher_round.png")
    out(TILE_ROUND, sq).save(p)
    written.append(f"{base}/ic_launcher_round.png")
    written.append(save_foreground(f"{base}/ic_launcher_foreground.png", fg))

# --- Capacitor Android (frontend/android/app/src/main/res) — the icons that
#     actually ship in the APK. Adaptive icon = charcoal background colour
#     (see values/ic_launcher_background.xml) + the sparkle foreground. ---
cap_android = {
    "mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216),
    "xxhdpi": (144, 324), "xxxhdpi": (192, 432),
}
for dpi, (sq, fg) in cap_android.items():
    base = f"android/app/src/main/res/mipmap-{dpi}"
    written.append(save(TILE, f"{base}/ic_launcher.png", sq))
    p = os.path.join(ROOT, f"{base}/ic_launcher_round.png")
    out(TILE_ROUND, sq).save(p)
    written.append(f"{base}/ic_launcher_round.png")
    written.append(save_foreground(f"{base}/ic_launcher_foreground.png", fg))

print(f"Wrote {len(written)} icon files:")
for w in written:
    print("  ", w)
