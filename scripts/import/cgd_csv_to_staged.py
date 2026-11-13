#!/usr/bin/env python3
"""CGD bank statement CSV -> staged movements JSON for the Finance importer.

Input format (CGD "Consultar saldos e movimentos à ordem" export, ; separated):
  15 header lines, then rows: Data mov.;Data-valor;Descrição;Montante;Saldo contabilístico
  Amounts in pt-PT format (1.234,56), negative = expense. Newest first.

Usage:
  python3 scripts/import/cgd_csv_to_staged.py <movimentos.csv> [--cutoff 2026-10-01] > imports/staged_cgd.json

Output shape (same as ods_to_staged.py, plus per-row category):
  rows: [{ date, name, category, amount_cents, sheet_balance_cents, notes }]
Rows on/after --cutoff are dropped (already imported from the ODS ledger).
Category mapping targets the existing app categories; "Transportes" is created
by the JS importer on first use.
"""
import json
import re
import sys

CUTOFF_DEFAULT = '2026-10-01'


def num(s):
    return round(float(s.replace('.', '').replace(',', '.')) * 100)


def iso(d):
    dd, mm, yy = d.strip().split('-')
    return f'{yy}-{mm}-{dd}'


# (regex, category) — first match wins. Descriptions are uppercased before matching.
RULES = [
    # --- receipts from people (positive/negative decided by sign in code) ---
    (r'^TRF MBWAY\b', 'MBWAY'),           # special: sign decides TFR Recebido / TFR Pago
    (r'TRF TIAGO EMANUEL', 'TFR Recebido'),
    (r'TFI DRA SOFIA|TFI ROSA|TFI CATIA|TFI FRANCISCO|TFI CARLOS|TFI MANUEL|TFI JOSE|TFI JORGE|TFI DANIELA', 'TFR Recebido'),
    (r'TFI ANATOLIY|TRF ANATOLIY|TFI ABILIANE', 'Rendimento'),
    (r'TRF INSTITUTO|TRF GROWIN', 'Rendimento'),
    (r'^TRF REEMBOLSO', 'Outros'),

    # --- housing ---
    (r'^RENDA', 'Renda'),
    (r'\bCOND\b|CONDOM|EUPAGO CONDOM|PARRETAS', 'Condominios'),

    # --- telecom / utilities ---
    (r'NOS CINEMAS|APOSTA|ROCK IN|FESTIVAL|KALORAMA', 'Outros'),   # before "NOS " telecom catch
    (r'VODAFONE PORTUGAL|TVNET|ZON |\bNOS\b(?! CINEMA)', 'TVNETCASA'),
    (r'^VODAFONE', 'Telemovel'),
    (r'EDP GAS|^GAS\b', 'Gás'),

    # --- bank fees (before generic IMPOSTO catch) ---
    (r'MANUTENCAO CONTA|COMISSAO|IMPOSTO (DE )?SELO|DISP CARTAO|COM TRF MBWAY|TRF IMEDIATA NAC|\bSEPA\b|CAIXA GERAL', 'Bancos'),
    (r'\bIMI\b|IMPOSTO|MUNICIPIO|FINANCAS|SEG SOCIAL|EUPAGO INSTITUICAO|EUPAGO - INST', 'Imposto'),

    # --- cash withdrawals (before merchant-based rules) ---
    (r'LEVANTAMENTO|^ATM\b', 'Levantamento'),

    # --- fuel stations (after withdrawals: ATM at petrol station = cash) ---
    (r'\bBP\b|BP-|BP S|REPSOL|PETRO|POSTO AG|PR CONDE|GALP|CEPSA', 'Gasoleo'),

    # --- tobacco: user decision: Quiosque Beatriz é tabacaria ---
    (r'QUIOSQUE BEATR', 'Tabaco'),

    # --- health ---
    (r'WELLS|FARMACIA|MIPMED|HOSPITAL|LENTES|CLINICA|LABORATOR|DRA ISABEL', 'Saude'),

    # --- clothes ---
    (r'ZARA|HUGO BO|KARL LA|MANGO|PEPE JE|CALZEDONIA|\bSALSA\b|WOMAN SECRET|MICHAEL|DOUGLAS|SWAROVSKI|LION OF PORCH|SACOOR|JD SPOR|PVH', 'Roupa'),

    # --- stores / home improvement -> Loja ---
    (r'PCDIGA|WORTEN|RADIO POPULAR|OPENAI|GOOGLE|UDEMY|IKEA|ALFA ELEKTOR|LEROY|MAXMAT|PISCINAS|ESPACO CASA|JPLR|IMPERIO CENTRO|LUSTRE|PRIMOR|OUTLET PURIFIC|TIGER', 'Loja'),

    # --- local transport -> Transportes (new category, user will refine) ---
    (r'UBER|\bCP\b|PORTAGENS|PARKING|\bPARK\b|GO PARK|ESTACIONA|ESCALA PQ|INSPECC|INSPECO|INSTITUTO M T|IMT\b|NORAUTO|CENTRAUTO|CARCLASSE|EBA TRANSPORTES|GENERALSERV|TOP CENTRO|MANETE|COMPRA TRANSP', 'Transportes'),

    # --- travel (hotels, flights, rent-a-car) ---
    (r'HOTEL|RYANAIR|CARJET|VIBRA|BOOKING', 'Outros'),

    # --- user-answered groups ---
    (r'^PAGAMENTO', 'Outros'),
    (r'CARREGAMENTO WALLET', 'Outros'),
    (r'TRADE REPUBLIC|REVOLUT|CRYPTO\.COM|PAYMONADE', 'Outros'),

    # --- services / insurance / donations / misc known ---
    (r'FIDELIDADE|GENERALI', 'Outros'),
    (r'ASSOCIACAO SALVADOR', 'Outros'),
    (r'DANZA FUTURA', 'Arte'),
    (r'CTT |PG SV|STRIPE|HIPAY|IFTHENPAY|PAYSHOP|CXDAPP|PAYMONADE', 'Outros'),
    (r'CARINA GUIMARA', 'TFR Pago'),

    # --- food: groceries + eating out (except Quiosque Beatriz -> Tabaco above) ---
    (r'CONTINENTE|PINGO DOCE|RECHEIO|MERCADONA|LIDL|INTERMACHE|MINIPRECO|ALDI|SUPERCOR|LECLERC|TENDA CONTINENTE|TOMATINO|PESCADO|BRAKIOSK|RESTAURANTE|\bREST\b|REST |MCDONAL|\bMC\b|MC MAR|BURGER|BK\d|BK20597|CAFE|CAFÉ|PASTELARIA|PADARIA|CHURRASQ|PIZZA|SUSHI|RAMEN|NINKI|NOORI|\bBAR\b|FOODTRUCK|KANPEKI|SOLAR|TERRAZZA|PALATU|PAPARICO|BAGO DO BACO|BRASA|LAURENTINO|EUSEBIOS|MIGUS|W CAFE|SETRA|CALDO ENTORN|CASA DAS NATAS|CASA DAS BOLAS|CONF ST ANTONI|SERRA DURA|SNACKBAR|KIOSKU|BOCAQUENTE|E LECLERC|VEND|HOMODIETA|LEITOES|TRAFARIA|SANTO MOLHO|DESAFIO CITRIC|ILHA DO ARROZ|PATEO|NOVO SECULO|ALPHAGRILL', 'Comida'),

    # --- DEVOLUCAO (refunds) re-matched after stripping the prefix in code ---
]

