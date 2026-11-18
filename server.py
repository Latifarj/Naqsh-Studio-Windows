#!/usr/bin/env python3
"""Naqsh Studio local web app and bounded, self-contained SVG→PDF export.

Run: python server.py --host 127.0.0.1 --port 8765
Not a production multi-tenant service. No catalog/order data is uploaded externally.
"""
from __future__ import annotations
import argparse
import base64
import binascii
import io
import ipaddress
import json
import math
import mimetypes
from pathlib import Path
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from xml.etree.ElementTree import Element, register_namespace

# Pillow's Windows wheels load FriBidi dynamically. Keep DLL search handles
# alive and preload only the bundled/runtime copy, never a download at startup.
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
_DLL_HANDLES = []
if sys.platform == 'win32':
    import ctypes
    import os
    for _dll_dir in (ROOT, Path(os.environ.get('CAIRO_DLL_DIR', str(ROOT)))):
        if _dll_dir.is_dir():
            _DLL_HANDLES.append(os.add_dll_directory(str(_dll_dir)))
            _fribidi = _dll_dir / 'libfribidi-0.dll'
            if _fribidi.is_file():
                _DLL_HANDLES.append(ctypes.WinDLL(str(_fribidi)))
                break

import cairosvg
import pymupdf as fitz
from defusedxml import ElementTree as ET
from PIL import Image, ImageDraw, ImageFont, ImageOps, features

MAX_REQUEST = 50 * 1024 * 1024
MAX_IMAGE = 20 * 1024 * 1024
PRINT_PROFILE = 'technical-bw-v1'
BW_THRESHOLD = 128
MIN_PRINT_PPI = 300
PRINT_DPI = 600
SVG_NS = 'http://www.w3.org/2000/svg'
register_namespace('', SVG_NS)
register_namespace('xlink', 'http://www.w3.org/1999/xlink')
ALLOWED_TAGS = {
    'svg', 'g', 'defs', 'clipPath', 'polygon', 'polyline', 'path', 'rect',
    'image', 'title', 'desc', 'text', 'tspan', 'line', 'circle', 'ellipse',
    'use', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'mask'
}
DATA_IMAGE = re.compile(r'^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\r\n]+)$', re.I)
INTERNAL = re.compile(r'^#[A-Za-z_][A-Za-z0-9_.:-]*$')
MM_VALUE = re.compile(r'^\s*([0-9]+(?:\.[0-9]+)?)mm\s*$', re.I)
SVG_LENGTH = re.compile(r'^\s*([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\s*(mm|cm|in|pt|pc|px)?\s*$', re.I)
PRINT_FONT = ROOT / 'assets' / 'fonts' / 'Vazirmatn.ttf'


