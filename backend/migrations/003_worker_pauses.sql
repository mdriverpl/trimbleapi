ALTER TABLE workers ADD COLUMN "dataIntervalSeconds" INTEGER CHECK ("dataIntervalSeconds" BETWEEN 1 AND 86400);
ALTER TABLE workers ADD COLUMN "emptyIntervalSeconds" INTEGER CHECK ("emptyIntervalSeconds" BETWEEN 1 AND 86400);
INSERT INTO schema_migrations(version) VALUES (3);
