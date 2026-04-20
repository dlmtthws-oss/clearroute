-- Add lat/lng columns to route_stops for map markers
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Add index for geospatial queries
CREATE INDEX IF NOT EXISTS route_stops_geocode_idx ON route_stops(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Cache for geocoding results
CREATE TABLE IF NOT EXISTS geocode_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_hash TEXT UNIQUE NOT NULL,
  address_text TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "geocode_cache_read" ON geocode_cache FOR SELECT USING (true);
CREATE POLICY "geocode_cache_insert" ON geocode_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "geocode_cache_update" ON geocode_cache FOR UPDATE USING (true);