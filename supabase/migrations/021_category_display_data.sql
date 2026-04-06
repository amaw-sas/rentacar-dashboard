-- Add display fields for vehicle categories (migrated from useVehicleCategories.ts)
ALTER TABLE public.vehicle_categories ADD COLUMN group_label text NOT NULL DEFAULT '';
ALTER TABLE public.vehicle_categories ADD COLUMN short_description text NOT NULL DEFAULT '';
ALTER TABLE public.vehicle_categories ADD COLUMN long_description text NOT NULL DEFAULT '';
ALTER TABLE public.vehicle_categories ADD COLUMN tags jsonb NOT NULL DEFAULT '[]';
