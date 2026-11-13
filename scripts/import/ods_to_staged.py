#!/usr/bin/env python3
"""ODS ledger -> staged movements JSON for the Finance project importer.

Sheet format (columns): Data Movimento (dd/mm/yyyy), Descricao, Categoria,
Valor (negative = expense, positive = income), Montante apos movimento, OBS.

Usage:
  python3 scripts/import/ods_to_staged.py "<file.ods>" > imports/staged.json

Staged row shape:
  { "date": "YYYY-MM-DD", "name": "...", "category": "...", "amount_cents": int,
    "sheet_balance_cents": int, "notes": "..." }
"""
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

TAG = lambda s: f'{{urn:oasis:names:tc:opendocument:xmlns:{s}:1.0}}'


def rows_from_ods(path):
    with zipfile.ZipFile(path) as zf:
        with zf.open('content.xml') as f:
            root = ET.fromstring(f.read())

    rows = []
    for table in root.iter(TAG('table') + 'table'):
        for row in table.iter(TAG('table') + 'table-row'):
            cells = []
            for cell in row.iter(TAG('table') + 'table-cell'):
                rep = int(cell.get(TAG('table') + 'number-columns-repeated', '1'))
                val = cell.get(TAG('office') + 'value')
                text = ' | '.join(''.join(p.itertext()) for p in cell.iter(TAG('text') + 'p'))
                cells.extend([(val if val is not None else text)] * min(rep, 8))
            rows.append(cells)
    return rows


def to_iso_date(value):
    # dd/mm/yyyy -> YYYY-MM-DD
    d, m, y = value.strip().split('/')
    return f'{y}-{m}-{d}'


def to_cents(value):
    return round(float(value) * 100)


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    rows = rows_from_ods(sys.argv[1])
    data = [r for r in rows[1:] if r[0] not in (None, '')]

    staged = []
    for row in data:
        date = to_iso_date(row[0])
        name = (row[1] or '').strip()
        category = (row[2] or '').strip()
        amount_cents = to_cents(row[3])
        sheet_balance_cents = to_cents(row[4]) if row[4] not in (None, '') else None
        notes = (row[5] if len(row) > 5 else '') or ''
        staged.append({
            'date': date,
            'name': name,
            'category': category,
            'amount_cents': amount_cents,
            'sheet_balance_cents': sheet_balance_cents,
            'notes': str(notes).strip(),
        })

    # Sanity checks
    opening = staged[0]['sheet_balance_cents'] - staged[0]['amount_cents']
    reconciliation = []
    prev = opening
    breaks = 0
    for idx, row in enumerate(staged):
        calc = prev + row['amount_cents']
        if row['sheet_balance_cents'] is not None and calc != row['sheet_balance_cents']:
            breaks += 1
            reconciliation.append({'line': idx + 2, 'name': row['name'], 'calc': calc,
                                   'sheet': row['sheet_balance_cents']})
        prev = row['sheet_balance_cents']

    out = {
        'opening_balance_cents': opening,
        'final_balance_cents': prev,
        'continuity_breaks': reconciliation,
        'rows': staged,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print(file=sys.stderr)
    print(f'[ods_to_staged] rows: {len(staged)}, opening: {opening / 100:.2f} EUR, '
          f'final: {prev / 100:.2f} EUR, continuity breaks: {breaks}', file=sys.stderr)


if __name__ == '__main__':
    main()
