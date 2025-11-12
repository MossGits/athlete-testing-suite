-- V2: athletes + tests (stores enum as VARCHAR values)
CREATE TABLE IF NOT EXISTS athlete_profile (
                                               id            BIGSERIAL PRIMARY KEY,
                                               user_id       BIGINT NOT NULL UNIQUE REFERENCES user_account(id) ON DELETE CASCADE,
    first_name    VARCHAR(80) NOT NULL,
    last_name     VARCHAR(80) NOT NULL,
    date_of_birth DATE
    );

CREATE TABLE IF NOT EXISTS test_session (
                                            id            BIGSERIAL PRIMARY KEY,
                                            athlete_id    BIGINT NOT NULL REFERENCES athlete_profile(id) ON DELETE CASCADE,
    type          VARCHAR(16) NOT NULL CHECK (type IN ('BASELINE','ACTIVE')),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    notes         TEXT
    );

CREATE INDEX IF NOT EXISTS idx_test_session_athlete ON test_session(athlete_id);
