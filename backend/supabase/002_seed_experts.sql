INSERT INTO experts (telegram_chat_id, name, credentials, specialty, lightning_address, available)
VALUES
  (123456789, 'Dr. Sarah Chen', 'MD Pediatrics, Stanford 2014 · Board-Certified · 9 yrs experience', 'healthcare', 'schen@strike.me', true),
  (987654321, 'Atty. Marcus Johnson', 'JD Harvard Law 2009 · Admitted NY & CA Bars · 12 yrs experience', 'legal', 'mjohnson@strike.me', true),
  (555666777, 'Jennifer Park, CPA', 'CPA, CFA · Wharton 2011 · 10 yrs experience', 'finance', 'jpark@strike.me', true)
ON CONFLICT (telegram_chat_id) DO NOTHING;
