-- Drop the telegram_chat_id column from existing deployments.
-- The Telegram expert flow has been removed; experts are now identified
-- by lightning_address (UNIQUE).
ALTER TABLE experts DROP COLUMN IF EXISTS telegram_chat_id;
