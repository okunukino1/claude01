from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parent
LOGO_PATH = Path(r"C:\Users\user\Downloads\rogo01 (1) (1).png")
SIZE = 512
SCALE = 3

ORANGE = (255, 87, 34, 255)
ORANGE_DARK = (225, 70, 25, 255)
CHARCOAL = (54, 61, 68, 255)
NAVY = (13, 17, 23, 255)
CREAM = (250, 247, 239, 255)
WHITE = (255, 255, 255, 255)
MUTED = (226, 221, 210, 255)


def load_font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothR.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def round_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def logo_image(max_width, max_height, shadow=False):
    logo = Image.open(LOGO_PATH).convert("RGBA")
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)
    logo.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    if not shadow:
        return logo
    out = Image.new("RGBA", (logo.width + 20, logo.height + 20), (0, 0, 0, 0))
    alpha = logo.getchannel("A").filter(ImageFilter.GaussianBlur(5))
    shadow_layer = Image.new("RGBA", logo.size, (0, 0, 0, 90))
    shadow_layer.putalpha(alpha)
    out.alpha_composite(shadow_layer, (10, 12))
    out.alpha_composite(logo, (0, 0))
    return out


def paste_center(base, im, y):
    x = (base.width - im.width) // 2
    base.alpha_composite(im, (x, y))


def draw_wheels(draw, centers, r, fill=NAVY, inner=WHITE):
    for cx, cy in centers:
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)
        draw.ellipse((cx - r * 0.48, cy - r * 0.48, cx + r * 0.48, cy + r * 0.48), fill=inner)


def draw_van(draw, x, y, w, h, body=CHARCOAL, accent=ORANGE, light=WHITE, outline=None):
    cab_w = int(w * 0.28)
    cargo_w = w - cab_w
    round_rect(draw, (x, y + h * 0.16, x + cargo_w, y + h * 0.76), int(h * 0.12), body, outline, 4 if outline else 1)
    round_rect(draw, (x + cargo_w - 2, y + h * 0.2, x + w, y + h * 0.76), int(h * 0.1), body, outline, 4 if outline else 1)
    draw.polygon(
        [
            (x + cargo_w + cab_w * 0.18, y + h * 0.22),
            (x + w - 4, y + h * 0.5),
            (x + cargo_w + cab_w * 0.18, y + h * 0.66),
        ],
        fill=light,
    )
    round_rect(draw, (x + w * 0.08, y + h * 0.28, x + w * 0.48, y + h * 0.58), int(h * 0.07), (45, 55, 63, 255))
    round_rect(draw, (x + w * 0.58, y + h * 0.28, x + w * 0.78, y + h * 0.58), int(h * 0.07), (245, 242, 235, 255))
    draw.rounded_rectangle((x + w * 0.09, y + h * 0.68, x + w * 0.88, y + h * 0.8), radius=int(h * 0.05), fill=accent)
    draw.rounded_rectangle((x + w - 26, y + h * 0.54, x + w - 5, y + h * 0.66), radius=5, fill=(255, 190, 0, 255))
    draw_wheels(draw, [(x + w * 0.26, y + h * 0.82), (x + w * 0.77, y + h * 0.82)], int(h * 0.16))


def draw_delivery_truck(draw, x, y, w, h, body=WHITE, accent=ORANGE, outline=NAVY):
    draw.rounded_rectangle((x, y + h * 0.25, x + w * 0.68, y + h * 0.74), radius=int(h * 0.08), fill=body, outline=outline, width=5)
    draw.rounded_rectangle((x + w * 0.65, y + h * 0.35, x + w, y + h * 0.74), radius=int(h * 0.08), fill=body, outline=outline, width=5)
    draw.polygon(
        [(x + w * 0.77, y + h * 0.38), (x + w * 0.94, y + h * 0.57), (x + w * 0.77, y + h * 0.67)],
        fill=(232, 237, 240, 255),
    )
    draw.rounded_rectangle((x + w * 0.1, y + h * 0.43, x + w * 0.38, y + h * 0.62), radius=6, fill=accent)
    draw.line((x + w * 0.24, y + h * 0.43, x + w * 0.24, y + h * 0.62), fill=WHITE, width=4)
    draw.line((x + w * 0.1, y + h * 0.525, x + w * 0.38, y + h * 0.525), fill=WHITE, width=4)
    draw_wheels(draw, [(x + w * 0.25, y + h * 0.78), (x + w * 0.76, y + h * 0.78)], int(h * 0.14), fill=outline, inner=WHITE)
    draw.rounded_rectangle((x + w * 0.05, y + h * 0.72, x + w * 0.9, y + h * 0.82), radius=10, fill=accent)


def add_border(im, fill=ORANGE, bg=CREAM):
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=72, fill=None, outline=fill, width=7)
    return Image.alpha_composite(im, overlay)


