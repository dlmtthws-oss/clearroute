-- Add geocoding columns for route optimisation

-- Add lat/lng to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS lng NUMERIC(11, 8);

-- Add estimated_duration to route_stops
ALTER TABLE route_stops 
ADD COLUMN IF NOT EXISTS estimated_duration INTEGER DEFAULT 30;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_customers_lat_lng ON customers(lat, lng);
CREATE INDEX IF NOT EXISTS idx_route_stops_estimated_duration ON route_stops(estimated_duration);