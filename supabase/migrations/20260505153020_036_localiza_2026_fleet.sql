-- Localiza 2026 fleet alignment per PDF "GAMAS Y VEHICULOS LOCALIZA COLOMBIA 2026".
-- Creates gama LU; inserts new models across F/FL/FX/FU/G4/GC/GL/LE/LU; refreshes
-- image_url for models with local catalog imagery; reassigns is_default per PDF;
-- deactivates models no longer in the new fleet (preserved as inactive for audit).

DO $$
DECLARE
  v_company_id uuid;
  v_cat_lu_id uuid;
  v_cat_c uuid; v_cat_cx uuid; v_cat_f uuid; v_cat_fl uuid;
  v_cat_fx uuid; v_cat_fu uuid; v_cat_g4 uuid; v_cat_gc uuid;
  v_cat_gl uuid; v_cat_le uuid;
  v_placeholder text := 'https://placehold.co/800x500/e2e8f0/64748b?text=Imagen+Pendiente';
BEGIN
  SELECT id INTO v_company_id FROM public.rental_companies WHERE name='Localiza';

  SELECT id INTO v_cat_c  FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='C';
  SELECT id INTO v_cat_cx FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='CX';
  SELECT id INTO v_cat_f  FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='F';
  SELECT id INTO v_cat_fl FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='FL';
  SELECT id INTO v_cat_fx FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='FX';
  SELECT id INTO v_cat_fu FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='FU';
  SELECT id INTO v_cat_g4 FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='G4';
  SELECT id INTO v_cat_gc FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='GC';
  SELECT id INTO v_cat_gl FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='GL';
  SELECT id INTO v_cat_le FROM public.vehicle_categories WHERE rental_company_id=v_company_id AND code='LE';

  -- 1) Create gama LU
  INSERT INTO public.vehicle_categories (
    rental_company_id, code, name, short_description, long_description,
    group_label, tags, passenger_count, luggage_count, has_ac,
    transmission, extra_km_charge, status
  ) VALUES (
    v_company_id, 'LU', 'Gama LU SUV Híbrida Libre PYP',
    'SUV Híbrida Libre PYP',
    'SUV híbrida con tecnología Mhev, exenta de pico y placa, transmisión automática y motor económico.',
    'Prémium',
    '["Transmisión Automática","Capacidad: 5 personas","Híbrido Mhev","Libre Pico y Placa","Aire acondicionado","Frenos ABS"]'::jsonb,
    5, 2, true, 'automatic', 1100, 'active'
  ) RETURNING id INTO v_cat_lu_id;

  -- 2) INSERT new models per PDF

  -- F (Intermedio Mecánico)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_f, 'KIA Soluto Emotion MT', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaF-soluto-STUSMz4KiHgzJGld0gzlAO85HJJTEb.jpeg',
      false, 'active'),
    (v_cat_f, 'Chevrolet Onix Turbo MT 1.0', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaF-onix-P7O1eZWinI3aImGhuag0NZSn0lvJ80.jpeg',
      false, 'active');

  -- FL (Intermedio Mecánico Libre PYP)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_fl, 'KIA Soluto Emotion MT', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFL-soluto-oAWNIxE68Fd4VmwnpSO1SKVHHeaWDc.jpeg',
      true, 'active'),
    (v_cat_fl, 'Renault Logan', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFL-logan-kwfBAEF9C0V9eGifuNR4U5TTAFz35q.jpeg',
      false, 'active'),
    (v_cat_fl, 'Chevrolet Onix Turbo MT 1.0', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFL-onix-WNaRIk8gosizFndFwFrv3S5XLGL2oi.jpeg',
      false, 'active');

  -- FX (Intermedio Automático). Soluto AT reuses Soluto MT image per spec.
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_fx, 'Chevrolet Onix Turbo AT 1.0', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFX-onix-at-GAJ1xXAxXB2t6TlInxBz2tUIo9k8jd.jpeg',
      true, 'active'),
    (v_cat_fx, 'KIA Soluto Emotion AT', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaF-soluto-STUSMz4KiHgzJGld0gzlAO85HJJTEb.jpeg',
      false, 'active'),
    (v_cat_fx, 'Suzuki Baleno', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFX-baleno-hET6SWlHygeAuGRrE60SXZHzjt1RK7.jpeg',
      false, 'active'),
    (v_cat_fx, 'Renault Logan AT', 'o similar', v_placeholder, false, 'active');

  -- FU (Intermedio Automático Libre PYP)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_fu, 'Chevrolet Onix Turbo MT 1.0',
      'Transmisión automática (corregida; el PDF de Localiza marca la fila como mecánica por error).',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFU-onix-mt-bGBKghz7gPyKQgW9Z0sIeIeYABuaZ5.jpeg',
      false, 'active'),
    (v_cat_fu, 'Suzuki Baleno', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFU-baleno-zQl3Dfn4MQ2G4DUUEmXzCEhBDLiIQJ.jpeg',
      false, 'active'),
    (v_cat_fu, 'KIA Soluto Emotion AT', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFU-soluto-ZxDNpdWbhK82CuC5sRVKrRUNV3GVKk.jpeg',
      false, 'active'),
    (v_cat_fu, 'Hyundai Accent Advance', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaFU-accent-advance-eL33qTHYBa2hbnytTPuHVbpooi4E8D.jpeg',
      true, 'active');

  -- G4 (SUV Mecánica 4x4)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_g4, 'Renault Duster 1.3 Turbo', 'o similar', v_placeholder, false, 'active'),
    (v_cat_g4, 'Suzuki Jimny', 'Disponible a partir de abril 2026', v_placeholder, true, 'active');

  -- GC (SUV Compacto Automático)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_gc, 'Chevrolet Tracker Turbo', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-tracker-5pAYtDSoBgp2uQO7CsWZ0QLZZ3HPUg.jpeg',
      true, 'active'),
    (v_cat_gc, 'Nissan Kicks Play', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-nissan-kicks-play-se55ZoyP6YmEkMc5NDH3EPVWrkhWAI.jpeg',
      false, 'active'),
    (v_cat_gc, 'Hyundai Kona', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-kona-rISSq3X0Nt8jkcDaNCDyWCX1ggIbGG.jpeg',
      false, 'active'),
    (v_cat_gc, 'Opel Crossland', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-crossland-8TM9LH8cRbIlXANb2yct1sC7Lpsly4.jpeg',
      false, 'active'),
    (v_cat_gc, 'Fiat Pulse Impetus', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-pulse-impetus-Lr4i7QCYetJ6aY1jT3u3ewsKSr0gF1.jpeg',
      false, 'active');

  -- GL (SUV Compacto Automático Libre PYP). Reuses GC images per spec.
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_gl, 'Hyundai Kona', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-kona-rISSq3X0Nt8jkcDaNCDyWCX1ggIbGG.jpeg',
      true, 'active'),
    (v_cat_gl, 'Chevrolet Tracker Turbo', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-tracker-5pAYtDSoBgp2uQO7CsWZ0QLZZ3HPUg.jpeg',
      false, 'active'),
    (v_cat_gl, 'Seat Arona', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-arona-CIL7hSJkiDUyXrxgFYVg9Ioej0mvKU.jpeg',
      false, 'active'),
    (v_cat_gl, 'Fiat Pulse Impetus', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-pulse-impetus-Lr4i7QCYetJ6aY1jT3u3ewsKSr0gF1.jpeg',
      false, 'active');

  -- LE (SUV Especial)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_le, 'Citroën C5 Aircross Unique', 'o similar', v_placeholder, false, 'active'),
    (v_cat_le, 'Ford Escape Titanium', 'o similar', v_placeholder, false, 'active');

  -- LU (SUV Híbrida Libre PYP)
  INSERT INTO public.category_models (category_id, name, description, image_url, is_default, status) VALUES
    (v_cat_lu_id, 'Suzuki Grand Vitara Híbrido Mhev', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLU-grand-vitara-F3sSMtbBX1Tiepl55ygodfnXxk8Z0v.jpeg',
      true, 'active'),
    (v_cat_lu_id, 'Renault Arkana E-Tech Hybrid', 'o similar',
      'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLU-arkana-WNz12vgr2h25xbiAB3l8jBTHxAvbWo.jpeg',
      false, 'active');

  -- 3) UPDATE images for existing models (local high-quality available)
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaC-fiat-mobi-b8fzPLKGXZanicuqhE2dy12Lw2yKRn.jpeg'
    WHERE category_id=v_cat_c AND name='Fiat Mobi 1.0';
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaC-kia-picanto-TbzTvs6m26kCNhKMDSwZoj38d7IrWx.jpeg'
    WHERE category_id=v_cat_c AND name='Kia Picanto 1.0';
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaC-renault-kwid-bh0ERcd6zcSHnaRTvGPR2kxIqewkBq.jpeg'
    WHERE category_id=v_cat_c AND name='Renault Kwid 1.0';
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaCX-kia-picanto-ymM4UDxaaqdcZvwaebZSRUrG8FZxsR.jpeg'
    WHERE category_id=v_cat_cx AND name='Kia Picanto Zenith';
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-pulse-HE3vMIKdkmovPPBBu7PloIwPTJ9166.jpeg'
    WHERE category_id=v_cat_gc AND name='Fiat Pulse 1.0';
  UPDATE public.category_models SET image_url='https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGC-arona-CIL7hSJkiDUyXrxgFYVg9Ioej0mvKU.jpeg'
    WHERE category_id=v_cat_gc AND name='Arona 1.6 AT';

  -- 4) Reassign is_default in F (Swift Dzire is being deactivated; Logan stays active)
  UPDATE public.category_models SET is_default=false
    WHERE category_id=v_cat_f AND name='Suzuki Swift Dzire 1.2';
  UPDATE public.category_models SET is_default=true
    WHERE category_id=v_cat_f AND name='Renault Logan 1.6';

  -- 5) Reassign is_default in LE (Qashqai becomes default; Koleos demoted)
  UPDATE public.category_models SET is_default=false
    WHERE category_id=v_cat_le AND name='Renault Koleos 2.5';
  UPDATE public.category_models SET is_default=true
    WHERE category_id=v_cat_le AND name='Nissan Qashqai 2.0';

  -- 6) Deactivate models no longer in the new fleet
  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_f AND name IN ('Suzuki Swift Dzire 1.2','Gol Trendline 1.6','Hyundai Accent 1.6');

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_fl AND name IN ('Fiat Mobi','Kia Picanto','Renault Kwid','Suzuki S-Presso');

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_fx AND name IN ('Hyundai Accent 1.6 AT','Kia Rio 1.4');

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_fu AND name IN ('Hyundai Accent 1.6 AT','Kia Rio 1.4','Logan Dynamique 1.6 AT','Suzuki Dzire 1.2 AT');

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_g4 AND name IN ('Renault Duster Dynamique 2.0','Suzuki Vitara 1.6');

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_gc AND name='Hyundai Creta 1.6';

  UPDATE public.category_models SET status='inactive', is_default=false
    WHERE category_id=v_cat_gl AND name='Renault Duster 1.3';

  UPDATE public.category_models SET status='inactive'
    WHERE category_id=v_cat_le AND name='Renault Koleos 2.5';

END $$;
