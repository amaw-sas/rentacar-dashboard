-- Rollback script for soft-delete of test reservations applied 2026-05-14.
-- Restores the 62 reservations linked to the 36 archived test customers
-- back to their previous status. Run ONLY if the cancel operation must be undone.
--
-- Verification before running:
--   SELECT status, COUNT(*) FROM reservations
--   WHERE id IN (<all 62 ids>) GROUP BY status;
-- Expected: all 62 should currently be 'cancelado'.

BEGIN;

UPDATE reservations SET status='mensualidad', updated_at=now()
WHERE id IN ('625ffd45-847e-44e8-a062-fb3db600809f');

UPDATE reservations SET status='no_recogido', updated_at=now()
WHERE id IN ('584a967d-3367-4a61-ae75-386d716337d0');

UPDATE reservations SET status='utilizado', updated_at=now()
WHERE id IN (
  '5601c7a3-7cd1-44b9-b7e4-223e38f7c5a4',
  'e18c2375-836f-456c-ad14-f38f1630474b'
);

UPDATE reservations SET status='reservado', updated_at=now()
WHERE id IN (
  '8d60b3aa-b6fa-4a36-98a0-c7aa2f6e74c3','2930fef6-4a31-4e31-a44c-3620d702c984',
  '89705a19-c2f8-4f44-a1b6-f4e539d31e1b','fc09078e-f708-4d52-8c44-c9e3d7616bf7',
  'c57d1e68-d36f-4b3f-87dd-d90252ef02d2','bbb44620-4787-47ab-bd64-248105803397',
  '42d50712-209d-49ad-8d61-37b2121e8b84','f516a3a5-e0d9-4ce8-bed7-3b56f04b0721',
  '5e1a9a5c-a1d4-46d8-94b1-81acf5ca8a36','e50e07d5-d48f-43f0-9264-5b9086fa0061',
  '6b46a8f7-d974-48c5-910e-1396074bffcf','a60b67d6-3bf6-4c04-b59e-52c9556b06f0',
  '9e6c00fb-e329-432c-9105-8942fb74fe05','fb5bb56a-da66-4a01-a804-585f0ff9ca3d',
  'eac5381b-1eaa-4808-bc7c-d53313b676b5','899611f6-947f-4f93-a3d4-2a698762a704',
  '414e29cb-3c38-44c9-9ab4-db0aa0dda34a','3710ebf1-7d85-46b9-9906-70907d9c28f3',
  '1d8e644b-7e44-4def-9637-1a7a0626bce1','c80ebc7c-e72e-4b32-873b-5235ec81db5c',
  'e0ce9956-87c7-41e5-a4c5-d549b3f0754e','9a67ca88-cd08-45a5-a836-31908d11f8e5',
  'b8dac477-5823-44a8-9982-4e2cab6204a1','05be7db5-7a09-4dce-bb36-f9f9a01a0431',
  'd53c1eb4-d5e2-4f1c-8c16-5504fe1097b6','d79a7ba3-aa7a-4b9d-8bb5-b138d2e29aaf',
  'a07513cd-7266-4999-b9e3-4bb90b082f3b','873833e6-6421-45ee-a940-6d1f5350a300',
  'a82be210-76ca-431b-ae90-92548b09deb3','9f50219d-a267-4b1e-a13f-97d2a1ffaca0',
  'c9769c6a-bdc7-4bc9-9cd5-acbef06feaef','015b95f7-8c22-408a-ab8a-73a81f80cddb',
  '11435a6d-f824-412b-8b49-2eca5d72a985','3e72c1d4-4d9f-41e0-b095-1e3363d02a6d',
  '52e1ee8b-b7eb-4304-911b-9601536e4652','0b62d37b-d65d-441d-89a0-64757f92d3af',
  '4aeee320-95d8-463e-8307-741dfe435d31','0d572b75-57d1-4817-8780-e27d15cac85d',
  '461090f3-9f3f-41f9-a4f6-7837b04b6fe4','3b3c1c5f-9fba-4c33-b032-124b5a9b2b22',
  '80a8a256-6593-4a9b-ac58-652b97fcda4f','d52cbb06-e064-4757-94fd-fb9a9120d5ba',
  '5f8b2565-a30d-44ec-8b93-2c6e95c06f75','ee2170d6-ccdd-46ed-8af6-f837ff970d93',
  'ad47b5f2-0f39-4394-a6db-af330082d666','60ee02ac-6d46-43d9-bb45-ff57b340ba70',
  '013eefff-21b1-4ac0-8d10-cacbc42d1acc','60af3d96-e037-4e09-9dc7-2c616d07c749',
  '1104d55f-810c-4970-ac2d-883b7184c189','16846aac-6990-4547-bfa4-4eca87296e3e',
  'cadcdc1f-8657-4d34-aab9-56934d5abcc2','217f1c9d-6d2c-4175-82cd-62bcf066cdb1',
  'c1ba2dca-b28b-4ea4-a4f2-348914f0e595','76225b0a-f744-4402-b17c-368889a63081',
  'a65e52c5-1775-4f2f-a050-05f0934d4e99','29d32ed4-e28a-47e6-9835-d6e5858ae657',
  '9d7e6fd9-cd7e-4ff6-bc05-ab54ccead38c','2c8e1f8f-569d-446b-9bad-27d6d5d3074d'
);

-- Expected: 62 rows total updated. Verify before COMMIT.
COMMIT;
