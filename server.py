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
import mimetypes
from pathlib import Path
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

import cairosvg
import pymupdf as fitz
from defusedxml import ElementTree as ET
from PIL import Image

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
MAX_REQUEST = 50 * 1024 * 1024
MAX_IMAGE = 20 * 1024 * 1024
ALLOWED_TAGS = {
    'svg', 'g', 'defs', 'clipPath', 'polygon', 'polyline', 'path', 'rect',
    'image', 'title', 'desc', 'text', 'tspan', 'line', 'circle', 'ellipse',
    'use', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'mask'
}
DATA_IMAGE = re.compile(r'^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\r\n]+)$', re.I)
INTERNAL = re.compile(r'^#[A-Za-z_][A-Za-z0-9_.:-]*$')


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


def make_pdf(svg: str) -> bytes:
    validate_svg(svg)
    return cairosvg.svg2pdf(bytestring=svg.encode('utf-8'), unsafe=False)


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
    server_version = 'NaqshStudio/1.1.0-beta'

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
            return self.json_response(200, {'ok': True, 'app': 'naqsh-studio', 'version': '1.1.0-beta', 'pdf': True})
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
            svg = payload.get('svg')
            if not isinstance(svg, str):
                raise ValueError('متن SVG معتبر ارسال نشده است.')
            pdf = make_pdf(svg)
            if 'expected_width_mm' in payload or 'expected_height_mm' in payload:
                try:
                    expected_width = float(payload['expected_width_mm'])
                    expected_height = float(payload['expected_height_mm'])
                except (TypeError, ValueError) as exc:
                    raise ValueError('اندازهٔ مورد انتظار PDF معتبر نیست.') from exc
                verify_pdf_dimensions(pdf, expected_width, expected_height)
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