def local_name(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def validate_svg(svg: str | bytes, *, nested: bool = False, depth: int = 0) -> None:
    """Reject external I/O, scripts, entities and unbounded image data before CairoSVG."""
    if depth > 2:
        raise ValueError('تو در تو بودن تصویر SVG بیش از حد مجاز است.')
    data = svg.encode('utf-8') if isinstance(svg, str) else svg
    if len(data) > MAX_REQUEST:
        raise ValueError('حجم SVG بیش از ۵۰ مگابایت است.')
    if b'<!doctype' in data.lower() or b'<!entity' in data.lower():
        raise ValueError('DOCTYPE و ENTITY در خروجی مجاز نیستند.')
    root = ET.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    if local_name(root.tag) != 'svg':
        raise ValueError('فایل ورودی SVG نیست.')
    if not nested:
        for key in ('width', 'height'):
            match = re.fullmatch(r'\s*([0-9]+(?:\.[0-9]+)?)mm\s*', root.get(key, ''))
            if not match or not 0 < float(match.group(1)) <= 6000:
                raise ValueError('ابعاد PDF باید بر حسب mm و هر ضلع حداکثر ۶۰۰۰ میلی‌متر باشد.')
    image_cache: set[str] = set()
    count = 0
    for node in root.iter():
        count += 1
        if count > 70000:
            raise ValueError('تعداد عناصر SVG بیش از حد مجاز است.')
        tag = local_name(node.tag)
        if tag not in ALLOWED_TAGS:
            raise ValueError(f'عنصر غیرمجاز در SVG: {tag}')
        for attr, value in node.attrib.items():
            name = local_name(attr).lower()
            if name.startswith('on') or name in {'base', 'src'}:
                raise ValueError('رویداد اجرایی یا مسیر بیرونی در SVG مجاز نیست.')
            if name == 'href':
                if INTERNAL.fullmatch(value):
                    continue
                m = DATA_IMAGE.fullmatch(value)
                if not m:
                    raise ValueError('همهٔ تصاویر باید در فایل جاسازی شوند؛ لینک بیرونی یا فایل محلی مجاز نیست.')
                if value in image_cache:
                    continue
                image_cache.add(value)
                try:
                    raw = base64.b64decode(re.sub(r'\s+', '', m.group(2)), validate=True)
                except (ValueError, binascii.Error) as exc:
                    raise ValueError('دادهٔ تصویر معتبر نیست.') from exc
                if len(raw) > MAX_IMAGE:
                    raise ValueError('حجم یک تصویر بیش از ۲۰ مگابایت است.')
                if m.group(1).lower() == 'svg+xml':
                    validate_svg(raw, nested=True, depth=depth + 1)
                else:
                    try:
                        with Image.open(io.BytesIO(raw)) as img:
                            if img.width * img.height > 40_000_000:
                                raise ValueError('وضوح یک تصویر بیش از ۴۰ میلیون پیکسل است.')
                            if img.format not in {'PNG', 'JPEG', 'GIF', 'WEBP'}:
                                raise ValueError('قالب تصویر جاسازی‌شده پشتیبانی نمی‌شود.')
                    except (OSError, Image.DecompressionBombError) as exc:
                        raise ValueError('تصویر جاسازی‌شده قابل خواندن نیست.') from exc
            elif name == 'style':
                # Inline presentation values are allowed; CSS loading/execution is not.
                if re.search(r'@|expression\s*\(|javascript\s*:|https?\s*:|file\s*:', value, re.I):
                    raise ValueError('سبک دارای ارجاع بیرونی یا محتوای فعال است.')
            if re.search(r'url\s*\(', value, re.I):
                stripped = re.sub(r'url\(\s*[\'"]?#[A-Za-z_][A-Za-z0-9_.:-]*[\'"]?\s*\)', '', value, flags=re.I)
                if re.search(r'url\s*\(', stripped, re.I):
                    raise ValueError('ارجاع URL بیرونی در SVG مجاز نیست.')


def _black_or_white(value: str) -> str:
    """Map every SVG paint to a literal black or white (or keep no-paint/references)."""
    color = value.strip().lower()
    if color == 'none':
        return 'none'
    if color == 'transparent':
        return 'none'
    if color in {'white', '#fff', '#ffffff', 'rgb(255,255,255)', 'rgb(100%,100%,100%)'}:
        return '#ffffff'
    if color.startswith('url('):
        return value
    return '#000000'


def _threshold_image(raw: bytes) -> bytes:
    """Composite alpha on white, threshold at 128, and preserve source pixel dimensions."""
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 40_000_000:
                raise ValueError('وضوح یک تصویر بیش از ۴۰ میلیون پیکسل است.')
            rgba = source.convert('RGBA')
            background = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
            background.alpha_composite(rgba)
            gray = ImageOps.grayscale(background.convert('RGB'))
            binary = gray.point(lambda px: 255 if px >= BW_THRESHOLD else 0, mode='1')
            out = io.BytesIO()
            binary.save(out, format='PNG', optimize=True)
            return out.getvalue()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError('تصویر جاسازی‌شده قابل تبدیل به سیاه‌وسفید نیست.') from exc


def _normalise_style(value: str) -> str:
    paints = {'fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'}
    opacities = {'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'}
    declarations = []
    for declaration in value.split(';'):
        if ':' not in declaration:
            continue
        key, item = declaration.split(':', 1)
        name = key.strip().lower()
        item = item.strip()
        if name in paints:
            item = _black_or_white(item)
        elif name in opacities:
            item = '1'
        declarations.append(f'{key.strip()}:{item}')
    return ';'.join(declarations)


def _validate_print_paint_features(root) -> None:
    unsupported = {'linearGradient', 'radialGradient', 'pattern', 'mask'}
    for node in root.iter():
        tag = local_name(node.tag)
        if tag in unsupported:
            raise ValueError('برای چاپ سیاه‌وسفید خالص، gradient، pattern و mask در SVG باید پیش از ورود به نقش به تصویر تخت تبدیل شوند.')
        for key, value in node.attrib.items():
            name = local_name(key).lower()
            if name in {'mask', 'filter'} and value.strip().lower() != 'none':
                raise ValueError('mask و filter در پروفایل PDF فنی پشتیبانی نمی‌شوند؛ نقش را تخت یا به مسیر ساده تبدیل کنید.')
            if name in {'fill', 'stroke'} and re.search(r'url\s*\(', value, re.I):
                raise ValueError('gradient و pattern در fill/stroke برای PDF فنی پشتیبانی نمی‌شوند.')
            if name == 'style':
                for declaration in value.split(';'):
                    if ':' in declaration:
                        prop, paint = declaration.split(':', 1)
                        if prop.strip().lower() in {'fill', 'stroke'} and re.search(r'url\s*\(', paint, re.I):
                            raise ValueError('gradient و pattern در fill/stroke برای PDF فنی پشتیبانی نمی‌شوند.')


def _normalise_svg_paints(root, depth: int = 0) -> None:
    if depth > 2:
        raise ValueError('تو در تو بودن تصویر SVG بیش از حد مجاز است.')
    image_cache: dict[str, str] = {}
    paints = {'fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'}
    opacities = {'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'}
    for node in root.iter():
        for key, value in list(node.attrib.items()):
            name = local_name(key).lower()
            if name in paints:
                node.set(key, _black_or_white(value))
            elif name in opacities:
                node.set(key, '1')
            elif name == 'style':
                node.set(key, _normalise_style(value))
        if local_name(node.tag) != 'image':
            continue
        href_key = next((key for key in node.attrib if local_name(key).lower() == 'href'), None)
        href = node.get(href_key, '') if href_key else ''
        match = DATA_IMAGE.fullmatch(href)
        if not match:
            continue
        if href in image_cache:
            node.set(href_key, image_cache[href])
            continue
        try:
            raw = base64.b64decode(re.sub(r'\s+', '', match.group(2)), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError('دادهٔ تصویر معتبر نیست.') from exc
        media = match.group(1).lower()
        if media == 'svg+xml':
            nested = ET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
            if any(local_name(child.tag) in {'text', 'tspan'} for child in nested.iter()):
                raise ValueError('متن توکار در دارایی SVG نقش باید پیش از ورود به برنامه به مسیر یا تصویر تخت تبدیل شود.')
            _validate_print_paint_features(nested)
            _normalise_svg_paints(nested, depth + 1)
            converted = base64.b64encode(ET.tostring(nested, encoding='utf-8')).decode('ascii')
            new_href = 'data:image/svg+xml;base64,' + converted
        else:
            converted = base64.b64encode(_threshold_image(raw)).decode('ascii')
            new_href = 'data:image/png;base64,' + converted
        image_cache[href] = new_href
        node.set(href_key, new_href)


def _svg_length_mm(value: str, default: float = 0) -> float:
    match = SVG_LENGTH.fullmatch(value or '')
    if not match:
        raise ValueError('موقعیت یا اندازهٔ متن SVG معتبر نیست.')
    number = float(match.group(1))
    unit = (match.group(2) or '').lower()
    scale = {'': 1, 'mm': 1, 'cm': 10, 'in': 25.4, 'pt': 25.4 / 72, 'pc': 25.4 / 6, 'px': 25.4 / 96}[unit]
    result = number * scale
    if not math.isfinite(result):
        raise ValueError('موقعیت یا اندازهٔ متن SVG معتبر نیست.')
    return result if value else default


def _rasterise_svg_text(root) -> None:
    """Shape Persian with RAQM and emit a 600-PPI black-on-white image per SVG text node."""
    text_nodes = [node for node in root.iter() if local_name(node.tag) == 'text']
    if not text_nodes:
        return
    if not features.check('raqm'):
        raise ValueError('موتور شکل‌دهی متن RTL در نسخهٔ چاپی در دسترس نیست.')
    if not PRINT_FONT.is_file():
        raise ValueError('قلم Vazirmatn برای برچسب‌های PDF نصب نشده است.')
    px_per_mm = PRINT_DPI / 25.4
    font_cache = {}
    parents = {child: parent for parent in root.iter() for child in list(parent)}
    for node in text_nodes:
        if len(node) or not (node.text or '').strip():
            raise ValueError('برای برچسب PDF فقط متن ساده و بدون tspan پشتیبانی می‌شود.')
        if node.get('transform'):
            raise ValueError('متن برچسب PDF نباید تبدیل مستقل SVG داشته باشد.')
        ancestor = parents.get(node)
        while ancestor is not None and ancestor is not root:
            if ancestor.get('transform'):
                raise ValueError('متن برچسب PDF نباید زیر گروه چرخیده یا مقیاس‌یافته باشد.')
            ancestor = parents.get(ancestor)
        text = node.text
        x_mm = _svg_length_mm(node.get('x', '0'))
        y_mm = _svg_length_mm(node.get('y', '0'))
        font_size_mm = _svg_length_mm(node.get('font-size', '3.2'))
        if not 0 < font_size_mm <= 50:
            raise ValueError('اندازهٔ قلم برچسب PDF خارج از محدودهٔ مجاز است.')
        font_px = max(1, round(font_size_mm * px_per_mm))
        weight = 'bold' if (node.get('font-weight') or '').lower() in {'bold', '600', '700', '800', '900'} else 'normal'
        key = (font_px, weight)
        if key not in font_cache:
            font_cache[key] = ImageFont.truetype(str(PRINT_FONT), font_px, layout_engine=ImageFont.Layout.RAQM)
        font = font_cache[key]
        direction = (node.get('direction') or 'ltr').lower()
        direction = 'rtl' if direction == 'rtl' else 'ltr'
        language = 'fa' if direction == 'rtl' else 'en'
        anchor = {'middle': 'ms', 'end': 'rs', 'start': 'ls'}.get(node.get('text-anchor', 'start'), 'ls')
        probe = Image.new('L', (1, 1), 255)
        draw = ImageDraw.Draw(probe)
        bbox = draw.textbbox((0, 0), text, font=font, anchor=anchor, direction=direction, language=language)
        margin = max(2, round(font_px / 16))
        width_px, height_px = bbox[2] - bbox[0] + margin * 2, bbox[3] - bbox[1] + margin * 2
        if width_px <= 0 or height_px <= 0 or width_px * height_px > 40_000_000:
            raise ValueError('ابعاد متن برچسب PDF خارج از محدودهٔ مجاز است.')
        canvas = Image.new('L', (width_px, height_px), 255)
        draw = ImageDraw.Draw(canvas)
        draw.text((margin - bbox[0], margin - bbox[1]), text, font=font, fill=0, anchor=anchor, direction=direction, language=language)
        image = io.BytesIO()
        canvas.point(lambda px: 255 if px >= BW_THRESHOLD else 0, mode='1').save(image, format='PNG', optimize=True)
        encoded = base64.b64encode(image.getvalue()).decode('ascii')
        x = x_mm + (bbox[0] - margin) / px_per_mm
        y = y_mm + (bbox[1] - margin) / px_per_mm
        width_mm, height_mm = width_px / px_per_mm, height_px / px_per_mm
        attrs = {
            'x': f'{x:.6f}', 'y': f'{y:.6f}', 'width': f'{width_mm:.6f}', 'height': f'{height_mm:.6f}',
            'preserveAspectRatio': 'none', 'data-raster': 'true',
            'data-source-width-px': str(width_px), 'data-source-height-px': str(height_px),
            'data-output-width-mm': f'{width_mm:.6f}', 'data-output-height-mm': f'{height_mm:.6f}',
            '{http://www.w3.org/1999/xlink}href': 'data:image/png;base64,' + encoded
        }
        parent = parents.get(node)
        if parent is None:
            raise ValueError('والد عنصر متن SVG پیدا نشد.')
        index = list(parent).index(node)
        parent.remove(node)
        parent.insert(index, Element(f'{{{SVG_NS}}}image', attrs))

    page_width = float(MM_VALUE.fullmatch(root.get('width', '')).group(1))
    page_height = float(MM_VALUE.fullmatch(root.get('height', '')).group(1))
    for node in root.iter():
        if local_name(node.tag) != 'image' or node.get('data-output-width-mm') is None:
            continue
        x, y = _svg_length_mm(node.get('x', '0')), _svg_length_mm(node.get('y', '0'))
        width = _svg_length_mm(node.get('data-output-width-mm', ''))
        height = _svg_length_mm(node.get('data-output-height-mm', ''))
        if x < -0.001 or y < -0.001 or x + width > page_width + 0.001 or y + height > page_height + 0.001:
            raise ValueError('برچسب دوزبانه از محدودهٔ صفحه بیرون می‌زند؛ حاشیه یا چیدمان را اصلاح کنید.')


def _verify_raster_placement_resolution(root, minimum_ppi: int = MIN_PRINT_PPI) -> None:
    images = {}
    referenced = set()
    for node in root.iter():
        if local_name(node.tag) != 'image':
            continue
        href = next((node.get(key) for key in node.attrib if local_name(key).lower() == 'href'), '')
        match = DATA_IMAGE.fullmatch(href or '')
        if node.get('data-raster', 'true').lower() == 'false':
            if not match or match.group(1).lower() != 'svg+xml':
                raise ValueError('دارایی برداری باید SVG جاسازی‌شدهٔ واقعی باشد.')
            raw_svg = base64.b64decode(re.sub(r'\s+', '', match.group(2)), validate=True)
            vector_root = ET.fromstring(raw_svg, forbid_dtd=True, forbid_entities=True, forbid_external=True)
            if any(local_name(child.tag) == 'image' for child in vector_root.iter()):
                raise ValueError('SVG حاوی تصویر توکار برای PDF فنی پشتیبانی نمی‌شود؛ نقش را برداری خالص یا تصویر PNG/JPEG مستقل با وضوح کافی وارد کنید.')
            continue
        if not match or match.group(1).lower() == 'svg+xml':
            raise ValueError('تصویر raster برای کنترل وضوح باید یک دارایی جاسازی‌شدهٔ پیکسلی باشد.')
        try:
            raw = base64.b64decode(re.sub(r'\s+', '', match.group(2)), validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                actual_width, actual_height = image.size
        except (ValueError, binascii.Error, OSError, Image.DecompressionBombError) as exc:
            raise ValueError('ابعاد واقعی تصویر raster قابل بررسی نیست.') from exc
        try:
            declared_width = int(node.get('data-source-width-px', '0'))
            declared_height = int(node.get('data-source-height-px', '0'))
        except ValueError as exc:
            raise ValueError('فرادادهٔ پیکسلی نقش معتبر نیست.') from exc
        if declared_width != actual_width or declared_height != actual_height or actual_width <= 0 or actual_height <= 0:
            raise ValueError('فرادادهٔ اندازهٔ پیکسلی با فایل نقش برابر نیست.')
        image_id = node.get('id')
        direct_width = node.get('data-output-width-mm')
        direct_height = node.get('data-output-height-mm')
        if direct_width is not None or direct_height is not None:
            try:
                width_mm, height_mm = float(direct_width or 'nan'), float(direct_height or 'nan')
            except ValueError as exc:
                raise ValueError('اندازهٔ فیزیکی متن برای کنترل PPI معتبر نیست.') from exc
            if not (math.isfinite(width_mm) and math.isfinite(height_mm) and width_mm > 0 and height_mm > 0):
                raise ValueError('اندازهٔ فیزیکی متن برای کنترل PPI معتبر نیست.')
            ppi = min(actual_width / (width_mm / 25.4), actual_height / (height_mm / 25.4))
            if ppi < minimum_ppi:
                raise ValueError(f'وضوح مؤثر متن {ppi:.0f} PPI است؛ حداقل {minimum_ppi} PPI لازم است.')
        elif image_id:
            images[image_id] = (actual_width, actual_height)
        else:
            raise ValueError('برای تصویر raster باید جایگذاری فیزیکی قابل بررسی وجود داشته باشد.')

    for node in root.iter():
        if local_name(node.tag) != 'use':
            continue
        href = next((node.get(key) for key in node.attrib if local_name(key).lower() == 'href'), '')
        image_id = href[1:] if href.startswith('#') else ''
        if image_id not in images:
            continue
        referenced.add(image_id)
        width_px, height_px = images[image_id]
        try:
            width_mm = float(node.get('data-output-width-mm', 'nan'))
            height_mm = float(node.get('data-output-height-mm', 'nan'))
        except ValueError as exc:
            raise ValueError('اندازهٔ فیزیکی نقش برای کنترل PPI معتبر نیست.') from exc
        if not (math.isfinite(width_mm) and math.isfinite(height_mm) and width_mm > 0 and height_mm > 0):
            raise ValueError('اندازهٔ فیزیکی نقش برای کنترل PPI معتبر نیست.')
        ppi = min(width_px / (width_mm / 25.4), height_px / (height_mm / 25.4))
        if ppi < minimum_ppi:
            raise ValueError(f'وضوح مؤثر نقش {ppi:.0f} PPI است؛ برای PDF فنی حداقل {minimum_ppi} PPI لازم است.')
    if set(images) - referenced:
        raise ValueError('برای هر تصویر raster باید جایگذاری فیزیکی قابل بررسی وجود داشته باشد.')


def verify_pdf_monochrome(pdf: bytes) -> None:
    """Fail closed if PDF paint or embedded image samples are not pure black/white."""
    try:
        with fitz.open(stream=pdf, filetype='pdf') as document:
            for page in document:
                for span in page.get_texttrace():
                    color = span.get('color')
                    if isinstance(color, int) and color not in {0, 0xFFFFFF}:
                        raise ValueError('PDF فنی شامل متن برداری با رنگ غیرمشکی یا غیرسفید است.')
                    if isinstance(color, (tuple, list)) and not (all(abs(c) < 1e-6 for c in color) or all(abs(c - 1) < 1e-6 for c in color)):
                        raise ValueError('PDF فنی شامل متن برداری با رنگ غیرمشکی یا غیرسفید است.')
                for drawing in page.get_drawings():
                    for color in (drawing.get('color'), drawing.get('fill')):
                        if color is not None and not (all(abs(c) < 1e-6 for c in color) or all(abs(c - 1) < 1e-6 for c in color)):
                            raise ValueError('PDF فنی شامل رنگ برداری غیرمشکی یا غیرسفید است.')
                for image_info in page.get_images(full=True):
                    image_data = document.extract_image(image_info[0])
                    with Image.open(io.BytesIO(image_data['image'])) as image:
                        rgb = image.convert('RGB')
                        red, green, blue = rgb.split()
                        if red.tobytes() != green.tobytes() or red.tobytes() != blue.tobytes():
                            raise ValueError('PDF فنی شامل تصویر رنگی است.')
                        histogram = ImageOps.grayscale(rgb).histogram()
                        if any(histogram[1:255]):
                            raise ValueError('PDF فنی شامل تون خاکستری میانی است؛ فقط سیاه و سفید خالص مجاز است.')
    except (RuntimeError, OSError) as exc:
        raise ValueError('محتوای PDF فنی قابل بررسی نیست.') from exc


def make_pdf(svg: str, expected_width_mm: float, expected_height_mm: float) -> bytes:
    """Create a black/white PDF and verify its declared and resulting physical size."""
    validate_svg(svg)
    if not (math.isfinite(expected_width_mm) and math.isfinite(expected_height_mm)):
        raise ValueError('اندازهٔ مورد انتظار PDF معتبر نیست.')
    root = ET.fromstring(svg, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    if root.get('data-print-profile') != PRINT_PROFILE:
        raise ValueError(f'پروفایل چاپ {PRINT_PROFILE} برای ساخت PDF فنی الزامی است.')
    width_match = MM_VALUE.fullmatch(root.get('width', ''))
    height_match = MM_VALUE.fullmatch(root.get('height', ''))
    if not width_match or not height_match:
        raise ValueError('ابعاد SVG فنی باید بر حسب میلی‌متر باشند.')
    if abs(float(width_match.group(1)) - expected_width_mm) > 0.01 or abs(float(height_match.group(1)) - expected_height_mm) > 0.01:
        raise ValueError('ابعاد SVG با اندازهٔ مورد انتظار پروژه برابر نیست.')
    try:
        view_box = [float(value) for value in re.split(r'[\s,]+', root.get('viewBox', '').strip()) if value]
    except ValueError as exc:
        raise ValueError('viewBox برای کنترل مقیاس چاپ معتبر نیست.') from exc
    if len(view_box) != 4 or abs(view_box[0]) > 0.001 or abs(view_box[1]) > 0.001 or abs(view_box[2] - expected_width_mm) > 0.01 or abs(view_box[3] - expected_height_mm) > 0.01:
        raise ValueError('viewBox باید از مبدأ صفر تا ابعاد فیزیکی صفحه بر حسب میلی‌متر باشد.')
    _validate_print_paint_features(root)
    _normalise_svg_paints(root)
    _rasterise_svg_text(root)
    # A print-profile page always begins with a literal white background.
    root.insert(0, Element(f'{{{SVG_NS}}}rect', {'x': '0', 'y': '0', 'width': '100%', 'height': '100%', 'fill': '#ffffff'}))
    _verify_raster_placement_resolution(root)
    normalized = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    validate_svg(normalized)
    pdf = cairosvg.svg2pdf(bytestring=normalized, unsafe=False)
    verify_pdf_dimensions(pdf, expected_width_mm, expected_height_mm)
    verify_pdf_monochrome(pdf)
    return pdf


def verify_pdf_dimensions(pdf: bytes, expected_width_mm: float, expected_height_mm: float, tolerance_mm: float = 0.2) -> None:
    """Fail closed if conversion changes the physical page size or page count."""
    if not (0 < expected_width_mm <= 6000 and 0 < expected_height_mm <= 6000):
        raise ValueError('اندازهٔ مورد انتظار PDF باید بین صفر و ۶۰۰۰ میلی‌متر باشد.')
    try:
        with fitz.open(stream=pdf, filetype='pdf') as document:
            if len(document) != 1:
                raise ValueError('خروجی باید دقیقاً یک صفحه داشته باشد.')
            rect = document[0].rect
            width_mm = rect.width * 25.4 / 72
            height_mm = rect.height * 25.4 / 72
    except (RuntimeError, ValueError) as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError('PDF ساخته‌شده قابل خواندن نیست.') from exc
    if abs(width_mm - expected_width_mm) > tolerance_mm or abs(height_mm - expected_height_mm) > tolerance_mm:
        raise ValueError(
            f'اندازهٔ صفحهٔ PDF با پروژه برابر نیست: انتظار {expected_width_mm:.3f}×{expected_height_mm:.3f} mm، '
            f'خروجی {width_mm:.3f}×{height_mm:.3f} mm.'
        )


class Handler(SimpleHTTPRequestHandler):
    server_version = 'NaqshStudio/1.2.0-alpha.2'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def parse_request(self):
        if not super().parse_request():
            return False
        supplied = self.headers.get('Host', '').strip().lower()
        address = str(self.server.server_address[0]).lower()
        port = self.server.server_port
        try:
            parsed = ipaddress.ip_address(address.split('%', 1)[0])
            host_name = f'[{address}]' if parsed.version == 6 else address
        except ValueError:
            host_name = address
        allowed = {host_name, f'{host_name}:{port}'}
        if supplied not in allowed:
            self.send_error(403, 'Invalid Host header')
            return False
        return True

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'private, no-cache')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def json_response(self, status: int, value: dict):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if '\x00' in path or '\\' in path or '%' in path or '..' in Path(path).parts:
            return self.send_error(404)
        if path == '/api/health':
            return self.json_response(200, {'ok': True, 'app': 'naqsh-studio', 'version': '1.2.0-alpha.2', 'pdf': True, 'printProfile': PRINT_PROFILE})
        if path in {'/', '/index.html'}:
            self.path = '/web/index.html'
        elif not (path.startswith('/web/') or path.startswith('/assets/') or path in {'/shared/engine.js', '/shared/project-store.js'}):
            return self.send_error(404)
        target = (ROOT / unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file() or any(p.startswith('.') for p in target.relative_to(ROOT).parts):
            return self.send_error(404)
        relative = target.relative_to(ROOT)
        if not (relative.parts[0] in {'web', 'assets'} or relative.as_posix() in {'shared/engine.js', 'shared/project-store.js'}):
            return self.send_error(404)
        self.path = '/' + relative.as_posix()
        return super().do_GET()

    def do_HEAD(self):
        return self.send_error(405)

    def do_POST(self):
        if urlsplit(self.path).path != '/api/export/pdf':
            return self.json_response(404, {'error': 'مسیر پیدا نشد.'})
        if self.headers.get_content_type() != 'application/json':
            return self.json_response(415, {'error': 'فرمت درخواست باید application/json باشد.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_REQUEST:
                return self.json_response(413, {'error': 'حجم درخواست باید کمتر از ۵۰ مگابایت باشد.'})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('بدنهٔ درخواست PDF باید یک شیء JSON باشد.')
            svg = payload.get('svg')
            if not isinstance(svg, str):
                raise ValueError('متن SVG معتبر ارسال نشده است.')
            if payload.get('profile') != PRINT_PROFILE:
                raise ValueError(f'پروفایل چاپ {PRINT_PROFILE} برای ساخت PDF فنی الزامی است.')
            if 'expected_width_mm' not in payload or 'expected_height_mm' not in payload:
                raise ValueError('ابعاد مورد انتظار پروژه برای کنترل مقیاس الزامی است.')
            try:
                expected_width = float(payload['expected_width_mm'])
                expected_height = float(payload['expected_height_mm'])
            except (TypeError, ValueError) as exc:
                raise ValueError('اندازهٔ مورد انتظار PDF معتبر نیست.') from exc
            pdf = make_pdf(svg, expected_width, expected_height)
        except (ValueError, TypeError, KeyError, ET.ParseError) as exc:
            return self.json_response(400, {'error': str(exc)})
        except Exception as exc:
            self.log_error('PDF export failed: %s', type(exc).__name__)
            return self.json_response(422, {'error': 'تبدیل PDF انجام نشد؛ فایل SVG را ذخیره و نقش‌های سفارشی را بررسی کنید.'})
        self.send_response(200)
        self.send_header('Content-Type', 'application/pdf')
        self.send_header('Content-Disposition', 'attachment; filename="naqsh-design.pdf"')
        self.send_header('Content-Length', str(len(pdf)))
        self.end_headers()
        self.wfile.write(pdf)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765, help='Use 0 to select an available local port.')
    args = parser.parse_args()
    if args.host != '127.0.0.1':
        parser.error('--host must be 127.0.0.1; remote bindings are disabled.')
    mimetypes.add_type('font/woff2', '.woff2')
    mimetypes.add_type('application/javascript', '.js')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Naqsh Studio: http://{args.host}:{server.server_address[1]}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
