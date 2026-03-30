-- =============================================================================
-- Seed data for rentacar-admin
-- Idempotent: uses ON CONFLICT DO NOTHING where possible
-- =============================================================================

DO $$
DECLARE
  -- Rental company
  localiza_id uuid;

  -- Cities
  city_armenia uuid;
  city_barranquilla uuid;
  city_bogota uuid;
  city_bucaramanga uuid;
  city_cali uuid;
  city_cartagena uuid;
  city_cucuta uuid;
  city_ibague uuid;
  city_manizales uuid;
  city_medellin uuid;
  city_monteria uuid;
  city_neiva uuid;
  city_pereira uuid;
  city_santa_marta uuid;
  city_valledupar uuid;
  city_villavicencio uuid;
  city_sabaneta uuid;
  city_chia uuid;
  city_floridablanca uuid;
  city_pasto uuid;
  city_palmira uuid;
  city_soledad uuid;
  city_yopal uuid;

  -- Vehicle categories
  cat_c uuid;
  cat_f uuid;
  cat_fx uuid;
  cat_fl uuid;
  cat_fu uuid;
  cat_ly uuid;
  cat_g uuid;
  cat_gc uuid;
  cat_g4 uuid;
  cat_gx uuid;
  cat_le uuid;
  cat_gr uuid;
  cat_lp uuid;
  cat_vp uuid;
  cat_gl uuid;

