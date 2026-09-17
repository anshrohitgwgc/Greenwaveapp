-- Durable ownership. Metadata is never an authorization/ownership fallback.
BEGIN;
CREATE TABLE IF NOT EXISTS inventory_transaction_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_itp_transaction_photo UNIQUE (transaction_id, photo_id),
    CONSTRAINT uq_itp_photo UNIQUE (photo_id)
);
CREATE INDEX IF NOT EXISTS idx_itp_transaction_id ON inventory_transaction_photos(transaction_id);

-- Read-only reconciliation surface: no filenames, customers, or object keys.
-- All ownership signals must agree. Order matches require GLOBAL uniqueness,
-- even when candidates happen to be in different warehouses.
CREATE OR REPLACE VIEW inventory_photo_backfill_review AS
WITH candidates AS (
 SELECT p.id AS photo_id, p.warehouse_id, p.created_at,
   ARRAY(SELECT t.id FROM inventory_transactions t WHERE t.photo_id = p.id) AS legacy,
   ARRAY(SELECT t.id FROM inventory_transactions t WHERE p.job_reference = t.id::text) AS uuid_links,
   ARRAY(SELECT t.id FROM inventory_transactions t WHERE NULLIF(p.job_reference, '') = NULLIF(t.order_number, '')) AS orders
 FROM photos p
), resolved AS (
 SELECT *, CASE
   WHEN cardinality(legacy) = 1 AND cardinality(uuid_links) = 0 THEN legacy[1]
   WHEN cardinality(legacy) = 1 AND uuid_links = legacy THEN legacy[1]
   WHEN cardinality(legacy) = 0 AND cardinality(uuid_links) = 1 THEN uuid_links[1]
   WHEN cardinality(legacy) = 0 AND cardinality(uuid_links) = 0 AND cardinality(orders) = 1 THEN orders[1]
 END AS candidate_id
 FROM candidates
), classified AS (
 SELECT r.*, CASE
   WHEN candidate_id IS NOT NULL AND r.warehouse_id = t.warehouse_id THEN
     CASE WHEN cardinality(legacy) = 1 THEN 'DETERMINISTIC_SINGLE_PHOTO_LINK'
          WHEN cardinality(uuid_links) = 1 THEN 'DETERMINISTIC_TRANSACTION_ID_LINK'
          ELSE 'DETERMINISTIC_ORDER_LINK' END
   WHEN cardinality(orders) > 1 THEN 'AMBIGUOUS_ORDER_LINK'
   ELSE 'UNASSOCIATED_PHOTO' END AS classification
 FROM resolved r LEFT JOIN inventory_transactions t ON t.id = r.candidate_id
), ranked AS (
 SELECT *, row_number() OVER (PARTITION BY candidate_id ORDER BY
   CASE classification WHEN 'DETERMINISTIC_SINGLE_PHOTO_LINK' THEN 0 ELSE 1 END,
   created_at, photo_id) AS attachment_rank
 FROM classified
)
SELECT photo_id,
 CASE WHEN classification LIKE 'DETERMINISTIC_%' AND attachment_rank <= 15 THEN candidate_id END AS transaction_id,
 CASE WHEN classification LIKE 'DETERMINISTIC_%' AND attachment_rank > 15 THEN 'UNASSOCIATED_PHOTO' ELSE classification END AS classification,
 CASE WHEN classification = 'AMBIGUOUS_ORDER_LINK' THEN 'AMBIGUOUS_REQUIRES_REVIEW'
      WHEN cardinality(legacy) > 1 OR (cardinality(legacy) > 0 AND cardinality(uuid_links) > 0 AND legacy <> uuid_links) THEN 'CONFLICTING_OWNERSHIP_REQUIRES_REVIEW'
      WHEN classification LIKE 'DETERMINISTIC_%' AND attachment_rank > 15 THEN 'PHOTO_LIMIT_REQUIRES_REVIEW'
      WHEN candidate_id IS NOT NULL AND classification = 'UNASSOCIATED_PHOTO' THEN 'WAREHOUSE_REQUIRES_REVIEW'
      WHEN classification = 'UNASSOCIATED_PHOTO' THEN 'NO_DETERMINISTIC_LINK'
      ELSE 'SAFE_TO_LINK' END AS reason,
 attachment_rank
FROM ranked;

INSERT INTO inventory_transaction_photos (transaction_id, photo_id, sort_order)
SELECT transaction_id, photo_id, attachment_rank::integer - 1
FROM inventory_photo_backfill_review WHERE transaction_id IS NOT NULL
ON CONFLICT DO NOTHING;
COMMIT;
