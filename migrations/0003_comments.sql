CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_quote ON comments(quote_id, created_at DESC, id DESC);
