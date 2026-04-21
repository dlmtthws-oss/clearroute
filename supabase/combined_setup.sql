-- ClearRoute Combined Database Setup
-- Run this entire file in Supabase SQL Editor

-- 1. PROFILES (Users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'worker' CHECK (role IN ('admin', 'manager', 'worker')),
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  vat_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_select" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_insert" ON companies FOR INSERT WITH CHECK (true);
CREATE POLICY "companies_update" ON companies FOR UPDATE USING (true);
CREATE POLICY "companies_delete" ON companies FOR DELETE USING (true);

-- 3. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT NOT NULL,
  town TEXT,
  postcode TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  frequency TEXT DEFAULT 'monthly',
  price DECIMAL(10,2),
  notes TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_select" ON customers FOR SELECT USING (true);
CREATE POLICY "customers_insert" ON customers FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE USING (true);
CREATE POLICY "customers_delete" ON customers FOR DELETE USING (true);

-- 4. ROUTES
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  day_of_week TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "routes_select" ON routes FOR SELECT USING (true);
CREATE POLICY "routes_insert" ON routes FOR INSERT WITH CHECK (true);
CREATE POLICY "routes_update" ON routes FOR UPDATE USING (true);
CREATE POLICY "routes_delete" ON routes FOR DELETE USING (true);

-- 5. ROUTE STOPS
CREATE TABLE IF NOT EXISTS route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  stop_order INTEGER,
  notes TEXT,
  estimated_duration INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "route_stops_select" ON route_stops FOR SELECT USING (true);
CREATE POLICY "route_stops_insert" ON route_stops FOR INSERT WITH CHECK (true);
CREATE POLICY "route_stops_update" ON route_stops FOR UPDATE USING (true);
CREATE POLICY "route_stops_delete" ON route_stops FOR DELETE USING (true);

-- 6. JOBS
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  route_id UUID REFERENCES routes(id),
  scheduled_date DATE,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES profiles(id),
  photos TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select" ON jobs FOR SELECT USING (true);
CREATE POLICY "jobs_insert" ON jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "jobs_update" ON jobs FOR UPDATE USING (true);
CREATE POLICY "jobs_delete" ON jobs FOR DELETE USING (true);

-- 7. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  invoice_number TEXT UNIQUE,
  issue_date DATE,
  due_date DATE,
  status TEXT DEFAULT 'draft',
  subtotal DECIMAL(10,2),
  vat_rate DECIMAL(5,2) DEFAULT 20,
  vat_amount DECIMAL(10,2),
  total DECIMAL(10,2),
  line_items JSONB,
  notes TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  payment_method TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (true);
CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (true);
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (true);
CREATE POLICY "invoices_delete" ON invoices FOR DELETE USING (true);

-- 8. QUOTES
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  quote_number TEXT UNIQUE,
  valid_until DATE,
  status TEXT DEFAULT 'pending',
  price DECIMAL(10,2),
  description TEXT,
  notes TEXT,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_select" ON quotes FOR SELECT USING (true);
CREATE POLICY "quotes_insert" ON quotes FOR INSERT WITH CHECK (true);
CREATE POLICY "quotes_update" ON quotes FOR UPDATE USING (true);
CREATE POLICY "quotes_delete" ON quotes FOR DELETE USING (true);

-- 9. EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category TEXT,
  date DATE,
  receipt_url TEXT,
  vendor TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (true);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (true);

-- 10. WORKERS
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workers_select" ON workers FOR SELECT USING (true);
CREATE POLICY "workers_insert" ON workers FOR INSERT WITH CHECK (true);
CREATE POLICY "workers_update" ON workers FOR UPDATE USING (true);
CREATE POLICY "workers_delete" ON workers FOR DELETE USING (true);

-- 11. SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select" ON settings FOR SELECT USING (true);
CREATE POLICY "settings_insert" ON settings FOR INSERT WITH CHECK (true);
CREATE POLICY "settings_update" ON settings FOR UPDATE USING (true);

-- User trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', COALESCE(NEW.raw_user_meta_data->>'role', 'worker'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();