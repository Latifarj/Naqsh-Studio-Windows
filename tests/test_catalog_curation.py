import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))


def test_every_library_asset_exists_and_curated_z340_variants_are_not_selectable():
    library = read_json('assets/library.json')
    referenced = []
    for motif in library['motifs']:
        referenced.append(motif['asset'])
        referenced.extend(variant['asset'] for variant in motif.get('variants', []))
    assert all((ROOT / path).is_file() for path in referenced)

    z340 = next(motif for motif in library['motifs'] if motif['code'] == 'Z340')
    assert len(z340['variants']) == 8
    excluded = z340['excludedVariants']
    assert len(excluded) == 6
    assert all(not (ROOT / item['excludedAsset']).exists() for item in excluded)


def test_z340_exclusions_are_exact_duplicates_of_codes_on_same_source_pages():
    library = read_json('assets/library.json')
    audit = read_json('assets/audit.json')
    curation = read_json('tools/catalog-curation.json')
    motifs = {motif['code']: motif for motif in library['motifs']}
    pages = {page['page']: set(page['labelCodes']) for page in audit['pages']}
    z340 = motifs['Z340']

    assert len(curation['exclusions']) == 6
    assert audit['summary']['curatedVariantExclusions'] == 6
    for exclusion in curation['exclusions']:
        assert exclusion['code'] == 'Z340'
        duplicate = exclusion['sha256']
        assert any(item['sha256'] == duplicate for item in z340['excludedVariants'])
        for match in exclusion['matches']:
            assert hashlib.sha256((ROOT / match['asset']).read_bytes()).hexdigest() == duplicate
            for page in match['sharedPages']:
                assert 'Z340' in pages[page]
                assert match['code'] in pages[page]


def test_missing_v192_and_ambiguous_count_remain_explicit_audit_facts():
    library = read_json('assets/library.json')
    audit = read_json('assets/audit.json')
    assert not any(motif['code'] == 'V192' for motif in library['motifs'])
    assert any(item['code'] == 'V192' and item['page'] == 56 for item in audit['withoutImage'])
    assert audit['summary']['ambiguousAssociations'] == 225
    assert not any(motif['code'] == '225' for motif in library['motifs'])
