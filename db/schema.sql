CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('voice_trainer','instrument_trainer','vocal_choir_trainer','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present','absent','late','excused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  specialty VARCHAR(120),
  phone VARCHAR(40),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_no VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180),
  phone VARCHAR(40),
  photo_url TEXT,
  address TEXT,
  health_status VARCHAR(120),
  guardian_name VARCHAR(120),
  guardian_phone VARCHAR(40),
  joined_on DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE learners ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE learners ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE learners ADD COLUMN IF NOT EXISTS health_status VARCHAR(120);

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) UNIQUE NOT NULL,
  description TEXT,
  color VARCHAR(10) DEFAULT '#5B5BD6',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS enrollments (
  learner_id UUID REFERENCES learners(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  enrolled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (learner_id, program_id)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES users(id),
  program_id UUID NOT NULL REFERENCES programs(id),
  session_date DATE NOT NULL,
  started_at TIME NOT NULL,
  ended_at TIME NOT NULL,
  venue VARCHAR(120),
  lesson_topic VARCHAR(180) NOT NULL,
  activities TEXT NOT NULL,
  exercises TEXT,
  trainer_comments TEXT,
  observation TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('scheduled','completed','cancelled')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  session_id UUID REFERENCES training_sessions(id) ON DELETE CASCADE,
  learner_id UUID REFERENCES learners(id) ON DELETE CASCADE,
  status attendance_status NOT NULL,
  note VARCHAR(250),
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON training_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_trainer ON training_sessions(trainer_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

CREATE OR REPLACE VIEW report_session_summary AS
SELECT s.id, s.session_date, s.trainer_id, u.name trainer_name, u.role, s.program_id,
       p.name program_name, p.color, s.lesson_topic, s.activities, s.observation,
       count(a.*) expected, count(*) FILTER (WHERE a.status IN ('present','late')) attended,
       count(*) FILTER (WHERE a.status = 'absent') absent,
       round(100.0 * count(*) FILTER (WHERE a.status IN ('present','late')) / NULLIF(count(a.*),0), 1) attendance_rate
FROM training_sessions s
JOIN users u ON u.id=s.trainer_id JOIN programs p ON p.id=s.program_id
LEFT JOIN attendance a ON a.session_id=s.id
WHERE s.status='completed'
GROUP BY s.id,u.name,u.role,p.name,p.color;
