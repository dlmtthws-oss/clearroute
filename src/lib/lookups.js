import { supabase } from './supabase';

export async function searchCompaniesHouse(query) {
  if (!query || query.length < 2) return { results: [] };
  
  try {
    const { data, error } = await supabase.functions.invoke('companies-house-search', {
      body: { query }
    });
    
    if (error) throw error;
    return data || { results: [] };
  } catch (err) {
    console.error('Companies House search error:', err);
    return { results: [], error: err.message };
  }
}

export async function getCompanyDetails(companyNumber) {
  try {
    const { data, error } = await supabase.functions.invoke('companies-house-get', {
      body: { companyNumber }
    });
    
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Companies House get error:', err);
    return { error: err.message };
  }
}

export async function validateVATNumber(vatNumber, useCache = true) {
  if (!vatNumber) return { valid: null };
  
  try {
    const { data, error } = await supabase.functions.invoke('hmrc-validate-vat', {
      body: { vatNumber, useCache }
    });
    
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('VAT validation error:', err);
    return { valid: null, error: err.message };
  }
}

export function formatAddressForCustomer(address) {
  return {
    address_line_1: address.address_line_1 || '',
    address_line_2: address.address_line_2 || '',
    city: address.locality || address.region || '',
    postcode: address.postal_code || '',
  };
}

const lookups = { searchCompaniesHouse, getCompanyDetails, validateVATNumber, formatAddressForCustomer };
export default lookups;