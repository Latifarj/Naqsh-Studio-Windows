import base64
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import threading

import fitz
from PIL import Image
import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ThreadingHTTPServer, make_pdf, validate_svg, verify_pdf_dimensions


def image_data():
    image = Image.new('RGB', (20, 10), 'red')
    for y in range(10):
        for x in range(10, 20):
            image.putpixel((x, y), (0, 0, 255))
    b = io.BytesIO()
    image.save(b, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def svg(art=''):
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100mm" height="50mm" viewBox="0 0 100 50">' + art + '</svg>'


def test_physical_pdf_page_size():
    data = make_pdf(svg('<rect width="100" height="50" fill="white"/>'))
    doc = fitz.open(stream=data, filetype='pdf')
    assert len(doc) == 1
    assert doc[0].rect.width == pytest.approx(100 * 72 / 25.4, abs=0.01)
    assert doc[0].rect.height == pytest.approx(50 * 72 / 25.4, abs=0.01)
    verify_pdf_dimensions(data, 100, 50)
    with pytest.raises(ValueError, match='برابر نیست'):
        verify_pdf_dimensions(data, 101, 50)


def test_pdf_mirror_use_reference_and_clipping():
    source = image_data()
    art = f'''<defs><image id="m" x="-.5" y="-.5" width="1" height="1" preserveAspectRatio="none" xlink:href="{source}"/>
    <clipPath id="c"><rect x="10" y="10" width="10" height="10"/></clipPath></defs>
    <rect width="100" height="50" fill="white"/>
    <g clip-path="url(#c)"><use xlink:href="#m" transform="translate(20 15) scale(-20 10)"/></g>'''
    doc = fitz.open(stream=make_pdf(svg(art)), filetype='pdf')
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    def pixel(mm_x, mm_y):
        return pix.pixel(round(mm_x * 72 / 25.4 * 2), round(mm_y * 72 / 25.4 * 2))
    blue = pixel(15, 15)
    white = pixel(25, 15)
    assert blue[2] > 200 and blue[0] < 30
    assert min(white) > 240


@pytest.mark.parametrize('art', [
    '<script>alert(1)</script>',
    '<foreignObject/>',
    '<style>@import "https://example.com";</style>',
    '<rect width="10" onload="alert(1)"/>',
    '<image href="https://example.com/p.png"/>',
    '<image href="file:///etc/passwd"/>',
    '<rect fill="url(https://example.com/x)"/>',
])
def test_rejects_active_or_external_svg(art):
    with pytest.raises(ValueError):
        validate_svg(svg(art))


def test_nested_svg_cannot_load_external_resources():
    nested = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>'
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(nested.encode()).decode()
    with pytest.raises(ValueError):
        validate_svg(svg(f'<image href="{uri}"/>'))


def test_rejects_entities_and_oversize_pages():
    with pytest.raises(ValueError):
        validate_svg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + svg('<text>&x;</text>'))
    with pytest.raises(ValueError):
        validate_svg(svg().replace('100mm', '6001mm'))


def test_internal_gradient_is_allowed():
    validate_svg(svg('<defs><linearGradient id="g"><stop offset="0" stop-color="black"/></linearGradient></defs><rect fill="url(#g)" width="10" height="10"/>'))


@pytest.fixture(scope='module')
def live_server():
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{httpd.server_port}'
    httpd.shutdown()
    thread.join()
    httpd.server_close()


def test_health_and_no_source_file_exposure(live_server):
    health = requests.get(live_server + '/api/health').json()
    assert health['ok'] is True
    assert health['version'] == '1.1.0-beta'
    project_store = requests.get(live_server + '/shared/project-store.js')
    assert project_store.status_code == 200
    assert b'NaqshProjectStore' in project_store.content
    assert requests.get(live_server + '/shared/not-allowed.js').status_code == 404
    assert requests.get(live_server + '/server.py').status_code == 404
    assert requests.get(live_server + '/assets/%2e%2e/server.py').status_code == 404


def test_rejects_untrusted_host_headers(live_server):
    response = requests.get(live_server + '/api/health', headers={'Host': 'attacker.example'})
    assert response.status_code == 403
    response = requests.post(live_server + '/api/export/pdf', headers={'Host': 'attacker.example'}, json={'svg': svg()})
    assert response.status_code == 403


def test_server_refuses_non_loopback_bind_address():
    root = Path(__file__).resolve().parents[1]
    process = subprocess.run(
        [sys.executable, str(root / 'server.py'), '--host', '0.0.0.0', '--port', '0'],
        cwd=root, capture_output=True, text=True, timeout=5,
    )
    assert process.returncode != 0
    assert 'remote bindings are disabled' in process.stderr


def test_export_endpoint(live_server):
    response = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<rect width="5" height="5"/>'), 'expected_width_mm': 100, 'expected_height_mm': 50})
    assert response.status_code == 200
    assert response.headers['Content-Type'] == 'application/pdf'
    assert response.content.startswith(b'%PDF')
    bad = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<script/>')})
    assert bad.status_code == 400
    wrong_size = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<rect width="5" height="5"/>'), 'expected_width_mm': 99, 'expected_height_mm': 50})
    assert wrong_size.status_code == 400
    assert 'برابر نیست' in wrong_size.json()['error']
    wrong_type = requests.post(live_server + '/api/export/pdf', data='{}', headers={'Content-Type': 'text/plain'})
    assert wrong_type.status_code == 415


def test_server_reports_the_assigned_ephemeral_port():
    root = Path(__file__).resolve().parents[1]
    process = subprocess.Popen(
        [sys.executable, str(root / 'server.py'), '--host', '127.0.0.1', '--port', '0'],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        line = process.stdout.readline().strip()
        match = re.fullmatch(r'Naqsh Studio: http://127\.0\.0\.1:(\d+)', line)
        assert match, line
        response = requests.get(f'http://127.0.0.1:{match.group(1)}/api/health', timeout=5)
        assert response.status_code == 200
        assert response.json()['ok'] is True
    finally:
        process.terminate()
        process.wait(timeout=5)
