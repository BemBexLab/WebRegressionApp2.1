ALTER TABLE scan_configs RENAME COLUMN "intervalHours" TO "intervalMinutes";
ALTER TABLE scan_configs ALTER COLUMN "intervalMinutes" SET DEFAULT 20;
UPDATE scan_configs
SET "intervalMinutes" = CASE
  WHEN "intervalMinutes" = 5 THEN 20
  ELSE "intervalMinutes" * 60
END
WHERE "intervalMinutes" IS NOT NULL;
