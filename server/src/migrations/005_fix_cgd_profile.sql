-- Fix the seeded CGD profile: skip_rows must count physical lines (the
-- header block contains blank separator lines). Header sits on physical
-- line 15, so skip_rows is 14, not 15. Databases that already ran 004
-- keep the old value, hence this corrective update.
UPDATE import_profiles
SET config_json = replace(config_json, '"skip_rows":15', '"skip_rows":14')
WHERE name = 'CGD — Movimentos à Ordem' AND created_by = 'manual';
