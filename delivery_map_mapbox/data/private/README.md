# Private Data Directory

This directory is for server-side JSON data used by the delivery map APIs.

- Files here must not be served directly to browsers.
- `delivery_geocode_cache.json` is created by `api/delivery_geocode_cache.php` and stores shared address geocoding results.
- Keep `.htaccess` in this directory when deploying to Apache-based hosting.
- If the app is moved to another server, configure the web server so this directory returns 403 for direct access.
