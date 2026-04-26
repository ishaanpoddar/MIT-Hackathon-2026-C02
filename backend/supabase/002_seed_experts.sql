INSERT INTO experts (name, credentials, specialty, lightning_address, available)
VALUES
  ('Dr. Sarah Chen', 'MD Pediatrics, Stanford 2014 · Board-Certified · 9 yrs experience', 'healthcare', 'schen@strike.me', true),
  ('Atty. Marcus Johnson', 'JD Harvard Law 2009 · Admitted NY & CA Bars · 12 yrs experience', 'legal', 'mjohnson@strike.me', true),
  ('Jennifer Park, CPA', 'CPA, CFA · Wharton 2011 · 10 yrs experience', 'finance', 'jpark@strike.me', true)
ON CONFLICT (lightning_address) DO NOTHING;
