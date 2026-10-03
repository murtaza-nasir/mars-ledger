#!/usr/bin/env python3
"""Prepare the server-only assets the poster renderer needs (resvg reads TTF fonts and PNG/JPEG images only).

    python3 tools/poster-assets.py [--saira path/to/Saira[wdth,wght].ttf]

Writes server-assets/poster/:
  fonts/       static Saira instances (OFL) cut from the variable font, one family per width
  paintings/   JPEG copies of public/posters/*.webp at 1920x1080, plus library.json (each painting's axes)
  portraits/   JPEG copies of public/portraits/*.webp at 256x256
Re-run whenever the poster library or the portraits change; the outputs are committed.
"""
import argparse, io, json, os, sys, urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'server-assets', 'poster')
SAIRA_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/saira/Saira%5Bwdth,wght%5D.ttf'
OFL_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/saira/OFL.txt'

# (file, family, style, weight class, axis location). The poster refers to these families by name.
INSTANCES = [
    ('PosterSaira-Regular.ttf', 'Poster Saira', 'Regular', 400, {'wdth': 100, 'wght': 420}),
    ('PosterSaira-SemiBold.ttf', 'Poster Saira', 'SemiBold', 600, {'wdth': 100, 'wght': 640}),
    ('PosterSaira-Bold.ttf', 'Poster Saira', 'Bold', 700, {'wdth': 100, 'wght': 760}),
    ('PosterSairaWide-Black.ttf', 'Poster Saira Wide', 'Black', 900, {'wdth': 125, 'wght': 860}),
    ('PosterSairaCond-SemiBold.ttf', 'Poster Saira Cond', 'SemiBold', 600, {'wdth': 70, 'wght': 600}),
]


def rename(font: TTFont, family: str, style: str, weight: int) -> None:
    full = f'{family} {style}'
    ps = f"{family.replace(' ', '')}-{style}"
    names = font['name']
    for rec in list(names.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            names.removeNames(nameID=rec.nameID)
    for nid, value in ((1, family), (2, 'Regular' if style == 'Regular' else style), (4, full), (6, ps), (16, family), (17, style), (3, f'{ps};poster')):
        names.setName(value, nid, 3, 1, 0x409)
        names.setName(value, nid, 1, 0, 0)
    font['OS/2'].usWeightClass = weight
    if 'STAT' in font:
        del font['STAT']


def fonts(saira_path: str | None) -> None:
    os.makedirs(os.path.join(OUT, 'fonts'), exist_ok=True)
    data = open(saira_path, 'rb').read() if saira_path else urllib.request.urlopen(SAIRA_URL, timeout=60).read()
    for file, family, style, weight, loc in INSTANCES:
        font = TTFont(io.BytesIO(data))
        inst = instancer.instantiateVariableFont(font, loc)
        rename(inst, family, style, weight)
        inst.save(os.path.join(OUT, 'fonts', file))
        print('font', file)
    try:
        open(os.path.join(OUT, 'fonts', 'OFL.txt'), 'wb').write(urllib.request.urlopen(OFL_URL, timeout=60).read())
    except Exception as e:  # the licence text is nice to have next to the files, not required to render
        print('warning: OFL.txt not fetched:', e, file=sys.stderr)


def images(src: str, dst: str, size: tuple[int, int], quality: int, square: bool = False) -> None:
    os.makedirs(dst, exist_ok=True)
    for name in sorted(os.listdir(src)):
        if not name.endswith('.webp'):
            continue
        im = Image.open(os.path.join(src, name)).convert('RGB')
        if square:
            s = min(im.size)
            im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2))
        im = im.resize(size, Image.LANCZOS)
        out = os.path.join(dst, name[:-5] + '.jpg')
        im.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
    print('images', dst, len([n for n in os.listdir(dst) if n.endswith('.jpg')]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--saira', help='local copy of Saira[wdth,wght].ttf (otherwise downloaded from google/fonts)')
    args = ap.parse_args()
    fonts(args.saira)
    images(os.path.join(ROOT, 'public', 'posters'), os.path.join(OUT, 'paintings'), (1920, 1080), 82)
    images(os.path.join(ROOT, 'public', 'portraits'), os.path.join(OUT, 'portraits'), (256, 256), 84, square=True)
    manifest = json.load(open(os.path.join(ROOT, 'public', 'posters', 'manifest.json')))
    keys = ('oceans', 'greenery', 'cities', 'warmth', 'view', 'barren')
    library = [{'file': name, **{k: v[k] for k in keys if k in v}} for name, v in sorted(manifest.items())]
    json.dump(library, open(os.path.join(OUT, 'paintings', 'library.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
