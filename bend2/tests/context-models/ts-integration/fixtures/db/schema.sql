PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT DEFAULT 'anon');
CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, total_cents INTEGER NOT NULL CHECK(total_cents >= 0));
CREATE INDEX orders_customer ON orders(customer_id);
CREATE VIEW paid_orders AS SELECT id, customer_id FROM orders WHERE total_cents > 0;
INSERT INTO users(email, display_name) VALUES ('a@b.co', 'Ann'), ('b@c.co', 'Bo');
INSERT INTO orders(customer_id, total_cents) VALUES (1, 1250), (2, 0);
