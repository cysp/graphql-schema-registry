CREATE ROLE cloud_admin WITH SUPERUSER;

CREATE ROLE neon_superuser WITH NOLOGIN IN ROLE cloud_admin NOINHERIT;

\i schema.sql

GRANT ALL ON ALL TABLES IN SCHEMA public TO neon_superuser;
