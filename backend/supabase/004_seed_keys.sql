-- Backfill names + license attestations for seed experts (American identities).
-- Public/private keys are generated on first signing call by backend/signing.py.

UPDATE experts
  SET name = 'Dr. Sarah Chen',
      credentials = 'MD Pediatrics, Stanford 2014 · Board-Certified · 9 yrs experience',
      license_attestation = 'California Medical Board · License #G123456 · NPI #1234567890 · Verified 2024-08-14'
  WHERE name = 'Dr. Priya Mehta';

UPDATE experts
  SET name = 'Atty. Marcus Johnson',
      credentials = 'JD Harvard Law 2009 · Admitted NY & CA Bars · 12 yrs experience',
      license_attestation = 'NY State Bar #4892341 · Admitted 2009 · NYSBA Verified 2024-09-02'
  WHERE name = 'Adv. Rajesh Kumar';

UPDATE experts
  SET name = 'Jennifer Park, CPA',
      credentials = 'CPA, CFA · Wharton 2011 · 10 yrs experience',
      license_attestation = 'AICPA Member #245891 · CFA Charter #1842736 · Verified 2024-07-30'
  WHERE name = 'CA Anita Sharma';
