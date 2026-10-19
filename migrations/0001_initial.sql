CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  speaker TEXT NOT NULL CHECK(length(speaker) BETWEEN 1 AND 24),
  text TEXT NOT NULL DEFAULT '' CHECK(length(text) <= 2000),
  source TEXT NOT NULL DEFAULT '' CHECK(length(source) <= 40),
  tag TEXT NOT NULL DEFAULT '' CHECK(length(tag) <= 16),
  said_at TEXT NOT NULL,
  image_key TEXT,
  image_type TEXT,
  created_at INTEGER NOT NULL,
  CHECK(length(text) > 0 OR image_key IS NOT NULL)
);
CREATE INDEX idx_quotes_said_at ON quotes(said_at DESC, created_at DESC, id DESC);
CREATE INDEX idx_quotes_speaker ON quotes(speaker, said_at DESC);
