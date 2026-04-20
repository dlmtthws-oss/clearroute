export function validateEmail(email) {
  if (!email) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'Invalid email format';
  return null;
}

export function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return `${fieldName} is required`;
  }
  return null;
}

export function validatePhone(phone) {
  if (!phone) return null;
  const phoneRegex = /^[\d\s\-+()]+$/;
  if (!phoneRegex.test(phone)) return 'Invalid phone number format';
  return null;
}

export function validatePositiveNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    return `${fieldName} must be a positive number`;
  }
  return null;
}

export function validatePostcode(postcode) {
  if (!postcode) return null;
  const postcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  if (!postcodeRegex.test(postcode.replace(/\s/g, ''))) {
    return 'Invalid UK postcode format';
  }
  return null;
}

export function useFormValidation(rules) {
  const validate = (values) => {
    const errors = {};
    Object.keys(rules).forEach((field) => {
      const rule = rules[field];
      const value = values[field];
      if (typeof rule === 'function') {
        const error = rule(value, values);
        if (error) errors[field] = error;
      } else if (Array.isArray(rule)) {
        for (const r of rule) {
          const error = r(value, values);
          if (error) {
            errors[field] = error;
            break;
          }
        }
      }
    });
    return errors;
  };

  return { validate };
}

export function FieldError({ error }) {
  if (!error) return null;
  return (
    <p className="mt-1 text-sm text-red-600" role="alert">
      {error}
    </p>
  );
}