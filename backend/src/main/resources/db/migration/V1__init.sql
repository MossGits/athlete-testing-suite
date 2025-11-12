-- V1: initial schema for auth (organization + user_account)

CREATE TABLE IF NOT EXISTS organization (
                                            id   BIGSERIAL PRIMARY KEY,
                                            name VARCHAR(128) NOT NULL UNIQUE
    );

CREATE TABLE IF NOT EXISTS user_account (
                                            id              BIGSERIAL PRIMARY KEY,
                                            email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(32)  NOT NULL, -- e.g., ROLE_ATHLETE, ROLE_TRAINER
    organization_id BIGINT       NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS idx_user_account_org ON user_account(organization_id);

-- trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_account_updated ON user_account;
CREATE TRIGGER trg_user_account_updated
    BEFORE UPDATE ON user_account
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