def candidate_a():
    im = Image.new("RGBA", (SIZE, SIZE), CREAM)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((36, 330, 476, 424), radius=45, fill=(255, 226, 215, 255))
    for y, length, alpha in [(330, 350, 255), (358, 310, 230), (387, 250, 160), (423, 170, 120)]:
        d.rounded_rectangle((52, y, 52 + length, y + 9), radius=5, fill=(255, 87, 34, alpha))
    paste_center(im, logo_image(450, 160), 54)
    draw_van(d, 135, 286, 260, 140, body=(39, 49, 58, 255), accent=ORANGE)
    return add_border(im)


def candidate_b():
    im = Image.new("RGBA", (SIZE, SIZE), NAVY)
    d = ImageDraw.Draw(im)
    for r, alpha in [(220, 32), (170, 42), (120, 62)]:
        d.ellipse((256 - r, 318 - r, 256 + r, 318 + r), fill=(255, 87, 34, alpha))
    paste_center(im, logo_image(445, 150, shadow=True), 58)
    d.line((54, 352, 456, 298), fill=(255, 87, 34, 255), width=18)
    d.line((78, 394, 430, 348), fill=(255, 139, 90, 210), width=8)
    draw_delivery_truck(d, 116, 278, 286, 142, body=(250, 250, 247, 255), accent=ORANGE, outline=(20, 25, 31, 255))
    d.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=72, outline=ORANGE, width=7)
    return im


def candidate_c():
    im = Image.new("RGBA", (SIZE, SIZE), (255, 253, 248, 255))
    d = ImageDraw.Draw(im)
    paste_center(im, logo_image(432, 142), 52)
    d.line((96, 346, 178, 300, 256, 360, 354, 300, 432, 350), fill=(255, 87, 34, 255), width=13, joint="curve")
    for p in [(96, 346), (256, 360), (432, 350)]:
        d.ellipse((p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14), fill=WHITE, outline=ORANGE, width=7)
    draw_delivery_truck(d, 155, 272, 230, 118, body=WHITE, accent=ORANGE, outline=CHARCOAL)
    d.rounded_rectangle((69, 230, 443, 430), radius=48, outline=(230, 224, 213, 255), width=4)
    return add_border(im, fill=CHARCOAL)


def candidate_d():
    im = Image.new("RGBA", (SIZE, SIZE), CREAM)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((52, 238, 460, 420), radius=58, fill=ORANGE)
    d.rounded_rectangle((86, 280, 426, 398), radius=42, fill=(255, 255, 255, 245))
    paste_center(im, logo_image(440, 150), 54)
    for x, h in [(92, 28), (126, 45), (162, 34), (348, 50), (388, 36)]:
        d.rounded_rectangle((x, 262 - h, x + 22, 262), radius=4, fill=(86, 93, 101, 90))
    draw_van(d, 134, 284, 255, 132, body=(24, 31, 39, 255), accent=ORANGE)
    d.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=72, outline=(255, 87, 34, 255), width=7)
    return im


def save_icon(im, name):
    path = ROOT / name
    im.save(path)
    return path


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    icons = [
        ("A", "clean", candidate_a()),
        ("B", "dark", candidate_b()),
        ("C", "route", candidate_c()),
        ("D", "badge", candidate_d()),
    ]
    paths = []
    for label, slug, image in icons:
        paths.append(save_icon(image, f"rys-delivery-icon-{label.lower()}-{slug}.png"))

    sheet = Image.new("RGBA", (1100, 660), (246, 244, 238, 255))
    d = ImageDraw.Draw(sheet)
    title_font = load_font(34, bold=True)
    label_font = load_font(28, bold=True)
    d.text((34, 24), "RYS delivery app icon candidates", fill=NAVY, font=title_font)
    positions = [(40, 92), (570, 92), (40, 370), (570, 370)]
    thumbs = []
    for path in paths:
        thumb = Image.open(path).convert("RGBA")
        thumb.thumbnail((220, 220), Image.Resampling.LANCZOS)
        thumbs.append(thumb)
    captions = [
        ("A Clean", "white base / speed lines"),
        ("B Dark", "dark / high contrast"),
        ("C Route", "delivery route image"),
        ("D Badge", "orange badge / app-like"),
    ]
    for (x, y), thumb, (label, desc) in zip(positions, thumbs, captions):
        d.rounded_rectangle((x, y, x + 490, y + 235), radius=28, fill=WHITE, outline=MUTED, width=3)
        sheet.alpha_composite(thumb, (x + 24, y + 8))
        d.text((x + 270, y + 54), label, fill=NAVY, font=label_font)
        d.text((x + 270, y + 98), desc, fill=CHARCOAL, font=load_font(21))
    save_icon(sheet.convert("RGBA"), "rys-delivery-icon-contact-sheet.png")
    for path in paths:
        print(path)
    print(ROOT / "rys-delivery-icon-contact-sheet.png")


if __name__ == "__main__":
    main()
