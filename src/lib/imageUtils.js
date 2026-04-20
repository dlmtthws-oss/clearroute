const MAX_DIMENSION = 1600;

export async function resizeImage(file, maxDimension = MAX_DIMENSION) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        let { width, height } = img;
        
        if (width <= maxDimension && height <= maxDimension) {
          resolve({ base64: e.target.result, width, height, type: file.type });
          return;
        }
        
        const scale = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to resize image'));
              return;
            }
            
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                base64: reader.result.split(',')[1],
                width,
                height,
                type: blob.type,
                size: blob.size
              });
            };
            reader.onerror = () => reject(new Error('Failed to read blob'));
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          0.85
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function convertHeicToJpeg(file) {
  return new Promise((resolve, reject) => {
    if (file.type !== 'image/heic' && !file.name.toLowerCase().endsWith('.heic')) {
      resolve(file);
      return;
    }
    
    if (typeof window === 'undefined' || !document) {
      resolve(file);
      return;
    }
    
    if (typeof window.createImageBitmap === 'function') {
      file.arrayBuffer().then((buffer) => {
        createImageBitmap(new ImageData(new Uint8ClampedArray(buffer))).then((bitmap) => {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const newFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
                resolve(newFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            0.9
          );
        }).catch(() => resolve(file));
      }).catch(() => resolve(file));
    } else {
      resolve(file);
    }
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function base64ToFile(base64DataUrl, filename) {
  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid base64 data URL');
  }
  
  const mimeType = matches[1];
  const base64 = matches[2];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new File([bytes], filename, { type: mimeType });
}

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateImageFile(file) {
  const errors = [];
  
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    errors.push('Invalid file type. Please upload JPEG, PNG, WebP, or HEIC images.');
  }
  
  if (file.size > MAX_FILE_SIZE) {
    errors.push('File too large. Maximum size is 10MB.');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

const imageUtils = { resizeImage, convertHeicToJpeg, fileToBase64, base64ToFile, validateImageFile, ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE };
export default imageUtils;