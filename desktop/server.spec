# PyInstaller one-file backend. Built on Windows by npm run build:server.
from pathlib import Path
import os
import sys

from PyInstaller.utils.hooks import collect_submodules

PROJECT_ROOT = Path(SPECPATH).resolve().parent
required_inputs = [PROJECT_ROOT / 'server.py', PROJECT_ROOT / 'web', PROJECT_ROOT / 'shared', PROJECT_ROOT / 'assets']
missing_inputs = [str(path) for path in required_inputs if not path.exists()]
if missing_inputs:
    raise FileNotFoundError('Required project inputs are missing: ' + ', '.join(missing_inputs))

def cairo_binaries():
    if sys.platform != 'win32':
        return []
    raw_dir = os.environ.get('CAIRO_DLL_DIR', '')
    dll_dir = Path(raw_dir)
    if not dll_dir.is_dir():
        raise RuntimeError('Set CAIRO_DLL_DIR to the MSYS2 mingw64/bin directory before building Windows.')

    # Cairo and Pillow/FriBidi use dynamic loading, so PyInstaller cannot infer
    # these native imports. Bundle both non-system DLL dependency trees.
    try:
        import pefile
    except ImportError as exc:
        raise RuntimeError('PyInstaller pefile dependency is required to collect Cairo DLLs.') from exc

    available = {item.name.lower(): item for item in dll_dir.glob('*.dll')}
    pending = ['libcairo-2.dll', 'libfribidi-0.dll']
    found = {}
    system_dlls = {
        'advapi32.dll', 'bcrypt.dll', 'comdlg32.dll', 'gdi32.dll', 'imm32.dll',
        'kernel32.dll', 'msvcp_win.dll', 'msvcrt.dll', 'ntdll.dll', 'ole32.dll',
        'oleaut32.dll', 'rpcrt4.dll', 'secur32.dll', 'shell32.dll', 'shlwapi.dll',
        'ucrtbase.dll', 'user32.dll', 'userenv.dll', 'version.dll', 'win32u.dll',
        'ws2_32.dll', 'wtsapi32.dll'
    }
    while pending:
        name = pending.pop().lower()
        if name in found or name in system_dlls:
            continue
        source = available.get(name)
        if source is None:
            continue
        found[name] = source
        pe = pefile.PE(str(source), fast_load=True)
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
        for entry in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', []):
            dependency = entry.dll.decode('ascii', errors='ignore').lower()
            if dependency in available and dependency not in found:
                pending.append(dependency)
    for required in ('libcairo-2.dll', 'libfribidi-0.dll'):
        if required not in found:
            raise RuntimeError(f'{required} was not found in {dll_dir}')
    return [(str(file), '.') for file in found.values()]

binaries = cairo_binaries()
datas = [
    (str(PROJECT_ROOT / 'web'), 'web'),
    (str(PROJECT_ROOT / 'shared'), 'shared'),
    (str(PROJECT_ROOT / 'assets'), 'assets'),
]
if sys.platform == 'win32':
    licenses = Path(os.environ['CAIRO_DLL_DIR']).parent / 'share' / 'licenses'
    if licenses.is_dir():
        datas.append((str(licenses), 'third-party-licenses'))
hiddenimports = collect_submodules('cairosvg') + collect_submodules('cairocffi')
a = Analysis(
    [str(PROJECT_ROOT / 'server.py')],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='naqsh-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
