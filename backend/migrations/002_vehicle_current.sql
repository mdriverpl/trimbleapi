CREATE TABLE vehicle_current (
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  speed INTEGER,
  read_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  mileage BIGINT,
  heading INTEGER,
  trace_type INTEGER NOT NULL,
  tfu DOUBLE PRECISION,
  properties JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (worker_id, source)
);
CREATE INDEX vehicle_current_read_at ON vehicle_current(read_at DESC, worker_id, source);
CREATE INDEX vehicle_current_source ON vehicle_current(source);
INSERT INTO schema_migrations(version) VALUES (2);