BEGIN

  -- ===========================================================================
  -- 1. Rental Company: Localiza
  -- ===========================================================================
  INSERT INTO public.rental_companies (
    name, code, commission_rate_min, commission_rate_max,
    contact_name, contact_email, contact_phone,
    api_base_url, extra_driver_day_price, baby_seat_day_price, wash_price, status
  ) VALUES (
    'Localiza', 'localiza', 10, 15,
    '', '', '',
    'https://nr.localiza.com/localiza/nucleoreserva/reserva/OTA2013A.svc',
    12000, 12000, 20000, 'active'
  )
  ON CONFLICT (code) DO NOTHING
  RETURNING id INTO localiza_id;

  -- If already existed, fetch the id
  IF localiza_id IS NULL THEN
    SELECT id INTO localiza_id FROM public.rental_companies WHERE code = 'localiza';
  END IF;

  -- ===========================================================================
  -- 2. Cities (23)
  -- ===========================================================================
  INSERT INTO public.cities (name, slug) VALUES ('Armenia', 'armenia') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_armenia;
  IF city_armenia IS NULL THEN SELECT id INTO city_armenia FROM public.cities WHERE slug = 'armenia'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Barranquilla', 'barranquilla') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_barranquilla;
  IF city_barranquilla IS NULL THEN SELECT id INTO city_barranquilla FROM public.cities WHERE slug = 'barranquilla'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Bogotá', 'bogota') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_bogota;
  IF city_bogota IS NULL THEN SELECT id INTO city_bogota FROM public.cities WHERE slug = 'bogota'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Bucaramanga', 'bucaramanga') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_bucaramanga;
  IF city_bucaramanga IS NULL THEN SELECT id INTO city_bucaramanga FROM public.cities WHERE slug = 'bucaramanga'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Cali', 'cali') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_cali;
  IF city_cali IS NULL THEN SELECT id INTO city_cali FROM public.cities WHERE slug = 'cali'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Cartagena', 'cartagena') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_cartagena;
  IF city_cartagena IS NULL THEN SELECT id INTO city_cartagena FROM public.cities WHERE slug = 'cartagena'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Cúcuta', 'cucuta') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_cucuta;
  IF city_cucuta IS NULL THEN SELECT id INTO city_cucuta FROM public.cities WHERE slug = 'cucuta'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Ibagué', 'ibague') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_ibague;
  IF city_ibague IS NULL THEN SELECT id INTO city_ibague FROM public.cities WHERE slug = 'ibague'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Manizales', 'manizales') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_manizales;
  IF city_manizales IS NULL THEN SELECT id INTO city_manizales FROM public.cities WHERE slug = 'manizales'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Medellín', 'medellin') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_medellin;
  IF city_medellin IS NULL THEN SELECT id INTO city_medellin FROM public.cities WHERE slug = 'medellin'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Montería', 'monteria') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_monteria;
  IF city_monteria IS NULL THEN SELECT id INTO city_monteria FROM public.cities WHERE slug = 'monteria'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Neiva', 'neiva') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_neiva;
  IF city_neiva IS NULL THEN SELECT id INTO city_neiva FROM public.cities WHERE slug = 'neiva'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Pereira', 'pereira') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_pereira;
  IF city_pereira IS NULL THEN SELECT id INTO city_pereira FROM public.cities WHERE slug = 'pereira'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Santa Marta', 'santa-marta') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_santa_marta;
  IF city_santa_marta IS NULL THEN SELECT id INTO city_santa_marta FROM public.cities WHERE slug = 'santa-marta'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Valledupar', 'valledupar') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_valledupar;
  IF city_valledupar IS NULL THEN SELECT id INTO city_valledupar FROM public.cities WHERE slug = 'valledupar'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Villavicencio', 'villavicencio') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_villavicencio;
  IF city_villavicencio IS NULL THEN SELECT id INTO city_villavicencio FROM public.cities WHERE slug = 'villavicencio'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Sabaneta', 'sabaneta') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_sabaneta;
  IF city_sabaneta IS NULL THEN SELECT id INTO city_sabaneta FROM public.cities WHERE slug = 'sabaneta'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Chía', 'chia') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_chia;
  IF city_chia IS NULL THEN SELECT id INTO city_chia FROM public.cities WHERE slug = 'chia'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Floridablanca', 'floridablanca') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_floridablanca;
  IF city_floridablanca IS NULL THEN SELECT id INTO city_floridablanca FROM public.cities WHERE slug = 'floridablanca'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Pasto', 'pasto') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_pasto;
  IF city_pasto IS NULL THEN SELECT id INTO city_pasto FROM public.cities WHERE slug = 'pasto'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Palmira', 'palmira') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_palmira;
  IF city_palmira IS NULL THEN SELECT id INTO city_palmira FROM public.cities WHERE slug = 'palmira'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Soledad', 'soledad') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_soledad;
  IF city_soledad IS NULL THEN SELECT id INTO city_soledad FROM public.cities WHERE slug = 'soledad'; END IF;

  INSERT INTO public.cities (name, slug) VALUES ('Yopal', 'yopal') ON CONFLICT (slug) DO NOTHING RETURNING id INTO city_yopal;
  IF city_yopal IS NULL THEN SELECT id INTO city_yopal FROM public.cities WHERE slug = 'yopal'; END IF;

  -- ===========================================================================
  -- 3. Vehicle Categories (15 total, 2 inactive)
  -- ===========================================================================

  -- C: manual, 5 pax, 2 luggage
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'C', 'Gama C Económico Mecánico', '5 pasajeros, 2 equipajes, mecánico', 5, 2, true, 'manual', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_c;
  IF cat_c IS NULL THEN SELECT id INTO cat_c FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'C'; END IF;

  -- F: manual, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'F', 'Gama F Sedán Mecánico', '5 pasajeros, sedán', 5, 2, true, 'manual', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_f;
  IF cat_f IS NULL THEN SELECT id INTO cat_f FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'F'; END IF;

  -- FX: automatic, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'FX', 'Gama FX Sedán Automático', '5 pasajeros, automático', 5, 2, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_fx;
  IF cat_fx IS NULL THEN SELECT id INTO cat_fx FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'FX'; END IF;

  -- FL: manual, 5 pax, hybrid
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'FL', 'Gama FL Compacto Mecánico Híbrido', 'Sin pico y placa, híbrido', 5, 2, true, 'manual', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_fl;
  IF cat_fl IS NULL THEN SELECT id INTO cat_fl FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'FL'; END IF;

  -- FU: automatic, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'FU', 'Gama FU Sedán Automático', 'Sin pico y placa', 5, 2, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_fu;
  IF cat_fu IS NULL THEN SELECT id INTO cat_fu FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'FU'; END IF;

  -- LY: automatic, 5 pax, electric, RESTRICTED
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'LY', 'Gama LY Sedán Automático Eléctrico', '220km autonomía, eléctrico', 5, 2, true, 'automatic', 'active', 'restricted')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_ly;
  IF cat_ly IS NULL THEN SELECT id INTO cat_ly FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'LY'; END IF;

  -- G: manual, 5 pax, INACTIVE
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'G', 'Gama G Camioneta Mecánica', 'Camioneta mecánica', 5, 2, true, 'manual', 'inactive', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_g;
  IF cat_g IS NULL THEN SELECT id INTO cat_g FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'G'; END IF;

  -- GC: automatic, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'GC', 'Gama GC Camioneta Automática', 'Camioneta automática', 5, 2, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_gc;
  IF cat_gc IS NULL THEN SELECT id INTO cat_gc FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'GC'; END IF;

  -- G4: manual, 5 pax, 4x4
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'G4', 'Gama G4 Camioneta Mecánica 4X4', 'Camioneta mecánica 4x4', 5, 2, true, 'manual', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_g4;
  IF cat_g4 IS NULL THEN SELECT id INTO cat_g4 FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'G4'; END IF;

  -- GX: automatic, 5 pax, INACTIVE
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'GX', 'Gama GX Camioneta Automática 4x2', 'Camioneta automática 4x2', 5, 2, true, 'automatic', 'inactive', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_gx;
  IF cat_gx IS NULL THEN SELECT id INTO cat_gx FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'GX'; END IF;

  -- LE: automatic, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'LE', 'Gama LE Camioneta Automática Especial', 'Camioneta automática especial', 5, 2, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_le;
  IF cat_le IS NULL THEN SELECT id INTO cat_le FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'LE'; END IF;

  -- GR: automatic, 7 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'GR', 'Gama GR Camioneta Automática 7 puestos', 'Camioneta automática 7 puestos', 7, 3, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_gr;
  IF cat_gr IS NULL THEN SELECT id INTO cat_gr FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'GR'; END IF;

  -- LP: automatic, 5 pax, hybrid, RESTRICTED
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'LP', 'Gama LP Sedán Automático Híbrido', 'Sedán automático híbrido', 5, 2, true, 'automatic', 'active', 'restricted')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_lp;
  IF cat_lp IS NULL THEN SELECT id INTO cat_lp FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'LP'; END IF;

  -- VP: manual, 5 pax, RESTRICTED
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'VP', 'Gama VP Camioneta Mecánica de Platón', 'Camioneta mecánica de platón', 5, 2, true, 'manual', 'active', 'restricted')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_vp;
  IF cat_vp IS NULL THEN SELECT id INTO cat_vp FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'VP'; END IF;

  -- GL: automatic, 5 pax
  INSERT INTO public.vehicle_categories (rental_company_id, code, name, description, passenger_count, luggage_count, has_ac, transmission, status, visibility_mode)
  VALUES (localiza_id, 'GL', 'Gama GL Camioneta Automática', 'Sin pico y placa', 5, 2, true, 'automatic', 'active', 'all')
  ON CONFLICT (rental_company_id, code) DO NOTHING RETURNING id INTO cat_gl;
  IF cat_gl IS NULL THEN SELECT id INTO cat_gl FROM public.vehicle_categories WHERE rental_company_id = localiza_id AND code = 'GL'; END IF;

  -- ===========================================================================
  -- 4. Branches / Locations (32, linked to cities)
  -- ===========================================================================
  INSERT INTO public.locations (rental_company_id, code, name, slug, city_id) VALUES
    (localiza_id, 'AARME', 'Armenia Aeropuerto', 'armenia', city_armenia),
    (localiza_id, 'AABAN', 'Barranquilla Aeropuerto', 'barranquilla', city_barranquilla),
    (localiza_id, 'ACBAN', 'Barranquilla Norte', 'barranquilla', city_barranquilla),
    (localiza_id, 'ACBSD', 'Soledad', 'soledad', city_soledad),
    (localiza_id, 'AABOT', 'Bogotá Aeropuerto', 'bogota', city_bogota),
    (localiza_id, 'ACBOT', 'Bogotá Av. Caracas con 72', 'bogota', city_bogota),
    (localiza_id, 'ACBEX', 'Bogotá Almacen Éxito del Country', 'bogota', city_bogota),
    (localiza_id, 'ACBNN', 'Bogotá C.Cial Nuestro Centro', 'bogota', city_bogota),
    (localiza_id, 'ACBOJ', 'Bogotá Almacen Yumbo Calle 170', 'bogota', city_bogota),
    (localiza_id, 'AABCR', 'Bucaramanga Aeropuerto', 'bucaramanga', city_bucaramanga),
    (localiza_id, 'ACBCR', 'Floridablanca', 'floridablanca', city_floridablanca),
    (localiza_id, 'AAKAL', 'Cali Aeropuerto', 'cali', city_cali),
    (localiza_id, 'ACKAL', 'Cali Sur Camino Real', 'cali', city_cali),
    (localiza_id, 'ACKJC', 'Cali Norte Chipichape', 'cali', city_cali),
    (localiza_id, 'ACKPA', 'Palmira C.Cial Plaza Madero', 'palmira', city_palmira),
    (localiza_id, 'AACTG', 'Cartagena Aeropuerto', 'cartagena', city_cartagena),
    (localiza_id, 'AACUC', 'Cucuta Aeropuerto', 'cucuta', city_cucuta),
    (localiza_id, 'ACIBG', 'Ibagué C.Cial Plazas del Bosque', 'ibague', city_ibague),
    (localiza_id, 'ACMNZ', 'Manizales C.Cial Mallplaza', 'manizales', city_manizales),
    (localiza_id, 'ACMDL', 'Medellín Las Vegas el Poblado', 'medellin', city_medellin),
    (localiza_id, 'ACMCL', 'Medellín Centro Éxito Colombia', 'medellin', city_medellin),
    (localiza_id, 'ACMNN', 'Medellín Ciudad del Rio El Poblado', 'medellin', city_medellin),
    (localiza_id, 'AAMDL', 'Medellín Aeropuerto José María C.', 'medellin', city_medellin),
    (localiza_id, 'ACMJM', 'Rionegro', 'medellin', city_medellin),
    (localiza_id, 'AAMTR', 'Montería Aeropuerto', 'monteria', city_monteria),
    (localiza_id, 'ACMTR', 'Montería C.Cial Buenavista', 'monteria', city_monteria),
    (localiza_id, 'AANVA', 'Neiva Aeropuerto', 'neiva', city_neiva),
    (localiza_id, 'AAPEI', 'Pereira Aeropuerto', 'pereira', city_pereira),
    (localiza_id, 'AASMR', 'Santa Marta Aeropuerto', 'santa-marta', city_santa_marta),
    (localiza_id, 'ACSMR', 'Santa Marta Barrio El prado', 'santa-marta', city_santa_marta),
    (localiza_id, 'AAVAL', 'Valledupar Aeropuerto', 'valledupar', city_valledupar),
    (localiza_id, 'ACVLL', 'Villavicencio C.Cial Llano Centro', 'villavicencio', city_villavicencio)
  ON CONFLICT (rental_company_id, code) DO NOTHING;

  -- ===========================================================================
  -- 5. Category City Visibility (whitelist for restricted categories)
  -- ===========================================================================

  -- LY: visible in Bogotá, Medellín
  INSERT INTO public.category_city_visibility (category_id, city_id) VALUES
    (cat_ly, city_bogota),
    (cat_ly, city_medellin)
  ON CONFLICT (category_id, city_id) DO NOTHING;

  -- LP: visible in Bogotá
  INSERT INTO public.category_city_visibility (category_id, city_id) VALUES
    (cat_lp, city_bogota)
  ON CONFLICT (category_id, city_id) DO NOTHING;

  -- VP: visible in Cali, Montería
  INSERT INTO public.category_city_visibility (category_id, city_id) VALUES
    (cat_vp, city_cali),
    (cat_vp, city_monteria)
  ON CONFLICT (category_id, city_id) DO NOTHING;

  -- ===========================================================================
  -- 6. Category Pricing (period 2024-01-15 to 2025-12-30)
  -- ===========================================================================
  -- Delete existing pricing for these categories to allow re-seeding
  DELETE FROM public.category_pricing WHERE category_id IN (
    cat_c, cat_f, cat_fx, cat_fl, cat_fu, cat_ly,
    cat_g, cat_gc, cat_g4, cat_gx, cat_le, cat_gr,
    cat_lp, cat_vp, cat_gl
  );

  INSERT INTO public.category_pricing (
    category_id, total_coverage_unit_charge,
    monthly_1k_price, monthly_2k_price, monthly_3k_price,
    monthly_insurance_price, monthly_one_day_price,
    valid_from, valid_until, status
  ) VALUES
    -- C
    (cat_c, 27500, 3865990, 3865990, 4323990, 476000, 220000,
     '2024-01-15', '2025-12-30', 'active'),
    -- F
    (cat_f, 27500, 4668990, 4668990, 5221990, 476000, 250000,
     '2024-01-15', '2025-12-30', 'active'),
    -- FX
    (cat_fx, 34000, 5306990, 5306990, 5934990, 476000, 300000,
     '2024-01-15', '2025-12-30', 'active'),
    -- FL
    (cat_fl, 34000, 5887990, 5887990, 6584990, 476000, 290000,
     '2024-01-15', '2025-12-30', 'active'),
    -- FU
    (cat_fu, 34000, NULL, NULL, NULL, NULL, 340000,
     '2024-01-15', '2025-12-30', 'active'),
    -- LY
    (cat_ly, 34000, 5788990, 5788990, 6579990, NULL, NULL,
     '2024-01-15', '2025-12-30', 'active'),
    -- GC
    (cat_gc, 40000, 6479990, 6479990, 7383990, 595000, 550000,
     '2024-01-15', '2025-12-30', 'active'),
    -- G4
    (cat_g4, 40000, 7144990, 7144990, 8141990, 595000, 550000,
     '2024-01-15', '2025-12-30', 'active'),
    -- GX (inactive category but has pricing data)
    (cat_gx, 40000, 7961990, 7961990, 8756990, NULL, NULL,
     '2024-01-15', '2025-12-30', 'active'),
    -- LE
    (cat_le, 47500, 8726990, 8726990, 9943990, 595000, 570000,
     '2024-01-15', '2025-12-30', 'active'),
    -- GR
    (cat_gr, 47500, 10710990, 10710990, 12204990, 595000, 550000,
     '2024-01-15', '2025-12-30', 'active'),
    -- LP
    (cat_lp, 47500, 8288990, 8288990, 9116990, NULL, NULL,
     '2024-01-15', '2025-12-30', 'active'),
    -- VP
    (cat_vp, 40000, 7716990, 7716990, 8792990, 595000, 550000,
     '2024-01-15', '2025-12-30', 'active'),
    -- GL
    (cat_gl, 40000, NULL, NULL, NULL, 595000, 595000,
     '2024-01-15', '2025-12-30', 'active'),
    -- G (inactive category but has pricing data)
    (cat_g, 40000, 6584990, 6584990, 7364990, NULL, NULL,
     '2024-01-15', '2025-12-30', 'active');

  -- ===========================================================================
  -- 7. Category Models (vehicle makes per category)
  -- ===========================================================================
  -- Delete existing models for these categories to allow re-seeding
  DELETE FROM public.category_models WHERE category_id IN (
    cat_c, cat_f, cat_fx, cat_fl, cat_fu, cat_ly,
    cat_g, cat_gc, cat_g4, cat_gx, cat_le, cat_gr,
    cat_lp, cat_vp, cat_gl
  );

  INSERT INTO public.category_models (category_id, name, is_default) VALUES
    -- C: 4 models
    (cat_c, 'Renault Kwid 1.0', false),
    (cat_c, 'Susuki S-Presso 1.0', false),
    (cat_c, 'Kia Picanto 1.0', false),
    (cat_c, 'Fiat Mobi 1.0', true),
    -- F: 2 models
    (cat_f, 'Suzuki Swift Dzire 1.2', true),
    (cat_f, 'Renault Logan 1.6', false),
    -- FX: 2 models
    (cat_fx, 'Hyundai Accent Advance 1.6', true),
    (cat_fx, 'Nissan Versa Advance 1.6', false),
    -- FL: 1 model
    (cat_fl, 'Suzuki Swift Híbrido', true),
    -- FU: 1 model
    (cat_fu, 'Hyundai Accent Advance 1.6', true),
    -- LY: 1 model
    (cat_ly, 'Renault Zoe', true),
    -- G: 1 model
    (cat_g, 'Seat Arona 1.0', true),
    -- GC: 2 models
    (cat_gc, 'Seat Arona 1.6', true),
    (cat_gc, 'Kia Seltos 1.6', false),
    -- G4: 1 model
    (cat_g4, 'Renault Duster Dynamique 2.0', true),
    -- GX: 1 model
    (cat_gx, 'Suzuki Vitara 1.5', true),
    -- LE: 2 models
    (cat_le, 'Renault Koleos 2.5', true),
    (cat_le, 'Chevrolet Captiva 1.5', false),
    -- GR: 1 model
    (cat_gr, 'Mitsubishi Montero Sport 3.0', true),
    -- LP: 1 model
    (cat_lp, 'Toyota Corolla Híbrido', true),
    -- VP: 1 model
    (cat_vp, 'Renault Duster Oroch 4x4', true),
    -- GL: 1 model
    (cat_gl, 'Kia Niro Híbrido 1.6', true);

  RAISE NOTICE 'Seed completed: 1 rental company, 23 cities, 15 categories, 32 locations, pricing and models inserted.';

END $$;
