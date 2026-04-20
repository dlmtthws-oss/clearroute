import { supabase } from './supabase';
import { resizeImage, validateImageFile, convertHeicToJpeg } from './imageUtils';

export async function scanReceipt(file) {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    return { error: validation.errors.join(' ') };
  }
  
  const convertedFile = await convertHeicToJpeg(file);
  
  const { base64, type } = await resizeImage(convertedFile);
  
  const { data, error } = await supabase.functions.invoke('scan-receipt', {
    body: {
      image_base64: base64,
      image_type: type
    }
  });
  
  if (error) {
    console.error('Receipt scan error:', error);
    return { error: 'Failed to scan receipt. Please try again or enter manually.' };
  }
  
  if (data?.error) {
    return { error: data.error };
  }
  
  return { data };
}

export async function uploadReceipt(file, userId, expenseId) {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    return { error: validation.errors.join(' ') };
  }
  
  const convertedFile = await convertHeicToJpeg(file);
  const fileName = `${Date.now()}-${convertedFile.name.replace(/\s+/g, '-')}`;
  const filePath = `receipts/${userId}/${expenseId}/${fileName}`;
  
  const { error } = await supabase.storage
    .from('receipts')
    .upload(filePath, convertedFile, {
      contentType: convertedFile.type,
      upsert: false
    });
  
  if (error) {
    console.error('Receipt upload error:', error);
    return { error: 'Failed to upload receipt.' };
  }
  
  return { data: { path: filePath } };
}

export async function getReceiptUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(filePath, 3600);
  
  if (error) {
    console.error('Failed to get receipt URL:', error);
    return { error: 'Failed to load receipt.' };
  }
  
  return { data: data.signedUrl };
}

export async function deleteReceipt(filePath) {
  const { error } = await supabase.storage
    .from('receipts')
    .remove([filePath]);
  
  if (error) {
    console.error('Failed to delete receipt:', error);
    return { error: 'Failed to delete receipt.' };
  }
  
  return { success: true };
}

const receiptScanner = { scanReceipt, uploadReceipt, getReceiptUrl, deleteReceipt };
export default receiptScanner;