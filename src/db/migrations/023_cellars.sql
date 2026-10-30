-- ── Cellars ──────────────────────────────────────────────────────────────────
-- Bottles you own live in a cellar (src/cellars/cellars.ts). Everyone starts
-- with one, made when first needed; you can keep several (home, a locker, a
-- restaurant's store) and share one with a partner or a team. A cellar entry
-- (a tastings row of kind 'cellar') belongs to its cellar: every member sees
-- it, and owners and editors can change it.
CREATE TABLE cellars (
  cellar_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- owner: everything, including sharing and deleting; editor: add, change and
-- remove bottles, racks and receipts; viewer: look.
CREATE TABLE cellar_members (
  cellar_id BIGINT NOT NULL REFERENCES cellars (cellar_id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cellar_id, user_id)
);
CREATE INDEX cellar_members_user ON cellar_members (user_id);

-- A link that adds whoever opens it to a cellar, once, within a week.
CREATE TABLE cellar_invites (
  code       TEXT PRIMARY KEY,
  cellar_id  BIGINT NOT NULL REFERENCES cellars (cellar_id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  used_by    BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ
);

-- A rack, shelf or case: a grid of places, row 0 at the top, column 0 on the left.
CREATE TABLE cellar_racks (
  rack_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cellar_id  BIGINT NOT NULL REFERENCES cellars (cellar_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  n_rows     INT NOT NULL CHECK (n_rows BETWEEN 1 AND 40),
  n_cols     INT NOT NULL CHECK (n_cols BETWEEN 1 AND 40),
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cellar_racks_cellar ON cellar_racks (cellar_id, sort);

-- Where each bottle of an entry sits: one place per bottle.
CREATE TABLE cellar_slots (
  rack_id    BIGINT NOT NULL REFERENCES cellar_racks (rack_id) ON DELETE CASCADE,
  row_no     INT NOT NULL,
  col_no     INT NOT NULL,
  tasting_id BIGINT NOT NULL REFERENCES tastings (tasting_id) ON DELETE CASCADE,
  PRIMARY KEY (rack_id, row_no, col_no)
);
CREATE INDEX cellar_slots_tasting ON cellar_slots (tasting_id);

-- A receipt or invoice for bottles bought: its photo, the shop and the date.
-- The bottles it added point at it (tastings.receipt_id).
CREATE TABLE receipts (
  receipt_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cellar_id    BIGINT REFERENCES cellars (cellar_id) ON DELETE CASCADE,
  user_id      BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
  merchant     TEXT NOT NULL DEFAULT '',
  purchased_on DATE,
  total_cents  INT CHECK (total_cents IS NULL OR total_cents > 0),
  photo        BYTEA,
  photo_type   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX receipts_cellar ON receipts (cellar_id, created_at DESC);

ALTER TABLE tastings ADD COLUMN cellar_id BIGINT REFERENCES cellars (cellar_id) ON DELETE CASCADE;
ALTER TABLE tastings ADD COLUMN receipt_id BIGINT REFERENCES receipts (receipt_id) ON DELETE SET NULL;
CREATE INDEX tastings_cellar ON tastings (cellar_id) WHERE cellar_id IS NOT NULL;

-- Everyone who already has bottles gets a cellar holding them.
INSERT INTO cellars (name, created_by)
SELECT 'My cellar', user_id FROM (SELECT DISTINCT user_id FROM tastings WHERE kind = 'cellar') u;
INSERT INTO cellar_members (cellar_id, user_id, role) SELECT cellar_id, created_by, 'owner' FROM cellars;
UPDATE tastings t SET cellar_id = c.cellar_id FROM cellars c WHERE t.kind = 'cellar' AND c.created_by = t.user_id;
