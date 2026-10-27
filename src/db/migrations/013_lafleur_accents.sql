-- Lafleur's Perrières and Pensées with their accents (data/curation/2026-10-27-lafleur.json was first
-- applied without them). Only these production rows, and only while they still carry the plain names.
-- The search fields (search_norm, tokens) ignore accents, so they stay as they are.
UPDATE wines SET name = 'Les Perrières', display_name = 'Les Perrières, Lafleur', updated_at = NOW()
 WHERE wine_id = 75680 AND display_name = 'Les Perrieres, Lafleur';
UPDATE wines SET name = 'Les Pensées', display_name = 'Les Pensées de Lafleur, Pomerol', updated_at = NOW()
 WHERE wine_id = 65450 AND display_name = 'Les Pensees de Lafleur, Pomerol';
