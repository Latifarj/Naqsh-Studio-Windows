#!/usr/bin/env python3
"""Build a portable source release after running and recording the real test suite."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OMIT = {'__pycache__', '.pytest_cache', '.git', '.DS_Store', 'node_modules', 'dist', 'release', 'build'}
PRIVATE = {'shared/CONTRACT.md', 'docs/SOURCE_NOTES.md'}


def run_test_suite() -> tuple[dict, str]:
    result = subprocess.run(
        ['npm', 'test'], cwd=ROOT, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, check=False,
    )
    output = result.stdout
    print(output, end='')
    if result.returncode:
        raise RuntimeError(f"npm test failed with exit code {result.returncode}; release was not created.")

    patterns = {
        'engine': r'(?m)^(\d+) engine tests passed\.$',
        'webUnitLabels': r'(?m)^PASS fresh section/property labels match current display unit \((\d+) regression tests?\)\.$',
        'illustratorApiModel': r'(?m)^(\d+) Illustrator API-model tests passed;',
        'pythonTests': r'(?m)^(\d+) passed, \d+ warnings? in [^\n]+$',
    }
    counts = {}
    for name, pattern in patterns.items():
        match = re.search(pattern, output)
        if not match:
            raise RuntimeError(f"Could not find the actual {name} test summary in npm test output.")
        counts[name] = int(match.group(1))
    if 'desktop packaging configuration: ok' not in output:
        raise RuntimeError('The desktop packaging configuration check did not report success.')
    counts['desktopConfig'] = 'passed'
    return {
        'command': 'npm test',
        'status': 'passed',
        'completedAtUtc': datetime.now(timezone.utc).isoformat(),
        'counts': counts,
    }, output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'Naqsh-Studio-v1.0-preview.zip')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and not args.force:
        parser.error('Output exists; use --force to replace this generated archive.')
    if output.is_relative_to(ROOT):
        parser.error('Put the archive outside the project folder.')
    output.parent.mkdir(parents=True, exist_ok=True)

    tests, test_log = run_test_suite()
    library = json.loads((ROOT / 'assets/library.json').read_text(encoding='utf-8'))
    motifs_with_image = sum(
        1 for motif in library['motifs']
        if motif.get('asset') and (ROOT / motif['asset']).is_file()
    )
    release_info = {
        'version': '1.0-preview',
        'motifsWithImage': motifs_with_image,
        'tests': tests,
        'realIllustratorRuntimeTested': False,
        'windowsInstallerBuiltHere': False,
        'productionPrintApproved': False,
        'containsLoginCredentials': False,
    }
    prefix = 'Naqsh-Studio/'
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(ROOT.rglob('*')):
            if not file.is_file():
                continue
            rel = file.relative_to(ROOT)
            if any(part in OMIT or part.startswith('.env') for part in rel.parts):
                continue
            if rel.as_posix() in PRIVATE or file.suffix in {'.pyc', '.pyo', '.zip'}:
                continue
            archive.write(file, prefix + rel.as_posix())
        archive.writestr(prefix + 'release-info.json', json.dumps(release_info, ensure_ascii=False, indent=2) + '\n')
        archive.writestr(prefix + 'test-results.txt', test_log)

    with ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError('ZIP integrity failure: ' + bad)
        names = set(archive.namelist())
        required = [
            'README.fa.md', 'web/index.html', 'shared/engine.js',
            'illustrator/Naqsh.jsx', 'illustrator/standalone.jsx',
            'assets/library.json', 'assets/audit.json',
            'examples/sample-garment.pdf', 'examples/sample.naqsh.json',
            'release-info.json', 'test-results.txt',
        ]
        for item in required:
            if prefix + item not in names:
                raise RuntimeError('Missing: ' + item)
        if json.loads(archive.read(prefix + 'release-info.json'))['tests']['status'] != 'passed':
            raise RuntimeError('Release metadata does not contain a passing test result.')
        print(json.dumps({'archive': str(output), 'files': len(names), 'bytes': output.stat().st_size, 'testCounts': tests['counts']}))


if __name__ == '__main__':
    main()
