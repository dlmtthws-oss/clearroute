export const validators = {
  required: (value) => {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return 'This field is required';
    }
    return null;
  },

  email: (value) => {
    if (!value) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return 'Please enter a valid email address';
    }
    return null;
  },

  ukPostcode: (value) => {
    if (!value) return null;
    const postcodeRegex = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
    if (!postcodeRegex.test(value.replace(/\s/g, ''))) {
      return 'Please enter a valid UK postcode';
    }
    return null;
  },

  phone: (value) => {
    if (!value) return null;
    const phoneRegex = /^[\d\s\-+()]+$/;
    if (!phoneRegex.test(value) || value.replace(/\D/g, '').length < 10) {
      return 'Please enter a valid phone number';
    }
    return null;
  },

  positiveNumber: (value) => {
    if (!value && value !== 0) return null;
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
      return 'Please enter a positive number';
    }
    return null;
  },

  range: (min, max) => (value) => {
    if (!value && value !== 0) return null;
    const num = parseFloat(value);
    if (isNaN(num) || num < min || num > max) {
      return `Please enter a number between ${min} and ${max}`;
    }
    return null;
  },

  dateAfter: (otherDate, otherLabel = 'the issue date') => (value) => {
    if (!value) return null;
    const date = new Date(value);
    const other = new Date(otherDate);
    if (date <= other) {
      return `Date must be after ${otherLabel}`;
    }
    return null;
  },
};

export function validateField(value, rules) {
  if (!rules || rules.length === 0) return null;
  
  for (const rule of rules) {
    const error = rule(value);
    if (error) return error;
  }
  return null;
}

export function validateForm(data, rules) {
  const errors = {};
  let isValid = true;
  
  for (const [field, fieldRules] of Object.entries(rules)) {
    const error = validateField(data[field], fieldRules);
    if (error) {
      errors[field] = error;
      isValid = false;
    }
  }
  
  return { isValid, errors };
}

export function useFormValidation(initialData, validationRules) {
  const [data, setData] = useState(initialData);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const handleChange = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }));
    if (touched[field]) {
      const error = validateField(value, validationRules[field]);
      setErrors(prev => ({ ...prev, [field]: error }));
    }
  };

  const handleBlur = (field) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(data[field], validationRules[field]);
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const validate = () => {
    const { isValid, errors } = validateForm(data, validationRules);
    setErrors(errors);
    setTouched(Object.keys(validationRules).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
    return isValid;
  };

  const reset = () => {
    setData(initialData);
    setErrors({});
    setTouched({});
  };

  return { data, errors, touched, handleChange, handleBlur, validate, reset, setData, setErrors };
}

import { useState } from 'react';

export default validators;