-- ==============================================================================
-- GreenWave V2 - Migration 016: Invoice Numbering Sequence (starts at 10000)
--
-- Replaces the `invoice_number_counter` single-row table with a native
-- PostgreSQL SEQUENCE. Rationale:
--
--   * `nextval()` is atomic and non-transactional, so two concurrent invoice
--     creations can never observe the same value -- no row lock, no retry
--     loop, and no lost allocation if one transaction later rolls back.
--   * Because allocations are never rolled back, a number that has been
--     issued is never handed out a second time, which also means deleting an
--     invoice does NOT release its number for reuse.
--
-- Numbering starts at 10000. Existing invoices are NOT renumbered: this
-- migration only decides where *future* numbering continues from. If any
-- invoice already carries a numeric number >= 10000 (e.g. this migration is
-- re-run, or data was imported), the sequence resumes above that value so the
-- UNIQUE constraint on invoices.invoice_number can never be violated.
-- ==============================================================================

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
    AS BIGINT
    START WITH 10000
    INCREMENT BY 1
    MINVALUE 1
    NO CYCLE;

-- Resume above the highest purely-numeric invoice number already issued,
-- with 10000 as the floor. `is_called = true` means the *next* nextval()
-- returns the value after the one we set here (MINVALUE is 1, not 10000,
-- precisely so this 9999 seed is a legal value), so we set it to
-- (highest_existing) and let nextval return highest+1; when nothing above the
-- floor exists we seed 9999 so the first nextval() returns exactly 10000.
SELECT setval(
    'invoice_number_seq',
    GREATEST(
        9999,
        -- highest number already issued to a real invoice
        COALESCE(
            (SELECT MAX(invoice_number::BIGINT)
               FROM invoices
              WHERE invoice_number ~ '^[0-9]+$'),
            0
        ),
        -- highest number this sequence has already handed out, even if that
        -- invoice was since deleted. Returns NULL until the first nextval(),
        -- which is what lets a fresh install land on exactly 10000.
        COALESCE(pg_sequence_last_value('invoice_number_seq'), 0)
    ),
    true
);

-- The old counter table is retained (not dropped) so a rollback to the
-- previous release keeps working. It is no longer read by the API.
COMMENT ON TABLE invoice_number_counter IS
    'DEPRECATED as of migration 016 - superseded by sequence invoice_number_seq. Retained for rollback safety.';
