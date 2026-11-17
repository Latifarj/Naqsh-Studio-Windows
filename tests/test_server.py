import base64
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import threading

import fitz
from PIL import Image, ImageOps
import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, PRINT_DPI, PRINT_FONT, PRINT_PROFILE, ThreadingHTTPServer, make_pdf, validate_svg, verify_pdf_dimensions, verify_pdf_monochrome


def image_data():
    image = Image.new('RGB', (400, 200), 'red')
    for y in range(200):
        for x in range(200, 400):
            image.putpixel((x, y), (0, 255, 255))
    b = io.BytesIO()
    image.save(b, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def svg(art=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-print-profile="{PRINT_PROFILE}" width="100mm" height="50mm" viewBox="0 0 100 50">' + art + '</svg>'


def test_physical_pdf_page_size():
    data = make_pdf(svg('<rect width="100" height="50" fill="white"/>'), 100, 50)
    doc = fitz.open(stream=data, filetype='pdf')
    assert len(doc) == 1
    assert doc[0].rect.width == pytest.approx(100 * 72 / 25.4, abs=0.01)
    assert doc[0].rect.height == pytest.approx(50 * 72 / 25.4, abs=0.01)
    verify_pdf_dimensions(data, 100, 50)
    verify_pdf_monochrome(data)
    with pytest.raises(ValueError, match='برابر نیست'):
        verify_pdf_dimensions(data, 101, 50)


def test_rtl_bilingual_labels_are_shaped_and_printed_at_600_dpi():
    assert PRINT_FONT.is_file()
    art = '<text x="50" y="25" text-anchor="middle" direction="rtl" font-family="Vazirmatn" font-size="3.2" fill="#000000">آستین · 450 × 650 mm</text>'
    data = make_pdf(svg(art), 100, 50)
    document = fitz.open(stream=data, filetype='pdf')
    page = document[0]
    assert page.get_text().strip() == ''  # label is shaped image, not unshaped Cairo text
    images = page.get_images(full=True)
    assert images
    info = document.extract_image(images[0][0])
    with Image.open(io.BytesIO(info['image'])) as image:
        assert image.width > 100 and image.height > 20
        histogram = ImageOps.grayscale(image).histogram()
        assert not any(histogram[1:255])
        rect = page.get_image_rects(images[0][0])[0]
        assert image.width * 72 / rect.width >= PRINT_DPI - 2


def test_print_profile_rejects_clipped_text_labels():
    art = '<text x="50" y="1" text-anchor="middle" direction="ltr" font-size="3.2">Astin</text>'
    with pytest.raises(ValueError, match='برچسب دوزبانه'):
        make_pdf(svg(art), 100, 50)


def test_print_profile_requires_millimetre_one_to_one_viewbox():
    with pytest.raises(ValueError, match='viewBox'):
        make_pdf(svg().replace('viewBox="0 0 100 50"', 'viewBox="0 0 10 5"'), 100, 50)


def test_print_profile_rejects_unshaped_text_in_svg_motif_assets():
    nested = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><text x="1" y="5">آستین</text></svg>'
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(nested.encode()).decode()
    art = f'<defs><image id="motif" data-raster="false" x="-0.5" y="-0.5" width="1" height="1" xlink:href="{uri}"/></defs><use xlink:href="#motif" data-output-width-mm="10" data-output-height-mm="10" transform="translate(15 15) scale(10 10)"/>'
    with pytest.raises(ValueError, match='متن توکار'):
        make_pdf(svg(art), 100, 50)


@pytest.mark.parametrize('art', [
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>',
    '<defs><mask id="m"><rect width="10" height="10" fill="white"/></mask></defs><rect width="10" height="10" mask="url(#m)"/>'
])
def test_print_profile_rejects_gradients_and_masks(art):
    with pytest.raises(ValueError, match='gradient|mask'):
        make_pdf(svg(art), 100, 50)


def test_pdf_mirror_use_reference_and_clipping():
    source = image_data()
    art = f'''<defs><image id="m" data-source-width-px="400" data-source-height-px="200" data-raster="true" x="-.5" y="-.5" width="1" height="1" preserveAspectRatio="none" xlink:href="{source}"/>
    <clipPath id="c"><rect x="10" y="10" width="20" height="10"/></clipPath></defs>
    <rect width="100" height="50" fill="white"/>
    <g clip-path="url(#c)"><use data-output-width-mm="20" data-output-height-mm="10" xlink:href="#m" transform="translate(20 15) scale(-20 10)"/></g>'''
    doc = fitz.open(stream=make_pdf(svg(art), 100, 50), filetype='pdf')
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    def pixel(mm_x, mm_y):
        return pix.pixel(round(mm_x * 72 / 25.4 * 2), round(mm_y * 72 / 25.4 * 2))
    thresholded_white = pixel(15, 15)
    black = pixel(25, 15)
    clipped_white = pixel(35, 15)
    assert max(black) < 30
    assert min(thresholded_white) > 240
    assert min(clipped_white) > 240


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
    assert health['printProfile'] == PRINT_PROFILE
    project_store = requests.get(live_server + '/shared/project-store.js')
    assert project_store.status_code == 200
    assert b'NaqshProjectStore' in project_store.content
    assert requests.get(live_server + '/shared/not-allowed.js').status_code == 404
    assert requests.get(live_server + '/server.py').status_code == 404
    assert requests.get(live_server + '/assets/%2e%2e/server.py').status_code == 404


def test_rejects_untrusted_host_headers(live_server):
    response = requests.get(live_server + '/api/health', headers={'Host': 'attacker.example'})
    assert response.status_code == 403
    response = requests.post(live_server + '/api/export/pdf', headers={'Host': 'attacker.example'}, json={'svg': svg(), 'profile': PRINT_PROFILE, 'expected_width_mm': 100, 'expected_height_mm': 50})
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
    response = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<rect width="5" height="5" fill="red"/>'), 'profile': PRINT_PROFILE, 'expected_width_mm': 100, 'expected_height_mm': 50})
    assert response.status_code == 200
    assert response.headers['Content-Type'] == 'application/pdf'
    assert response.content.startswith(b'%PDF')
    bad = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<script/>'), 'profile': PRINT_PROFILE, 'expected_width_mm': 100, 'expected_height_mm': 50})
    assert bad.status_code == 400
    missing_scale = requests.post(live_server + '/api/export/pdf', json={'svg': svg(), 'profile': PRINT_PROFILE})
    assert missing_scale.status_code == 400
    wrong_profile = requests.post(live_server + '/api/export/pdf', json={'svg': svg(), 'profile': 'preview', 'expected_width_mm': 100, 'expected_height_mm': 50})
    assert wrong_profile.status_code == 400
    wrong_size = requests.post(live_server + '/api/export/pdf', json={'svg': svg('<rect width="5" height="5"/>'), 'profile': PRINT_PROFILE, 'expected_width_mm': 99, 'expected_height_mm': 50})
    assert wrong_size.status_code == 400
    assert 'برابر نیست' in wrong_size.json()['error']
    low_resolution_image = image_data()
    low = svg(f'<image id="low" data-source-width-px="400" data-source-height-px="200" data-raster="true" width="1" height="1" xlink:href="{low_resolution_image}"/><use data-output-width-mm="100" data-output-height-mm="50" xlink:href="#low"/>')
    low_response = requests.post(live_server + '/api/export/pdf', json={'svg': low, 'profile': PRINT_PROFILE, 'expected_width_mm': 100, 'expected_height_mm': 50})
    assert low_response.status_code == 400
    assert 'حداقل 300 PPI' in low_response.json()['error']
    wrong_type = requests.post(live_server + '/api/export/pdf', data='{}', headers={'Content-Type': 'text/plain'})
    assert wrong_type.status_code == 415
    wrong_shape = requests.post(live_server + '/api/export/pdf', data='[]', headers={'Content-Type': 'application/json'})
    assert wrong_shape.status_code == 400


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
