-- AI Route Optimisation Tables

-- Table to track route optimisation runs
CREATE TABLE IF NOT EXISTS route_optimisation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    optimisation_type TEXT NOT NULL DEFAULT 'ai_enhanced',
    original_stop_order JSONB NOT NULL,
    suggested_stop_order JSONB NOT NULL,
    original_estimated_minutes INTEGER,
    suggested_estimated_minutes INTEGER,
    improvement_minutes INTEGER,
    improvement_percent NUMERIC(5,2),
    confidence_score NUMERIC(3,2),
    factors_used JSONB DEFAULT '{}',
    ai_explanation TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to track historical performance at each stop/customer
CREATE TABLE IF NOT EXISTS stop_performance_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
    avg_actual_minutes NUMERIC(5,2) NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 1,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(customer_id, day_of_week, month, hour_of_day)
);

-- Table to track actual job execution times
CREATE TABLE IF NOT EXISTS job_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    stop_id UUID REFERENCES route_stops(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    scheduled_start_time TIME,
    actual_start_time TIME,
    actual_end_time TIME,
    actual_minutes NUMERIC(5,2),
    estimated_minutes INTEGER,
    variance_minutes NUMERIC(5,2),
    status TEXT NOT NULL DEFAULT 'completed',
    notes TEXT,
    worker_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE route_optimisation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_performance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_executions ENABLE ROW LEVEL SECURITY;

-- Policies for route_optimisation_runs
CREATE POLICY "Users can view route_optimisation_runs" ON route_optimisation_runs
    FOR SELECT USING (true);
CREATE POLICY "Users can insert route_optimisation_runs" ON route_optimisation_runs
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update route_optimisation_runs" ON route_optimisation_runs
    FOR UPDATE USING (true);

-- Policies for stop_performance_history
CREATE POLICY "Users can view stop_performance_history" ON stop_performance_history
    FOR SELECT USING (true);
CREATE POLICY "Users can insert stop_performance_history" ON stop_performance_history
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update stop_performance_history" ON stop_performance_history
    FOR UPDATE USING (true);

-- Policies for job_executions
CREATE POLICY "Users can view job_executions" ON job_executions
    FOR SELECT USING (true);
CREATE POLICY "Users can insert job_executions" ON job_executions
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update job_executions" ON job_executions
    FOR UPDATE USING (true);

-- Add indexes for performance
CREATE INDEX idx_route_optimisation_runs_route_id ON route_optimisation_runs(route_id);
CREATE INDEX idx_route_optimisation_runs_status ON route_optimisation_runs(status);
CREATE INDEX idx_stop_performance_history_customer_id ON stop_performance_history(customer_id);
CREATE INDEX idx_job_executions_route_id ON job_executions(route_id);
CREATE INDEX idx_job_executions_customer_id ON job_executions(customer_id);
CREATE INDEX idx_job_executions_scheduled_date ON job_executions(scheduled_date);