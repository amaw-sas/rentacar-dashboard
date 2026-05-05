-- Replaces external placehold.co URLs with the local placeholder JPEG hosted on
-- Vercel Blob. Affects 5 models that were inserted with a temporary external
-- placeholder in 036/037 (Logan AT in FX, both G4 entries, two LE entries).
UPDATE public.category_models
SET image_url = 'https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaPlaceholder-placeholder-zjgOwZI1pfLQQPvY7enc0Tpj8mjlfa.jpeg'
WHERE image_url = 'https://placehold.co/800x500/e2e8f0/64748b?text=Imagen+Pendiente';
