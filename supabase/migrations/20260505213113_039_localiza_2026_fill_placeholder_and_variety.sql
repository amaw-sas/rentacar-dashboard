-- Replaces remaining placeholder URLs (5 models inserted in 036/037 with the
-- local placeholder JPEG), refreshes 4 legacy `.avif` URLs with new 2026 blobs,
-- and creates per-gama image variety for 4 models that share a row in GC and GL
-- (GC keeps `gamaGC-*`, GL gets a new `gamaGL-*` blob).
DO $$
DECLARE
  v_cat_fx uuid := (SELECT id FROM public.vehicle_categories WHERE code = 'FX');
  v_cat_g4 uuid := (SELECT id FROM public.vehicle_categories WHERE code = 'G4');
  v_cat_gl uuid := (SELECT id FROM public.vehicle_categories WHERE code = 'GL');
  v_cat_gy uuid := (SELECT id FROM public.vehicle_categories WHERE code = 'GY');
  v_cat_le uuid := (SELECT id FROM public.vehicle_categories WHERE code = 'LE');

  v_logan_f_url text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/grupo-f-renault-logan-alquiler-de-carros-XuH66QavR8ccDFZj02u1sVL4i4SS6Z.avif';

  v_g4_duster text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaG4-duster-KqhXJo4zJXrIjaFxwogUjrhHoqdsR8.jpeg';
  v_g4_jimny  text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaG4-jimny-rIWQXZV6HzW0raeWa2laEvPUS8WFzP.jpeg';

  v_le_c5     text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLE-c5-aircross-unique-VjpcJHAikw3gaSY4ePgcLSLn1bbHxd.jpeg';
  v_le_escape text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLE-escape-titanium-7DUFcqZUqOBbAjpYHEPiS9936iAXUW.jpeg';
  v_le_qashqai text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLE-qashqai-HuH4A8E7sGIZqUAwt6RUC9MKTKGwNh.jpeg';
  v_le_sportage text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLE-sportage-desire-jBciUDoCld3WEIPZFIRy7gsrv2WP9q.jpeg';
  v_le_tucson text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaLE-tucson-UAhsghPee5ci0R6AnwPo0GyGaQ30Gx.jpeg';

  v_gy_santafe text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGY-santa-fe-KkgWFOSK6az8q7r7xq7WQxOA086seY.jpeg';

  v_gl_arona  text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGL-arona-0zRkzbr9F428w971tNpDPLw7kHJRjl.jpeg';
  v_gl_kona   text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGL-kona-PXxq29N9BekZT9BicJ1RhURZeuCiqk.jpeg';
  v_gl_pulse  text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGL-pulse-impetus-2PCq6ikWPyCt5W2zKBnx8uDVfeXxBz.jpeg';
  v_gl_tracker text := 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaGL-tracker-turbo-dh2RWFX94CFjqsXWZN8v57oe99GRFA.jpeg';
BEGIN
  -- 1) Logan AT (FX) reuses Logan 1.6 (F) image.
  UPDATE public.category_models
  SET image_url = v_logan_f_url
  WHERE category_id = v_cat_fx AND name = 'Renault Logan AT';

  -- 2) Ex-placeholder models get their own 2026 blobs.
  UPDATE public.category_models
  SET image_url = v_g4_duster
  WHERE category_id = v_cat_g4 AND name = 'Renault Duster 1.3 Turbo';

  UPDATE public.category_models
  SET image_url = v_g4_jimny
  WHERE category_id = v_cat_g4 AND name = 'Suzuki Jimny';

  UPDATE public.category_models
  SET image_url = v_le_c5
  WHERE category_id = v_cat_le AND name = 'Citroën C5 Aircross Unique';

  UPDATE public.category_models
  SET image_url = v_le_escape
  WHERE category_id = v_cat_le AND name = 'Ford Escape Titanium';

  -- 3) Refresh legacy `.avif` URLs with 2026 blobs.
  UPDATE public.category_models
  SET image_url = v_gy_santafe
  WHERE category_id = v_cat_gy AND name = 'Hyundai Santa Fe 1.6';

  UPDATE public.category_models
  SET image_url = v_le_qashqai
  WHERE category_id = v_cat_le AND name = 'Nissan Qashqai 2.0';

  UPDATE public.category_models
  SET image_url = v_le_sportage
  WHERE category_id = v_cat_le AND name = 'Kia Sportage 2.0 AT';

  UPDATE public.category_models
  SET image_url = v_le_tucson
  WHERE category_id = v_cat_le AND name = 'Hyundai Tucson 2.0';

  -- 4) GL gets distinct images vs. GC for shared models. GC rows are untouched.
  UPDATE public.category_models
  SET image_url = v_gl_arona
  WHERE category_id = v_cat_gl AND name = 'Seat Arona';

  UPDATE public.category_models
  SET image_url = v_gl_kona
  WHERE category_id = v_cat_gl AND name = 'Hyundai Kona';

  UPDATE public.category_models
  SET image_url = v_gl_pulse
  WHERE category_id = v_cat_gl AND name = 'Fiat Pulse Impetus';

  UPDATE public.category_models
  SET image_url = v_gl_tracker
  WHERE category_id = v_cat_gl AND name = 'Chevrolet Tracker Turbo';
END $$;
