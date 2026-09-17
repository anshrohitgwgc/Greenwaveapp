-- Disposable PostgreSQL only. Transaction rolls back every synthetic row.
BEGIN;
DO $$
DECLARE
 w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); m uuid := gen_random_uuid();
 u integer; t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid();
 p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
 p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid(); p6 uuid := gen_random_uuid();
 p7 uuid := gen_random_uuid(); p8 uuid := gen_random_uuid();
BEGIN
 INSERT INTO "user" (email,password,"fullName",role) VALUES ('backfill-fixture@test.invalid','disabled','Synthetic fixture','staff') RETURNING id INTO u;
 INSERT INTO warehouses(id,name,code) VALUES(w,'Fixture A','GATE-A'),(w2,'Fixture B','GATE-B');
 INSERT INTO materials(id,name,unit) VALUES(m,'Synthetic material','kg');
 INSERT INTO inventory_transactions(id,warehouse_id,material_id,type,total,created_by,order_number)
 VALUES(t1,w,m,'inbound',1,u,'GATE-SHARED'),(t2,w,m,'inbound',1,u,'GATE-SHARED'),(t3,w,m,'inbound',1,u,'GATE-UNIQUE');
 INSERT INTO photos(id,warehouse_id,object_key,original_filename,mime_type,size_bytes,taken_by,taken_at,job_reference)
 VALUES
 (p1,w,'fixture/1','fixture','image/jpeg',1,u,now(),NULL),
 (p2,w,'fixture/2','fixture','image/jpeg',1,u,now(),t2::text),
 (p3,w,'fixture/3','fixture','image/jpeg',1,u,now(),'GATE-UNIQUE'),
 (p4,w,'fixture/4','fixture','image/jpeg',1,u,now(),'GATE-SHARED'),
 (p5,w,'fixture/5','fixture','image/jpeg',1,u,now(),'GATE-SHARED'),
 (p6,w,'fixture/6','fixture','image/jpeg',1,u,now(),'UNKNOWN'),
 (p7,w2,'fixture/7','fixture','image/jpeg',1,u,now(),t3::text),
 (p8,w,'fixture/8','fixture','image/jpeg',1,u,now(),t1::text);
 UPDATE inventory_transactions SET photo_id=p1 WHERE id=t1;
 UPDATE inventory_transactions SET photo_id=p8 WHERE id=t2;
 IF (SELECT classification FROM inventory_photo_backfill_review WHERE photo_id=p1) <> 'DETERMINISTIC_SINGLE_PHOTO_LINK' THEN RAISE EXCEPTION 'single link failed'; END IF;
 IF (SELECT classification FROM inventory_photo_backfill_review WHERE photo_id=p2) <> 'DETERMINISTIC_TRANSACTION_ID_LINK' THEN RAISE EXCEPTION 'UUID link failed'; END IF;
 IF (SELECT classification FROM inventory_photo_backfill_review WHERE photo_id=p3) <> 'DETERMINISTIC_ORDER_LINK' THEN RAISE EXCEPTION 'unique order failed'; END IF;
 IF (SELECT count(*) FROM inventory_photo_backfill_review WHERE photo_id IN(p4,p5) AND classification='AMBIGUOUS_ORDER_LINK' AND transaction_id IS NULL AND reason='AMBIGUOUS_REQUIRES_REVIEW') <> 2 THEN RAISE EXCEPTION 'ambiguous ownership leaked'; END IF;
 IF EXISTS(SELECT 1 FROM inventory_photo_backfill_review WHERE photo_id IN(p6,p7,p8) AND transaction_id IS NOT NULL) THEN RAISE EXCEPTION 'unassociated/conflicting/warehouse ownership leaked'; END IF;
 INSERT INTO inventory_transaction_photos(transaction_id,photo_id,sort_order)
 SELECT transaction_id,photo_id,attachment_rank::int-1 FROM inventory_photo_backfill_review WHERE photo_id IN(p1,p2,p3,p4,p5,p6,p7,p8) AND transaction_id IS NOT NULL;
 IF (SELECT count(*) FROM inventory_transaction_photos WHERE photo_id IN(p1,p2,p3,p4,p5,p6,p7,p8)) <> 3 THEN RAISE EXCEPTION 'unexpected backfill associations'; END IF;
 RAISE NOTICE 'PASS: deterministic single/UUID/order; ambiguous order; unknown; warehouse mismatch; conflicting ownership';
END $$;
ROLLBACK;