FALLBACK = 'Outros'


def match_category(desc):
    d = desc.upper()
    if d.startswith('DEVOLUCAO '):
        d = d[len('DEVOLUCAO '):]  # refunds map to the purchase's family
    for pat, cat in RULES:
        if re.search(pat, d):
            return 'TFR Recebido' if cat == 'MBWAY' else cat
    return FALLBACK


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    path = args[0]
    cutoff = CUTOFF_DEFAULT
    if '--cutoff' in args:
        cutoff = args[args.index('--cutoff') + 1]

    with open(path, encoding='utf-8-sig') as f:
        lines = f.read().splitlines()

    rows = []
    for l in lines[15:]:
        p = l.split(';')
        if len(p) < 5 or not p[0].strip():
            continue
        rows.append({
            'date': iso(p[0]),
            'name': p[2].strip(),
            'amount_cents': num(p[3]),
            'sheet_balance_cents': num(p[4]),
        })
    rows.reverse()  # oldest first

    # drop overlap with the ODS import
    dropped = [r for r in rows if r['date'] >= cutoff]
    rows = [r for r in rows if r['date'] < cutoff]

    for r in rows:
        cat = match_category(r['name'])
        if r['name'].upper().startswith('TRF MBWAY'):
            cat = 'TFR Recebido' if r['amount_cents'] > 0 else 'TFR Pago'
        r['category'] = cat
        r['notes'] = ''

    opening = rows[0]['sheet_balance_cents'] - rows[0]['amount_cents'] if rows else None
    final = rows[-1]['sheet_balance_cents'] if rows else None

    out = {
        'source_file': path,
        'cutoff': cutoff,
        'dropped_overlap_rows': len(dropped),
        'opening_balance_cents': opening,
        'final_balance_cents': final,
        'rows': rows,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print(f'[cgd_csv_to_staged] total: {len(rows) + len(dropped)}, kept (< {cutoff}): {len(rows)}, '
          f'dropped overlap: {len(dropped)}, opening: {(opening or 0) / 100:.2f}', file=sys.stderr)


if __name__ == '__main__':
    main()
