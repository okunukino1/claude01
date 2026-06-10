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


def draw_kei_van(draw, x, y, w, h, body=CHARCOAL, accent=ORANGE, glass=(235, 241, 244, 255), outline=NAVY):
    stroke = max(3, int(w * 0.018))
    wheel_r = max(7, int(h * 0.14))
    base_y = y + h * 0.74
    roof_y = y + h * 0.18

    # A compact one-box silhouette so the vehicle reads as a kei van, not a truck.
    body_box = (x + w * 0.08, y + h * 0.25, x + w * 0.92, base_y)
    draw.rounded_rectangle(body_box, radius=int(h * 0.12), fill=body, outline=outline, width=stroke)
    roof = [
        (x + w * 0.18, y + h * 0.28),
        (x + w * 0.28, roof_y),
        (x + w * 0.68, roof_y),
        (x + w * 0.84, y + h * 0.3),
        (x + w * 0.88, y + h * 0.49),
        (x + w * 0.15, y + h * 0.49),
    ]
    draw.polygon(roof, fill=body)
    draw.line(roof + [roof[0]], fill=outline, width=stroke, joint="curve")

    draw.rounded_rectangle((x + w * 0.22, y + h * 0.29, x + w * 0.45, y + h * 0.48), radius=int(h * 0.05), fill=glass)
    draw.rounded_rectangle((x + w * 0.49, y + h * 0.29, x + w * 0.68, y + h * 0.48), radius=int(h * 0.05), fill=glass)
    draw.polygon(
        [(x + w * 0.71, y + h * 0.3), (x + w * 0.83, y + h * 0.42), (x + w * 0.72, y + h * 0.49)],
        fill=glass,
    )
    draw.line((x + w * 0.47, y + h * 0.27, x + w * 0.47, y + h * 0.68), fill=outline, width=max(2, stroke - 1))
    draw.rounded_rectangle((x + w * 0.18, y + h * 0.6, x + w * 0.84, y + h * 0.72), radius=int(h * 0.05), fill=accent)
    draw.rounded_rectangle((x + w * 0.88, y + h * 0.5, x + w * 0.94, y + h * 0.61), radius=4, fill=(255, 190, 0, 255))
    draw.rounded_rectangle((x + w * 0.08, y + h * 0.54, x + w * 0.14, y + h * 0.62), radius=4, fill=(255, 255, 255, 210))
    draw_wheels(draw, [(x + w * 0.3, y + h * 0.77), (x + w * 0.73, y + h * 0.77)], wheel_r, fill=outline, inner=WHITE)


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
    d.rounded_rectangle((58, 338, 454, 412), radius=37, fill=(255, 226, 215, 255))
    for y, length, alpha in [(342, 310, 255), (365, 260, 220), (390, 200, 140)]:
        d.rounded_rectangle((70, y, 70 + length, y + 7), radius=4, fill=(255, 87, 34, alpha))
    paste_center(im, logo_image(450, 160), 54)
    draw_kei_van(d, 166, 314, 180, 92, body=(39, 49, 58, 255), accent=ORANGE, outline=(16, 22, 28, 255))
    return add_border(im)


def candidate_b():
    im = Image.new("RGBA", (SIZE, SIZE), NAVY)
    d = ImageDraw.Draw(im)
    for r, alpha in [(220, 32), (170, 42), (120, 62)]:
        d.ellipse((256 - r, 318 - r, 256 + r, 318 + r), fill=(255, 87, 34, alpha))
    paste_center(im, logo_image(445, 150, shadow=True), 58)
    d.line((72, 365, 440, 315), fill=(255, 87, 34, 255), width=13)
    d.line((92, 398, 408, 358), fill=(255, 139, 90, 210), width=6)
    draw_kei_van(d, 161, 316, 190, 90, body=(250, 250, 247, 255), accent=ORANGE, outline=(20, 25, 31, 255))
    d.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=72, outline=ORANGE, width=7)
    return im


def candidate_c():
    im = Image.new("RGBA", (SIZE, SIZE), (255, 253, 248, 255))
    d = ImageDraw.Draw(im)
    paste_center(im, logo_image(432, 142), 52)
    d.line((104, 354, 188, 318, 256, 368, 346, 318, 424, 356), fill=(255, 87, 34, 255), width=10, joint="curve")
    for p in [(104, 354), (256, 368), (424, 356)]:
        d.ellipse((p[0] - 10, p[1] - 10, p[0] + 10, p[1] + 10), fill=WHITE, outline=ORANGE, width=5)
    draw_kei_van(d, 178, 307, 158, 78, body=WHITE, accent=ORANGE, outline=CHARCOAL)
    d.rounded_rectangle((69, 230, 443, 430), radius=48, outline=(230, 224, 213, 255), width=4)
    return add_border(im, fill=CHARCOAL)


def candidate_d():
    im = Image.new("RGBA", (SIZE, SIZE), CREAM)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((64, 252, 448, 414), radius=58, fill=ORANGE)
    d.rounded_rectangle((100, 294, 412, 392), radius=42, fill=(255, 255, 255, 245))
    paste_center(im, logo_image(440, 150), 54)
    for x, h in [(92, 28), (126, 45), (162, 34), (348, 50), (388, 36)]:
        d.rounded_rectangle((x, 262 - h, x + 22, 262), radius=4, fill=(86, 93, 101, 90))
    draw_kei_van(d, 169, 316, 174, 84, body=(24, 31, 39, 255), accent=ORANGE, outline=(14, 18, 23, 255))
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
    d.text((34, 24), "RYS kei-van delivery app icon candidates", fill=NAVY, font=title_font)
    positions = [(40, 92), (570, 92), (40, 370), (570, 370)]
    thumbs = []
    for path in paths:
        thumb = Image.open(path).convert("RGBA")
        thumb.thumbnail((220, 220), Image.Resampling.LANCZOS)
        thumbs.append(thumb)
    captions = [
        ("A Clean", "small kei van / speed lines"),
        ("B Dark", "dark / small kei van"),
        ("C Route", "route line / small kei van"),
        ("D Badge", "orange badge / kei van"),
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
