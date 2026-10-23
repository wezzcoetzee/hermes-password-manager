-- Who approves a login for a grant: the native helper prompt (default), a chat message, or nobody.
-- Transaction approvals always use the native prompt regardless of this setting.
ALTER TABLE grants ADD COLUMN approval TEXT NOT NULL DEFAULT 'prompt' CHECK (approval IN ('prompt', 'chat', 'auto'));
