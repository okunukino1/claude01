CREATE TABLE IF NOT EXISTS `delivery_geocode_cache_test` (
  `cache_key` CHAR(64) NOT NULL,
  `address` VARCHAR(300) NOT NULL DEFAULT '',
  `lat` DECIMAL(10,7) NOT NULL,
  `lng` DECIMAL(10,7) NOT NULL,
  `approx` TINYINT(1) NOT NULL DEFAULT 0,
  `formatted` VARCHAR(300) NOT NULL DEFAULT '',
  `hit_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `saved_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_used_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`cache_key`),
  KEY `idx_last_used_at` (`last_used_at`),
  KEY `idx_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
