# Delivery Map Database

This directory contains SQL for database-backed test features.

## Test geocode cache

The test app uses `api/delivery_geocode_cache_test.php` for the shared geocode cache.

Required `api/config.php` constants:

- `GEOCODE_CACHE_TEST_DB_HOST`
- `GEOCODE_CACHE_TEST_DB_PORT`
- `GEOCODE_CACHE_TEST_DB_NAME`
- `GEOCODE_CACHE_TEST_DB_USER`
- `GEOCODE_CACHE_TEST_DB_PASSWORD`
- `GEOCODE_CACHE_TEST_DB_TABLE`
- `GEOCODE_CACHE_TEST_DB_MAX_ITEMS`

The API runs `CREATE TABLE IF NOT EXISTS` automatically, so importing
`delivery_geocode_cache_test.sql` is optional. It is kept here for manual setup
and review.
