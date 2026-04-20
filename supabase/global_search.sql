-- Add GIN indexes for full-text search
-- Customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS customers_search_idx ON customers USING GIN(search_vector);

-- Invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS invoices_search_idx ON invoices USING GIN(search_vector);

-- Routes
ALTER TABLE routes ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS routes_search_idx ON routes USING GIN(search_vector);

-- Create/update search vectors
UPDATE customers SET search_vector = to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(address_line_1, '') || ' ' || COALESCE(address_line_2, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(postcode, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(phone, ''));

UPDATE invoices SET search_vector = to_tsvector('english', COALESCE(invoice_number, '') || ' ' || COALESCE(notes, ''));

UPDATE routes SET search_vector = to_tsvector('english', COALESCE(name, ''));

-- Create triggers to keep search vectors updated
CREATE OR REPLACE FUNCTION customers_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.address_line_1, '') || ' ' || COALESCE(NEW.address_line_2, '') || ' ' || COALESCE(NEW.city, '') || ' ' || COALESCE(NEW.postcode, '') || ' ' || COALESCE(NEW.email, '') || ' ' || COALESCE(NEW.phone, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_search_update ON customers;
CREATE TRIGGER customers_search_update
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_search_trigger();

CREATE OR REPLACE FUNCTION invoices_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.invoice_number, '') || ' ' || COALESCE(NEW.notes, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_search_update ON invoices;
CREATE TRIGGER invoices_search_update
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_search_trigger();

CREATE OR REPLACE FUNCTION routes_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.name, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routes_search_update ON routes;
CREATE TRIGGER routes_search_update
  BEFORE INSERT OR UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION routes_search_trigger();

-- Global search RPC function
CREATE OR REPLACE FUNCTION global_search(query_text TEXT, limit_per_table INT DEFAULT 5)
RETURNS TABLE (
  result_type TEXT,
  id UUID,
  title TEXT,
  subtitle TEXT,
  metadata JSONB
) AS $$
BEGIN
  RETURN QUERY
  -- Search customers
  SELECT 
    'customer'::TEXT,
    c.id,
    c.name::TEXT,
    COALESCE(c.address_line_1, '') || COALESCE(', ' || c.city, '') || COALESCE(', ' || c.postcode, '')::TEXT,
    jsonb_build_object('service_type', c.service_type, 'email', c.email, 'phone', c.phone)
  FROM customers c
  WHERE c.search_vector @@ plainto_tsquery('english', query_text)
  ORDER BY ts_rank(c.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT limit_per_table
  
  UNION ALL
  
  -- Search invoices
  SELECT 
    'invoice'::TEXT,
    i.id,
    i.invoice_number::TEXT,
    COALESCE(cust.name, 'Unknown Customer')::TEXT,
    jsonb_build_object('total', i.total, 'status', i.status, 'due_date', i.due_date)
  FROM invoices i
  LEFT JOIN customers cust ON i.customer_id = cust.id
  WHERE i.search_vector @@ plainto_tsquery('english', query_text)
  ORDER BY ts_rank(i.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT limit_per_table
  
  UNION ALL
  
  -- Search routes
  SELECT 
    'route'::TEXT,
    r.id,
    r.name::TEXT,
    COALESCE(w.name, 'Unassigned')::TEXT,
    jsonb_build_object('status', r.status, 'scheduled_date', r.scheduled_date, 'stop_count', (
      SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id
    ))
  FROM routes r
  LEFT JOIN workers w ON r.assigned_to = w.id
  WHERE r.search_vector @@ plainto_tsquery('english', query_text)
  ORDER BY ts_rank(r.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT limit_per_table;
END;
$$ LANGUAGE plpgsql;